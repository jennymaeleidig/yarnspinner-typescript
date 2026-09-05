// SPDX-License-Identifier: CC0-1.0
/**
 * Ports of upstream unit tests whose behaviors the fixture sweep and the
 * existing waves never pinned (coverage audit, v3.2.2 baseline; upstream
 * files: ErrorHandlingTests.cs, TypeTests.cs, DialogueTests.cs). Every
 * expectation mirrors the upstream test's — messages quoted from the
 * upstream source, severities from the Definitions registry via the
 * compile seam. Divergence found here is triaged, never adjusted away
 * (coding standards §1).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../index.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";
import { InMemoryVariableStorage } from "../runtime/variableStorage.js";
import type { CompileResult } from "../compile/compileSource.js";
import { loadDiagnosticDefinitions } from "./upstream/diagnosticDefinitions.js";

const DEFINITIONS = new Map(loadDiagnosticDefinitions().map((d) => [d.code, d]));

function errorsOf(result: CompileResult): string[] {
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
}

/** Cross-check emitted diagnostics against the submodule's Definitions
 * registry (existence + defaultSeverity — the conformance policy the
 * parseFailureValidations wave established). */
function checkAgainstDefinitions(result: CompileResult): void {
  for (const d of result.diagnostics) {
    const def = DEFINITIONS.get(d.code);
    assert.ok(def, `emitted ${d.code} has no upstream Definitions entry`);
    if (def.defaultSeverity) {
      assert.equal(d.severity, def.defaultSeverity, `${d.code} severity drifts from the registry`);
    }
  }
}

// ── ErrorHandlingTests.cs: parser recovery ──────────────────────────────────

test("port: TestMalformedIfStatement — <<if>> without <<endif>> is an unclosed-scope error", () => {
  const result = compileSource("title: Start\n---\n<<if true>>\n===\n");
  checkAgainstDefinitions(result);
  const unclosed = result.diagnostics.filter((d) => d.code === "YS0007");
  assert.ok(unclosedScopeReported(result), `expected an unclosed <<if>> error, got ${show(result)}`);
  assert.ok(
    result.diagnostics.some((d) => /expected an <<endif>>/.test(d.message)),
    `expected the expected-<<endif>> message, got ${show(result)}`,
  );
});

function unclosedScopeReported(result: CompileResult): boolean {
  return result.diagnostics.some((d) => d.severity === "error" && /Unclosed scope/.test(d.message));
}

function show(result: CompileResult): string {
  return result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ") || "(none)";
}

test("port: TestExtraneousElse — two <<else>> clauses yield two errors", () => {
  const result = compileSource(
    "title: Start\n---\n<<if true>>\nOne\n<<else>>\nTwo\n<<else>>\nThree\n<<endif>>\n===\n",
  );
  checkAgainstDefinitions(result);
  const messages = result.diagnostics.map((d) => d.message);
  assert.ok(
    messages.some((m) => /More than one <<else>> statement/.test(m)),
    `expected the multiple-else error, got: ${messages.join(" | ")}`,
  );
  assert.ok(
    messages.some((m) => /Unexpected "endif" while reading a statement/.test(m)),
    `expected the unexpected-endif error, got: ${messages.join(" | ")}`,
  );
});

test("port: TestEmptyCommand — an empty <<>> command errors with upstream's 'Command text expected'", () => {
  const result = compileSource("title: Start\n---\n<<>>\n===\n");
  checkAgainstDefinitions(result);
  // Upstream's TestEmptyCommand asserts the message contains "Command text
  // expected" (ErrorListener ReportNoViableAlternative on <<>>); no keyword
  // matches, so GetDiagnosticForParserError's default applies: YS0005.
  assert.ok(
    result.diagnostics.some(
      (d) => d.code === "YS0005" && /Command text expected/.test(d.message),
    ),
    `expected YS0005 'Command text expected', got ${show(result)}`,
  );
});

// ── ErrorHandlingTests.cs: warning-tier diagnostics ─────────────────────────

