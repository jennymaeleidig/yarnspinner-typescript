// SPDX-License-Identifier: CC0-1.0
// The export map's require conditions must resolve to CommonJS artifacts the
// build actually produces, with per-condition type declarations — the seam
// this suite pins: resolve every require condition, execute it, and hold its
// surface against the ESM twin.
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cjsRequire = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg: { name: string; exports: Record<string, any> } = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);

const SUBPATHS = [".", "./react", "./node"] as const;

const selfSpecifier = (subpath: string): string =>
  subpath === "." ? pkg.name : `${pkg.name}${subpath.slice(1)}`;

test("every require condition resolves to an existing CommonJS artifact", () => {
  for (const subpath of SUBPATHS) {
    const entry = pkg.exports[subpath];
    ok(entry, `exports["${subpath}"] missing`);
    ok(entry.require?.types, `exports["${subpath}"].require.types missing`);
    ok(entry.require?.default, `exports["${subpath}"].require.default missing`);
    const resolved = cjsRequire.resolve(selfSpecifier(subpath));
    ok(
      resolved.endsWith(".cjs"),
      `"${subpath}" resolves to ${resolved}, expected a .cjs artifact`,
    );
  }
});

test("every require condition's types point at an existing declaration", () => {
  for (const subpath of SUBPATHS) {
    const types = join(repoRoot, pkg.exports[subpath].require.types);
    ok(
      types.endsWith(".d.cts"),
      `"${subpath}" require types are ${types}, expected a .d.cts declaration`,
    );
    ok(existsSync(types), `"${subpath}" require types ${types} do not exist`);
  }
});

test("no CJS artifact requires an ESM sibling", () => {
  // A .cjs whose relative specifiers end in .js would silently lean on
  // require(esm) (Node ≥22.12) or ERR_REQUIRE_ESM below it — the artifact
  // must be CJS-linked end to end, not a shell over the ESM tree.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const distDir = join(repoRoot, "dist");
  const offenders: string[] = [];
  for (const path of walk(distDir)) {
    if (!path.endsWith(".cjs")) continue;
    const code = readFileSync(path, "utf8");
    if (/\((?:require\()?\s*["']\.\.?\/[^"']*\.js["']/.test(code)) offenders.push(path);
  }
  deepStrictEqual(offenders, []);
});

test("every CJS surface matches its ESM twin", () => {
  const surfaceChecks: Record<(typeof SUBPATHS)[number], string[]> = {
    ".": ["Dialogue", "compileSource"],
    "./react": ["DialogueRunner"],
    "./node": ["loadYarnProject", "nodeProjectFs"],
  };
  const parities: Promise<void>[] = [];
  for (const subpath of SUBPATHS) {
    const specifier = selfSpecifier(subpath);
    const cjs: Record<string, unknown> = cjsRequire(specifier);
    const names = Object.keys(cjs).sort();
    ok(names.length > 0, `"${subpath}" CJS surface is empty`);
    parities.push(
      import(specifier).then((esm) => {
        deepStrictEqual(names, Object.keys(esm).sort());
        for (const name of surfaceChecks[subpath]) {
          strictEqual(typeof cjs[name], "function", `"${subpath}".${name} missing`);
        }
      }),
    );
  }
  return Promise.all(parities).then(() => {});
});
