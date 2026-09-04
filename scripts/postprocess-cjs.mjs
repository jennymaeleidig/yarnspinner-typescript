#!/usr/bin/env node
// SPDX-License-Identifier: CC0-1.0
//
// Post-process the CommonJS pass (tsc -p tsconfig.cjs.json → dist-cjs/) into
// the artifacts the package export map's require conditions promise: every
// module becomes a .cjs alongside its ESM .js twin in dist/, and every
// declaration becomes a .d.cts. tsc emits extensionless relative requires
// (node10 resolution); Node's CJS resolver does not try .cjs for extensionless
// specifiers, so each relative specifier gains its explicit .cjs extension
// here. Run via `npm run build:cjs`, after the ESM `tsc` pass — the ESM tree
// in dist/ is left untouched.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const cjsDir = join(root, "dist-cjs");
const distDir = join(root, "dist");

// Relative specifiers in require()/import()/from. This codebase imports with
// explicit .js extensions, and tsc's commonjs emit preserves them verbatim —
// so a CJS artifact would require its ESM .js twin (invisible on require(esm)-
// capable Node, ERR_REQUIRE_ESM below it). Each relative specifier therefore
// lands on the CJS twin: .js → .cjs, extensionless → + .cjs.
const RELATIVE_SPEC = /((?:from|import|require)\s*\(?\s*)(["'])(\.\.?\/[^"']+)\2/g;

const rewrite = (code) =>
  code.replace(RELATIVE_SPEC, (match, pre, quote, spec) => {
    if (spec.endsWith(".json")) return match;
    if (/\.cjs$/.test(spec)) return match;
    if (/\.js$/.test(spec)) return pre + quote + spec.slice(0, -3) + ".cjs" + quote;
    if (/\.mjs$/.test(spec)) return pre + quote + spec.slice(0, -4) + ".cjs" + quote;
    return pre + quote + spec + ".cjs" + quote;
  });

// tsc names the map after the ESM twin; rename both the sourceMappingURL
// comment in the emitted code and the "file" field inside the map.
const rewireSourceMap = (code) =>
  code.replace(/^(\/\/# sourceMappingURL=.*?)\.js\.map$/m, "$1.cjs.map");

const rewireMapFileField = (map) => map.replace(/("file"\s*:\s*"[^"]*)\.js(")/, "$1.cjs$2");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const RENAMES = [
  { suffix: ".js", out: ".cjs", transform: (code) => rewireSourceMap(rewrite(code)) },
  { suffix: ".d.ts", out: ".d.cts", transform: rewrite },
  { suffix: ".js.map", out: ".cjs.map", transform: rewireMapFileField },
];

let written = 0;
for (const path of walk(cjsDir)) {
  for (const { suffix, out, transform } of RENAMES) {
    if (!path.endsWith(suffix)) continue;
    const relInCjs = path.slice(cjsDir.length + 1);
    const outRel = relInCjs.slice(0, -suffix.length) + out;
    const outPath = join(distDir, outRel);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, transform(readFileSync(path, "utf8")));
    written += 1;
    break;
  }
}

rmSync(cjsDir, { recursive: true, force: true });
console.log(`postprocess-cjs: wrote ${written} CommonJS artifacts into dist/`);