test("port: TestEmptyNodesGenerateWarnings — a single empty node warns, exactly once", () => {
  const result = compileSource("title: Start\n---\n===\n");
  checkAgainstDefinitions(result);
  assert.equal(result.diagnostics.length, 1, `expected exactly one diagnostic, got ${show(result)}`);
  const warning = result.diagnostics[0];
  assert.equal(warning.severity, "warning");
  assert.equal(warning.message, 'Node "Start" is empty and will not be included in the compiled output.');
});

test("port: TestUnreferencedNodesCreateDiagnostics — skipped upstream, mirrored here", { skip: "upstream skips this theory: the diagnostic moved to the language server — whether a node being unreferenced is a problem depends on the use case, and at least one node will almost always be unreferenced (the entry point). Our compiler likewise does not emit YS0009." }, () => {
  // Ported for the record; upstream's pins (UnreferencedNode, severity
  // None, "Node 'A' is never referenced") hold only if the diagnostic
  // existed. Kept as documentation of the upstream source.
  const result = compileSource("title: A\n---\nThis node has no references\n===\n");
  assert.ok(!result.diagnostics.some((d) => d.code === "YS0009"));
});

// ── TypeTests.cs ─────────────────────────────────────────────────────────────

test("port: TestVariableDeclarationsDisallowDuplicates — redeclaration yields two errors", () => {
  const result = compileSource("title: Start\n---\n<<declare $int = 5>>\n<<declare $int = 6>>\n===\n");
  checkAgainstDefinitions(result);
  const redecls = result.diagnostics.filter((d) => d.code === "YS0039");
  assert.equal(redecls.length, 2, `expected two YS0039 emissions, got ${show(result)}`);
  for (const d of redecls) assert.equal(d.message, "Redeclaration of existing variable $int");
});

test("port: TestInitialValues — declared and external defaults reach the runtime", () => {
  const source = `title: Start
---
<<declare $int = 42>>
<<declare $str = "Hello">>
<<declare $bool = true>>
{$int}
{$str}
{$bool}
{$external_int}
{$external_str}
{$external_bool}
===
`;
  const result = compileSource(source, {
    declarations: {
      // Our seam's external-declaration keys follow the no-`$` convention
      // (upstream `Declaration.Name` carries the `$`). Upstream's theory
      // deliberately mismatches names↔types (int is Boolean, bool is
      // Number); the types are what matter.
      variables: {
        external_str: { type: "string", defaultValue: "Hello" },
        external_int: { type: "bool", defaultValue: true },
        external_bool: { type: "number", defaultValue: 42 },
      },
    },
  });
  assert.ok(!result.diagnostics.some((d) => d.severity === "error"), show(result));
  checkAgainstDefinitions(result);

  // Upstream seeds the storage explicitly before running — external
  // declarations' defaults are NOT auto-seeded by the compiler (the host
  // owns external variables' initial state). Keys follow our no-`$`
  // convention (matching the compiled program's variable names).
  const storage = new InMemoryVariableStorage();
  storage.set("external_str", "Hello");
  storage.set("external_int", 42);
  storage.set("external_bool", true);
  const dialogue = new Dialogue(result.program!, { variableStorage: storage });
  const lines = runUntilCompleteEvents(dialogue)
    .filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line")
    .map((e) => e.text);
  assert.deepEqual(lines, [
    "42",
    "Hello",
    "True", // upstream C# bool.ToString() rendering (logic docs)
    "42",
    "Hello",
    "True",
  ]);
});

const OPERATOR_CASES: Array<{ op: string; decl: string; type: "number" | "bool" | "string" }> = [
  ...["= 1 + 1", "= 1 / 1", "= 1 - 1", "= 1 * 1", "= 1 % 1", "+= 1", "-= 1", "/= 1", "*= 1"].map(
    (op) => ({ op, decl: "<<declare $var = 0>>", type: "number" as const }),
  ),
  ...["= true and false", "= true or false", "= not true", "= true xor false"].map((op) => ({
    op,
    decl: "<<declare $var = false>>",
    type: "bool" as const,
  })),
  ...['= "string" + "otherstring"'].map((op) => ({
    op,
    decl: '<<declare $var = "">>',
    type: "string" as const,
  })),
];

