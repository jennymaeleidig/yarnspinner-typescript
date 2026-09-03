/**
 * YarnProject loader core (yarn-project-support ticket 02): parse + validate
 * upstream-style `.yarnproject` files (v4 schema, legacy v2 accepted, the
 * dead dev v3 rejected), resolve sourceFiles/excludeFiles globs behind an
 * injected file-access seam, feed `compile()` (ticket 49), diagnose
 * referenced-but-missing strings files, and expose `listSources()`.
 *
 * Seams: the public `loadProject()` / `listSources()` over an in-memory
 * file provider, and the Node provider against the vendored upstream Space
 * project fixture (test-side I/O only — the library core never imports fs,
 * coding standard §2). YPxxxx codes are this project's own surface: upstream
 * has no diagnostic registry for project files.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProject, listSources } from "../index.js";
import type { YarnProjectFileSystem } from "../index.js";
import { loadYarnProject, nodeProjectFs } from "../compile/nodeProjectFs.js";
import { UPSTREAM_TESTS_DIR } from "./upstream/fixtures.js";

/** In-memory provider bound to a fake project directory (POSIX-relative paths). */
function memoryFs(files: Record<string, string>): YarnProjectFileSystem {
  const names = Object.keys(files).sort();
  return {
    listFiles: () => [...names],
    read: (p: string) => (p in files ? files[p] : null),
  };
}

const baseProject = { projectFileVersion: 4, sourceFiles: ["**/*.yarn"], baseLanguage: "en" };

const codesOf = (diagnostics: { code: string }[]) => diagnostics.map((d) => d.code);

/** The loader's own YPxxxx codes, isolated from compiler diagnostics (YSxxxx). */
const ypCodes = (diagnostics: { code: string }[]) => codesOf(diagnostics).filter((c) => c.startsWith("YP"));

// ── Source resolution (globs, excludes, ordering) ─────────────────────────

test("listSources resolves sourceFiles globs relative to the project, sorted, POSIX", () => {
  const r = listSources({
    project: baseProject,
    fileSystem: memoryFs({
      "Opening.yarn": "title: A\n---\n===\n",
      "sub/Nested.yarn": "title: B\n---\n===\n",
      "assets/readme.txt": "not yarn",
    }),
  });
  assert.deepEqual(r.sources, ["Opening.yarn", "sub/Nested.yarn"]);
  assert.deepEqual(r.diagnostics, []);
});

test("`*` stays within a segment and directory-prefixed patterns anchor at the project root", () => {
  const r = listSources({
    project: { ...baseProject, sourceFiles: ["sub/*.yarn"] },
    fileSystem: memoryFs({
      "a.yarn": "title: A\n---\n===\n",
      "sub/b.yarn": "title: B\n---\n===\n",
      "sub/deep/c.yarn": "title: C\n---\n===\n",
    }),
  });
  assert.deepEqual(r.sources, ["sub/b.yarn"]);
});

test("excludeFiles remove matches even when sourceFiles include them", () => {
  const r = listSources({
    project: { ...baseProject, excludeFiles: ["**/generated/**"] },
    fileSystem: memoryFs({
      "a.yarn": "title: A\n---\n===\n",
      "generated/x.yarn": "title: X\n---\n===\n",
      "generated/deep/y.yarn": "title: Y\n---\n===\n",
    }),
  });
  assert.deepEqual(r.sources, ["a.yarn"]);
});

test("no sources matched is diagnosed, and compile is not run", () => {
  const r = loadProject({
    project: baseProject,
    fileSystem: memoryFs({ "readme.txt": "" }),
  });
  assert.ok(codesOf(r.diagnostics).includes("YP0007"));
  assert.equal(r.program, null);
  assert.deepEqual(r.sources, []);
});

// ── Project file validation ───────────────────────────────────────────────

test("legacy v2 project files are accepted and compile", () => {
  const r = loadProject({
    project: { projectFileVersion: 2, sourceFiles: ["*.yarn"], baseLanguage: "en" },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\nLine\n===\n" }),
  });
  assert.deepEqual(codesOf(r.diagnostics).filter((c) => c.startsWith("YP")), []);
  assert.ok(r.program);
  assert.equal(r.project?.projectFileVersion, 2);
});

