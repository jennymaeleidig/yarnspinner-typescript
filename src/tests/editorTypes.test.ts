// SPDX-License-Identifier: CC0-1.0
// The ./client types subpath: all three import shapes type-check
// in an editor — via the triple-slash reference path and via the zero-
// dependency paste-in snippet (the shipped client.d.ts references only the
// core package, so pasting it verbatim works without this package).
// Verification is a real tsc run over a fixture project (type-level test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PLUGIN = join(ROOT, "packages", "vite-plugin");
const CLIENT_DTS = join(PLUGIN, "client.d.ts");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");

/** The fixture consumer code: all three import shapes, typed usage. */
const CONSUMER = `
import program from "./story.yarn";
import { stringTable, containsImplicitStringTags, fileTags } from "./story.yarn";
import rawSource from "./story.yarn?raw";
import project from "./project.yarnproject";

// The default export of a .yarn import is a Program the runtime executes.
const _lang: number = program.languageVersion;
const _node: string | undefined = Object.keys(program.nodes)[0];
// Named exports ride the implemented contract.
const _line: string | null = Object.values(stringTable)[0].text;
const _implicit: boolean = containsImplicitStringTags;
const _tags: string[] = fileTags["story.yarn"] ?? [];
// ?raw is the raw source string.
const _upper: string = rawSource.toUpperCase();
// The .yarnproject import is the full load result, shaped for the provider.
if (project.program !== null) {
  const _pLang: number = project.program.languageVersion;
}
const _base: string = project.baseLanguage;
const _trans: Record<string, Record<string, string>> = project.translations;
const _assets: Record<string, string> = project.assets;
const _diag: number = project.diagnostics.length;
`;

const FIXTURE_TSCONFIG = {
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "es2022",
    module: "esnext",
    moduleResolution: "bundler",
    skipLibCheck: true,
    types: [],
  },
  include: ["*.d.ts", "*.ts"],
};

function runTsc(fixtureDir: string): void {
  execFileSync(process.execPath, [TSC, "-p", join(fixtureDir, "tsconfig.json")], {
    cwd: ROOT, // node_modules resolution walks up from the fixture into the repo
    stdio: "pipe",
  });
}

/** The shipped ambient file, verified snippet-clean (no self-references). */
function readClient(): string {
  const source = readFileSync(CLIENT_DTS, "utf8");
  assert(
    !/from ["']yarn-spinner-vite-plugin/.test(source) &&
      !/import\("yarn-spinner-vite-plugin/.test(source),
    "client.d.ts must reference only the core package (zero-dependency snippet)",
  );
  return source;
}

function makeFixture(enableVia: "reference" | "snippet"): string {
  const dir = join(ROOT, ".tmp-editor-types");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "vite-env.d.ts"),
    enableVia === "reference"
      ? '/// <reference types="yarn-spinner-vite-plugin/client" />\n'
      : // The snippet path: the shipped file pasted verbatim — it must carry
        // no reference to this package to qualify as zero-dependency.
        readClient(),
  );
  writeFileSync(join(dir, "consumer.ts"), CONSUMER);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(FIXTURE_TSCONFIG));
  return dir;
}

test("the ./client types subpath ships with the plugin package", () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));
  assert.equal(pkg.exports["./client"]?.types, "./client.d.ts");
  assert.ok(pkg.files.includes("client.d.ts"), "client.d.ts ships in the files array");
});

test("all three import shapes type-check via the triple-slash reference", () => {
  const dir = makeFixture("reference");
  try {
    runTsc(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("all three import shapes type-check via the pasted snippet", () => {
  const dir = makeFixture("snippet");
  try {
    runTsc(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