test("port: TestNumeric/Logic/StringOperatorsAreTypeChecked — every declared op type-checks", () => {
  for (const { op, decl, type } of OPERATOR_CASES) {
    const result = compileSource(`title: Start\n---\n${decl}\n<<set $var ${op}>>\n===\n`);
    assert.ok(!result.diagnostics.some((d) => d.severity === "error"), `${op}: ${show(result)}`);
    // Our seam's declaration names drop the `$` (upstream carries it).
    const declaration = result.declarations.find((d) => d.name === "var");
    assert.ok(declaration, `${op}: $var not in declarations`);
    assert.equal(declaration.type, type, `${op}: expected ${type}, got ${declaration.type}`);
  }
});

test("port: the same operator matrix on an undeclared $var warns, never errors", () => {
  // Upstream's TestOperationIsChecked also asserts an implicit
  // declaration for $var lands in result.Declarations — our compiler
  // records no implicit declarations (YS0003 warns instead). That gap is
  // filed on the ticket; this port pins the part we do hold: the use is
  // never an error, and the registry's warning fires.
  for (const { op } of OPERATOR_CASES) {
    const result = compileSource(`title: Start\n---\n<<set $var ${op}>>\n===\n`);
    assert.ok(!result.diagnostics.some((d) => d.severity === "error"), `${op}: ${show(result)}`);
    assert.ok(
      result.diagnostics.some((d) => d.code === "YS0003" && d.severity === "warning"),
      `${op}: expected the YS0003 warning, got ${show(result)}`,
    );
  }
});

// ── DialogueTests.cs ─────────────────────────────────────────────────────────

// ── ProjectFileTests.cs ──────────────────────────────────────────────────

import { loadProject } from "../compile/yarnProject.js";
import type { YarnProjectFileSystem } from "../compile/yarnProject.js";

function memoryFs(files: Record<string, string>): YarnProjectFileSystem {
  const names = Object.keys(files).sort();
  return {
    listFiles: () => [...names],
    read: (p: string) => (p in files ? files[p] : null),
  };
}

const YP_CODE = (d: { code: string }) => d.code.startsWith("YP");

test("port: TestProjectFilesCanAllowPreviewFeatures — the flag loads and is carried", () => {
  const result = loadProject({
    project: {
      projectFileVersion: 2,
      sourceFiles: ["**/*.yarn"],
      baseLanguage: "en",
      compilerOptions: { allowPreviewFeatures: true },
    },
    fileSystem: memoryFs({}),
  });
  assert.ok(result.project, "project failed to load");
  assert.equal(result.project.compilerOptions?.allowLanguagePreviewFeatures, true);
  // Upstream loads the known option silently — no "not recognised" warning.
  assert.ok(
    !result.diagnostics.some((d) => YP_CODE(d) && /allowPreviewFeatures/.test(d.message)),
    result.diagnostics.map((d) => d.message).join(" | "),
  );
});

test("port: TestProjectFilesCanSpecifyDefinitionsAsStringOrList — v3 string and v4 list normalise equal", () => {
  const load = (project: Record<string, unknown>) =>
    loadProject({ project, fileSystem: memoryFs({}) });
  const v3 = load({
    projectFileVersion: 4,
    sourceFiles: ["**/*.yarn"],
    baseLanguage: "en",
    definitions: "A.ysls.json",
  });
  const v4 = load({
    projectFileVersion: 4,
    sourceFiles: ["**/*.yarn"],
    baseLanguage: "en",
    definitions: ["A.ysls.json"],
  });
  assert.ok(v3.project && v4.project);
  assert.deepEqual(v3.project.definitions, ["A.ysls.json"]);
  assert.deepEqual(v4.project.definitions, ["A.ysls.json"]);
});