test("the dead dev version 3 is rejected with a diagnostic", () => {
  const r = loadProject({
    project: { ...baseProject, projectFileVersion: 3 },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(codesOf(r.diagnostics), ["YP0002"]);
  assert.equal(r.program, null);
  assert.equal(r.project, null);
});

test("missing required fields are diagnosed per field", () => {
  const missingSource = loadProject({
    project: { projectFileVersion: 4, baseLanguage: "en" },
    fileSystem: memoryFs({}),
  });
  assert.ok(codesOf(missingSource.diagnostics).includes("YP0003"));

  const missingBase = loadProject({
    project: { projectFileVersion: 4, sourceFiles: ["**/*.yarn"] },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.ok(codesOf(missingBase.diagnostics).includes("YP0003"));
});

test("unparsable project JSON is diagnosed", () => {
  const r = loadProject({ project: "{not json", fileSystem: memoryFs({}) });
  assert.ok(codesOf(r.diagnostics).includes("YP0001"));
  assert.equal(r.program, null);
});

test("unknown top-level fields warn; known editor-only fields are silent", () => {
  const typo = loadProject({
    project: { ...baseProject, sourceFile: ["a.yarn"] },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(typo.diagnostics), ["YP0004"]);

  const knownIgnored = loadProject({
    project: {
      ...baseProject,
      definitions: "Commands.ysls.json",
      editorOptions: { yarnScriptEditor: {} },
      projectName: "Test",
    },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(knownIgnored.diagnostics), []);
});

test("every compilerOptions key is either mapped or diagnosed — never silently dropped", () => {
  const r = loadProject({
    project: {
      ...baseProject,
      compilerOptions: {
        requireVariableDeclarations: true,
        allowPreviewFeatures: true,
        someFutureFlag: true,
      },
    },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(r.diagnostics).sort(), ["YP0005", "YP0005", "YP0005"]);
  // known upstream options get the "no equivalent" message; unknown ones the
  // "not recognised" variant — both keyed to the offending option. YP-filtered:
  // the compile result also carries compiler diagnostics (YSxxxx).
  assert.deepEqual(
    r.diagnostics.filter((d) => d.code.startsWith("YP")).map((d) => d.context).sort(),
    [
      "compilerOptions.allowPreviewFeatures",
      "compilerOptions.requireVariableDeclarations",
      "compilerOptions.someFutureFlag",
    ],
  );
  assert.ok(r.program);
});

test("referenced-but-missing strings files are diagnosed; present ones are not", () => {
  const missing = loadProject({
    project: {
      ...baseProject,
      localisation: { de: { strings: "translations/German.csv" } },
    },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(missing.diagnostics), ["YP0006"]);

  const present = loadProject({
    project: {
      ...baseProject,
      localisation: { de: { strings: "translations/German.csv" } },
    },
    fileSystem: memoryFs({
      "a.yarn": "title: A\n---\n===\n",
      "translations/German.csv": "id,text,file,node,lineNumber,lock,comment,metadata",
    }),
  });
  assert.deepEqual(ypCodes(present.diagnostics), []);
});

test("schema-closed surfaces diagnose typos: localisation entry keys, projectName, authorName", () => {
  const typoKey = loadProject({
    project: {
      ...baseProject,
      localisation: { de: { strins: "de.csv" } },
    },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(typoKey.diagnostics), ["YP0004"]);

  const badProjectName = loadProject({
    project: { ...baseProject, projectName: 42 },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(badProjectName.diagnostics), ["YP0003"]);

  const badAuthor = loadProject({
    project: { ...baseProject, authorName: ["Author", 7] },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(badAuthor.diagnostics), ["YP0003"]);
});

// ── compile() integration ─────────────────────────────────────────────────

test("loadProject feeds resolved files to compile() across files", () => {
  const r = loadProject({
    project: baseProject,
    fileSystem: memoryFs({
      "b.yarn": "title: Second\n---\nSecond here\n===\n",
      "a.yarn": "title: First\n---\n<<jump Second>>\n===\n",
    }),
  });
  assert.deepEqual(codesOf(r.diagnostics), []);
  assert.ok(r.program);
  assert.ok(r.stringTable);
  assert.deepEqual(r.sources, ["a.yarn", "b.yarn"]);
  assert.equal(r.project?.baseLanguage, "en");
});

test("compile options pass through (strict mode throws on collected errors)", () => {
  const files = {
    "a.yarn": "title: A\n---\nLine\n===\n",
    "b.yarn": "title: A\n---\nLine\n===\n", // duplicate node title → YS0011
  };
  assert.throws(() =>
    loadProject({ project: baseProject, fileSystem: memoryFs(files), strict: true }),
  );
});

test("a listed source the provider cannot read is diagnosed", () => {
  const fs = memoryFs({ "a.yarn": "title: A\n---\n===\n" });
  const hostile: YarnProjectFileSystem = { listFiles: fs.listFiles, read: () => null };
  const r = loadProject({ project: baseProject, fileSystem: hostile });
  assert.ok(codesOf(r.diagnostics).includes("YP0008"));
});

// ── Node provider + the vendored Space fixture (acceptance) ───────────────

test("nodeProjectFs enumerates files (skipping node_modules) with POSIX-relative paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "yp-nodefs-"));
  try {
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "junk.yarn"), "title: J\n---\n===\n");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.yarn"), "title: B\n---\n===\n");
    writeFileSync(join(dir, "a.yarn"), "title: A\n---\n===\n");
    const fs = nodeProjectFs(dir);
    assert.deepEqual(fs.listFiles(), ["a.yarn", "sub/b.yarn"]);
    assert.match(fs.read("a.yarn") ?? "", /title: A/);
    assert.equal(fs.read("missing.yarn"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acceptance: the vendored upstream Space project loads, compiles, and diagnoses its unvendored German.csv", () => {
  const r = loadYarnProject(join(UPSTREAM_TESTS_DIR, "Projects", "Space", "Space.yarnproject"));
  assert.deepEqual(ypCodes(r.diagnostics), ["YP0006"]);
  assert.deepEqual(r.sources, ["Sally.yarn", "Ship.yarn"]);
  assert.ok(r.program);
  assert.equal(r.project?.baseLanguage, "en");
  assert.equal(r.project?.localisation?.de?.strings, "../German.csv");
});

test("loadYarnProject on a missing project file is a collected YP0001, not a throw", () => {
  const r = loadYarnProject(join(UPSTREAM_TESTS_DIR, "Projects", "Space", "Nope.yarnproject"));
  assert.deepEqual(ypCodes(r.diagnostics), ["YP0001"]);
  assert.equal(r.program, null);
  assert.equal(r.project, null);
});
