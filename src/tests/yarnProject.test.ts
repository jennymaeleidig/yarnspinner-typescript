// SPDX-License-Identifier: CC0-1.0
/**
 * YarnProject loader core: parse + validate
 * upstream-style `.yarnproject` files (v4 schema, legacy v2 accepted, the
 * dead dev v3 rejected), resolve sourceFiles/excludeFiles globs behind an
 * injected file-access seam, feed `compile()`, diagnose
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

const baseProject = {
  projectFileVersion: 4,
  sourceFiles: ["**/*.yarn"],
  baseLanguage: "en",
};

const codesOf = (diagnostics: { code: string }[]) =>
  diagnostics.map((d) => d.code);

/** The loader's own YPxxxx codes, isolated from compiler diagnostics (YSxxxx). */
const ypCodes = (diagnostics: { code: string }[]) =>
  codesOf(diagnostics).filter((c) => c.startsWith("YP"));

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
    project: {
      projectFileVersion: 2,
      sourceFiles: ["*.yarn"],
      baseLanguage: "en",
    },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\nLine\n===\n" }),
  });
  assert.deepEqual(
    codesOf(r.diagnostics).filter((c) => c.startsWith("YP")),
    [],
  );
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

test("trailing commas and JSONC comments are tolerated silently (jsonc-style)", () => {
  // The .yarnproject format is handled as JSONC across the ecosystem: VS
  // Code associates it with JSONC and upstream Newtonsoft ignores comments
  // and allows trailing commas by default. Tolerance is silent — no
  // diagnostic — matching upstream.
  const text =
    "// generated by the Yarn Spinner extension\n" +
    JSON.stringify(baseProject, null, 2).replace(
      /\"en\"/,
      '"en", /* base locale */',
    ) +
    "\n";
  const r = loadProject({
    project: text,
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(r.diagnostics), []);
  assert.ok(r.program);
  assert.equal(r.project?.baseLanguage, "en");
});

test("commas and comment markers inside string values survive the JSONC strip", () => {
  const text =
    '{"projectFileVersion":4,"sourceFiles":["a.yarn"], // source list\n' +
    ' "baseLanguage":"en", "projectName": "a,yarn not /* a comment */"}\n';
  const r = loadProject({
    project: text,
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(r.diagnostics), []);
  assert.equal(r.project?.projectName, "a,yarn not /* a comment */");
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
        someFutureFlag: true,
      },
    },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.deepEqual(ypCodes(r.diagnostics).sort(), ["YP0005", "YP0005"]);
  // known upstream options get the "no equivalent" message; unknown ones the
  // "not recognised" variant — both keyed to the offending option. YP-filtered:
  // the compile result also carries compiler diagnostics (YSxxxx).
  // `allowPreviewFeatures` and `diagnosticsSeverity` are no longer diagnosed:
  // they are mapped onto the project (ported from upstream ProjectFileTests
  // in the coverage-audit wave), covered by the upstreamUnitPorts ports.
  assert.deepEqual(
    r.diagnostics
      .filter((d) => d.code.startsWith("YP"))
      .map((d) => d.context)
      .sort(),
    [
      "compilerOptions.requireVariableDeclarations",
      "compilerOptions.someFutureFlag",
    ],
  );
  assert.ok(r.program);
  // ...and the mapped flag is carried, not dropped:
  const mapped = loadProject({
    project: {
      ...baseProject,
      compilerOptions: { allowPreviewFeatures: true },
    },
    fileSystem: memoryFs({ "a.yarn": "title: A\n---\n===\n" }),
  });
  assert.equal(
    mapped.project?.compilerOptions?.allowLanguagePreviewFeatures,
    true,
  );
  assert.equal(ypCodes(mapped.diagnostics).length, 0);
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
      "translations/German.csv":
        "id,text,file,node,lineNumber,lock,comment,metadata",
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
    loadProject({
      project: baseProject,
      fileSystem: memoryFs(files),
      strict: true,
    }),
  );
});

test("a listed source the provider cannot read is diagnosed", () => {
  const fs = memoryFs({ "a.yarn": "title: A\n---\n===\n" });
  const hostile: YarnProjectFileSystem = {
    listFiles: fs.listFiles,
    read: () => null,
  };
  const r = loadProject({ project: baseProject, fileSystem: hostile });
  assert.ok(codesOf(r.diagnostics).includes("YP0008"));
});