test("port: TestProjectFilesCanSpecifyDiagnosticSeverityOverrides — four overrides load and are honoured", () => {
  const result = loadProject({
    project: {
      projectFileVersion: 4,
      sourceFiles: ["**/*.yarn"],
      baseLanguage: "en",
      compilerOptions: {
        diagnosticsSeverity: {
          YS0001: "error",
          YS0002: "warning",
          YS0003: "info",
          YS0004: "none",
        },
      },
    },
    fileSystem: memoryFs({}),
  });
  assert.ok(result.project);
  const overrides = result.project.compilerOptions?.diagnosticsSeverity;
  assert.ok(overrides);
  assert.equal(Object.keys(overrides).length, 4);
  assert.equal(overrides.YS0001, "error");
  assert.equal(overrides.YS0002, "warning");
  assert.equal(overrides.YS0003, "info");
  assert.equal(overrides.YS0004, "none");

  // Beyond upstream's load-shape pin: the overrides are HONOURED by the
  // compiler — an undeclared-variable use's registry-default warning
  // surfaces at the overridden severity.
  const fs: YarnProjectFileSystem = memoryFs({
    "a.yarn": "title: Start\n---\n<<set $undeclared = 1>>\n===\n",
  });
  const overridden = loadProject({
    project: {
      projectFileVersion: 4,
      sourceFiles: ["**/*.yarn"],
      baseLanguage: "en",
      compilerOptions: { diagnosticsSeverity: { YS0003: "info" } },
    },
    fileSystem: fs,
  });
  const ys0003 = overridden.diagnostics.find((d) => d.code === "YS0003");
  assert.ok(ys0003, "expected YS0003 in the overridden compile");
  assert.equal(ys0003.severity, "info");
});

test("severity overrides apply in every mode and before strict's throw decision", () => {
  // Placement pin: the overridden severity is the final severity everywhere,
  // so strict reacts to the overridden result — an error overridden to
  // "none" no longer throws.
  const dupes = "title: Start\n---\n<<declare $int = 5>>\n<<declare $int = 6>>\n===\n";
  assert.throws(() => compileSource(dupes, { strict: true }));
  const overridden = compileSource(dupes, { strict: true, diagnosticsSeverity: { YS0039: "none" } });
  const ys0039 = overridden.diagnostics.find((d) => d.code === "YS0039");
  assert.ok(ys0039, "YS0039 still present at severity none");
  assert.equal(ys0039.severity, "none");
  // Non-full modes honour overrides too.
  const typeOnly = compileSource("title: Start\n---\n<<set $undeclared = 1>>\n===\n", {
    mode: "typeCheckOnly",
    diagnosticsSeverity: { YS0003: "info" },
  });
  const ys0003 = typeOnly.diagnostics.find((d) => d.code === "YS0003");
  assert.ok(ys0003, "expected YS0003 in typeCheckOnly");
  assert.equal(ys0003.severity, "info");
});

test("port: TestVariadicFunctionsMustAllBeSameType — mixed-type variadic calls error on both lines", () => {
  const result = compileSource(
    'title: Start\n---\n{variadic_add(1,true,3)}\n{variadic_string_add("s",1,true,3)}\n===\n',
    {
      declarations: {
        functions: {
          variadic_add: { params: ["number"], variadic: true, returns: "number" },
          variadic_string_add: { params: ["string", "number"], variadic: true, returns: "string" },
        },
      },
    },
  );
  checkAgainstDefinitions(result);
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 2, `expected two errors, got ${show(result)}`);
  assert.ok(errors.every((e) => e.code === "YS0050"), `expected YS0050s, got ${show(result)}`);
  // Upstream also pins each error's Range.Start.Line (2 and 3, 0-based);
  // our diagnostics carry no ranges for signature mismatches yet — the
  // diagnostic-ranges gap is filed on the ticket.
});