test("severity precedence: the host option merges per-code over the project's own map", () => {
  // YS0011 (duplicate node title, validate-level) is the toggled code: the
  // project's own map downgrades it to a warning; the host option layers
  // per-code (host wins, most specific). The same merge the companion
  // plugin documents — now pinned at the loader, where the layering lives.
  const files = {
    "a.yarn": "title: A\n---\nLine\n===\n",
    "b.yarn": "title: A\n---\nLine\n===\n", // duplicate node title
  };
  const fs = memoryFs(files);
  const base = {
    projectFileVersion: 4,
    sourceFiles: ["**/*.yarn"],
    baseLanguage: "en",
  };
  const code = (d: { code: string; severity: string }) =>
    `${d.code}:${d.severity}`;

  // No host layer: the project's downgrade holds — a warning, not an error.
  const alone = loadProject({
    project: {
      ...base,
      compilerOptions: { diagnosticsSeverity: { YS0011: "warning" } },
    },
    fileSystem: fs,
  });
  assert.ok(
    alone.diagnostics
      .filter((d) => d.code === "YS0011")
      .every((d) => code(d) === "YS0011:warning"),
    "project's own downgrade applies on its own",
  );

  // Host layer re-escalates the shared code: per-code merge, host wins —
  // not the project map winning wholesale.
  const escalated = loadProject({
    project: {
      ...base,
      compilerOptions: { diagnosticsSeverity: { YS0011: "warning" } },
    },
    fileSystem: fs,
    diagnosticsSeverity: { YS0011: "error" },
  });
  assert.ok(
    escalated.diagnostics.some((d) => code(d) === "YS0011:error"),
    "host entry wins per-code over the project map",
  );

  // Merged maps compose per-code: the project's entry for YS0011 survives
  // while the host's entry for YS0033 applies alongside it. (The fixture's
  // duplicate-title pair emits YS0011 only — the upstream emission pattern;
  // YS0031 is reserved for mixed groups — so an empty node carries the
  // host's entry instead.)
  const merged = loadProject({
    project: {
      ...base,
      compilerOptions: { diagnosticsSeverity: { YS0011: "warning" } },
    },
    fileSystem: memoryFs({ ...files, "c.yarn": "title: C\n---\n===\n" }),
    diagnosticsSeverity: { YS0033: "none" },
  });
  assert.ok(
    merged.diagnostics.some((d) => code(d) === "YS0011:warning"),
    "project entry survives the merge",
  );
  assert.ok(
    merged.diagnostics.some((d) => code(d) === "YS0033:none"),
    "host entry applies alongside it",
  );

  // The host layer also reaches codes the project never mentions: a
  // downgrade for a project-error code holds when the project carries no map.
  const downgraded = loadProject({
    project: base,
    fileSystem: fs,
    diagnosticsSeverity: { YS0011: "warning" },
  });
  assert.ok(downgraded.diagnostics.some((d) => code(d) === "YS0011:warning"));
});

// ── Node provider + the vendored Space fixture (acceptance) ───────────────

test("nodeProjectFs enumerates files (skipping node_modules) with POSIX-relative paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "yp-nodefs-"));
  try {
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(
      join(dir, "node_modules", "junk.yarn"),
      "title: J\n---\n===\n",
    );
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

test("acceptance: the upstream Space project (submodule) loads, compiles, and diagnoses its unlisted German.csv", () => {
  const r = loadYarnProject(
    join(UPSTREAM_TESTS_DIR, "Projects", "Space", "Space.yarnproject"),
  );
  assert.deepEqual(ypCodes(r.diagnostics), ["YP0006"]);
  assert.deepEqual(r.sources, ["Sally.yarn", "Ship.yarn"]);
  assert.ok(r.program);
  assert.equal(r.project?.baseLanguage, "en");
  assert.equal(r.project?.localisation?.de?.strings, "../German.csv");
});

test("loadYarnProject on a missing project file is a collected YP0001, not a throw", () => {
  const r = loadYarnProject(
    join(UPSTREAM_TESTS_DIR, "Projects", "Space", "Nope.yarnproject"),
  );
  assert.deepEqual(ypCodes(r.diagnostics), ["YP0001"]);
  assert.equal(r.program, null);
  assert.equal(r.project, null);
});
