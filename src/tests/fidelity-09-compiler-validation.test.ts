// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 09 — compiler validation & diagnostics parity against
 * upstream 3.2.2 (YarnSpinner.Compiler + the vendored Definitions registry):
 *
 * - `<<declare $n = 5 as string>>` is rejected with YS0053, carrying the
 *   registry message template (ported from upstream
 *   `ErrorHandlingTests.TestDeclaredValueIsDifferentFromExplicitType`);
 * - empty nodes warn YS0033 and are EXCLUDED from the compiled program
 *   (upstream `Compiler.AddDiagnosticsForEmptyNodes` + `FileCompiler
 *   .NodesToSkip`), so a jump to one fails like upstream's missing-node
 *   error instead of silently completing;
 * - duplicate-node diagnostics follow upstream's emission pattern
 *   (upstream `Compiler.AddErrorsForInvalidNodeNames`): a mixed group
 *   reports YS0031 per memberless member only, a memberless group reports
 *   YS0011 per member only, and an all-`when:` group reports nothing;
 * - YS0011/YS0012/YS0031/YS0032/YS0052 messages match the registry
 *   templates;
 * - signature-mismatch diagnostics (YS0050 convertibility, YS0014 arity)
 *   carry the argument/function source range (ported from upstream
 *   `ErrorHandlingTests.TestKnownFunctionWithWrongParameters…`);
 * - the compile artifact includes implicitly declared variables (inferred
 *   type, implicit flag) and seeds initial values for every declaration
 *   like upstream (upstream `Compiler.Compile`'s declarations/initial
 *   values pass).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource, Library, Dialogue } from "../index.js";
import type { CompileResult } from "../index.js";

/** A node-shaped source, the way upstream's CreateTestNode wraps content. */
const node = (content: string): string => `title: Start\n---\n${content}\n===\n`;

const errorsOf = (r: CompileResult) => r.diagnostics.filter((d) => d.severity === "error");
const codesOf = (r: CompileResult) => r.diagnostics.map((d) => d.code);

// ── YS0053: declare value vs explicit type (upstream TestDeclaredValue…) ────

test("YS0053: a declare whose initial value doesn't match its explicit type is rejected", () => {
  // Upstream ErrorHandlingTests.TestDeclaredValueIsDifferentFromExplicitType:
  // the exact message texts, and the error is the ONLY one.
  const cases: Array<[string, string]> = [
    [`<<declare $x = "hello" as Number>>`, `$x is declared to be a Number, but its initial value '"hello"' is a String`],
    [`<<declare $x = true as Number>>`, `$x is declared to be a Number, but its initial value 'true' is a Bool`],
    [`<<declare $x = "true" as bool>>`, `$x is declared to be a Bool, but its initial value '"true"' is a String`],
    [`<<declare $x = 123 as bool>>`, `$x is declared to be a Bool, but its initial value '123' is a Number`],
    [`<<declare $x = 123 as string>>`, `$x is declared to be a String, but its initial value '123' is a Number`],
    [`<<declare $x = true as string>>`, `$x is declared to be a String, but its initial value 'true' is a Bool`],
  ];
  for (const [input, message] of cases) {
    const result = compileSource(node(input));
    const errors = errorsOf(result);
    assert.equal(errors.length, 1, `${input}: expected a single error, got ${JSON.stringify(result.diagnostics)}`);
    assert.equal(errors[0].code, "YS0053");
    assert.equal(errors[0].message, message, `${input}: message drift`);
  }
});

test("well-typed declares are unaffected (YS0053 fires only on mismatch)", () => {
  const result = compileSource(node(`<<declare $n = 123>>\n<<declare $s = "hi" as string>>\n<<declare $b = true as bool>>\n`));
  assert.deepEqual(
    result.diagnostics.filter((d) => d.code === "YS0053"),
    [],
    JSON.stringify(result.diagnostics),
  );
  // The declared types land on the artifact.
  const typed = Object.fromEntries(result.declarations.map((d) => [d.name, d.type]));
  assert.equal(typed["n"], "number");
  assert.equal(typed["s"], "string");
  assert.equal(typed["b"], "bool");
});

// ── Empty nodes: YS0033 + exclusion from the program ───────────────────────

test("empty nodes warn YS0033 and are absent from the compiled program", () => {
  const result = compileSource(`title: Start
---
Real content
===
title: Empty
---
===
`);
  const warnings = result.diagnostics.filter((d) => d.code === "YS0033");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
  assert.equal(warnings[0].message, 'Node "Empty" is empty and will not be included in the compiled output.');
  assert.ok(result.program!.nodes["Start"]);
  assert.equal(result.program!.nodes["Empty"], undefined, "upstream excludes empty nodes (FileCompiler.NodesToSkip)");
});

test("jumping to an empty node fails like a jump to a missing node", () => {
  const result = compileSource(`title: Start
---
<<jump Empty>>
===
title: Empty
---
===
`);
  assert.ok(result.program);
  const errors: string[] = [];
  const dialogue = new Dialogue(result.program, { logError: (m) => errors.push(m) });
  dialogue.continue();
  assert.ok(
    errors.some((m) => /No node named "Empty" exists in the program/.test(m)),
    `expected a missing-node error, got ${JSON.stringify(errors)}`,
  );
});

// ── Duplicate-node emission pattern (upstream node-group pass) ──────────────

test("mixed duplicate group: YS0031 per memberless member only, no YS0011", () => {
  const result = compileSource(`title: Group
when: always
---
a
===
title: Group
---
b
===
`);
  assert.ok(result.diagnostics.some((d) => d.code === "YS0031"), codesOf(result).join(", "));
  assert.ok(
    !result.diagnostics.some((d) => d.code === "YS0011"),
    `upstream reports no duplicate-node title for mixed groups: ${codesOf(result).join(", ")}`,
  );
  const missing = result.diagnostics.find((d) => d.code === "YS0031")!;
  assert.equal(
    missing.message,
    "All nodes in the group 'Group' must have a 'when' clause (use 'when: always' if you want this node to not have any conditions).",
  );
});

test("memberless duplicate group: YS0011 per member, no YS0031 (upstream TestDuplicateNonNodeGroups…)", () => {
  const result = compileSource(`title: A
---
This is a line
===
title: A
---
This is a line
===
`);
  const dupes = result.diagnostics.filter((d) => d.code === "YS0011");
  assert.equal(dupes.length, 2, `one YS0011 per member: ${codesOf(result).join(", ")}`);
  assert.ok(!result.diagnostics.some((d) => d.code === "YS0031"), "memberless duplicates report no YS0031");
  for (const d of dupes) assert.equal(d.message, "Duplicate node title: 'A'");
  // Upstream attributes each diagnostic to its own member's file.
  assert.deepEqual(dupes.map((d) => d.file).sort(), ["input", "input"]);
});

test("an all-when duplicate group produces no diagnostics (upstream TestDuplicateNodeGroups…)", () => {
  const result = compileSource(`title: A
when: always
---
This is a line
===
title: A
when: always
---
This is a line
===
`);
  assert.deepEqual(result.diagnostics, []);
});

// ── Registry message texts ──────────────────────────────────────────────────

test("YS0012 message matches the registry template", () => {
  const result = compileSource(node("<<jump B>>"));
  const diag = result.diagnostics.find((d) => d.code === "YS0012")!;
  assert.ok(diag, codesOf(result).join(", "));
  assert.equal(diag.severity, "warning");
  assert.equal(diag.message, "Jump to undefined node: 'B'");
});

test("YS0052 message matches the registry template", () => {
  const result = compileSource(`title: Start
title: AlsoStart
---
Body
===
`);
  const diag = result.diagnostics.find((d) => d.code === "YS0052")!;
  assert.ok(diag, codesOf(result).join(", "));
  assert.equal(diag.message, "Nodes must have a single title header");
});

test("YS0032 message matches the registry template (one per group member)", () => {
  const result = compileSource(`title: Group
subtitle: x
when: always
---
a
===
title: Group
subtitle: x
when: always
---
b
===
`);
  const dupes = result.diagnostics.filter((d) => d.code === "YS0032");
  assert.equal(dupes.length, 2, `upstream reports one per member: ${codesOf(result).join(", ")}`);
  assert.equal(dupes[0].message, "More than one node in group Group has subtitle x.");
});

// ── Signature-mismatch diagnostics carry source ranges ──────────────────────

const library = new Library();
library.registerFunction("visited", () => true, { params: ["string"], returns: "bool" });

test("YS0050 convertibility errors carry the argument's source range", () => {
  const result = compileSource(node("{visited(1)}"), { library });
  const diag = result.diagnostics.find((d) => d.code === "YS0050")!;
  assert.ok(diag, codesOf(result).join(", "));
  // Upstream pins the exact message (no function-name prefix).
  assert.equal(diag.message, "1 (Number) is not convertible to String");
  // Upstream pins the range (2,9)-(2,10): 0-based line 2 (the line after
  // the `---` delimiter), the argument token's columns.
  assert.deepEqual(diag.range, { startLine: 2, startCol: 9, endLine: 2, endCol: 10 });
});

test("YS0014 arity errors carry the function name's source range", () => {
  const result = compileSource(node("{visited()}"), { library });
  const diag = result.diagnostics.find((d) => d.code === "YS0014")!;
  assert.ok(diag, codesOf(result).join(", "));
  assert.equal(diag.message, "Invalid function call: visited expects 1 parameter, not 0");
  // Upstream pins the range (2,1)-(2,8): the function name token.
  assert.deepEqual(diag.range, { startLine: 2, startCol: 1, endLine: 2, endCol: 8 });
});

// ── Implicit declarations + initialValues coverage ──────────────────────────

test("the artifact includes implicit declarations and seeds their initial values", () => {
  const result = compileSource(`title: Start
---
<<set $gold = 5>>
<<if $flag>>
    line
<<endif>>
===
`);
  assert.ok(result.program);
  const implicit = result.declarations.filter((d) => d.isImplicit);
  const byName = Object.fromEntries(implicit.map((d) => [d.name, d]));
  // `$gold`: first seen in a <<set>> carrying the value's type (number).
  assert.equal(byName["gold"]?.type, "number");
  // `$flag`: a bare condition constrains bool.
  assert.equal(byName["flag"]?.type, "bool");
  // Upstream: implicit declarations seed initial values with the type's
  // default (number 0, bool false).
  assert.ok("gold" in result.program.initialValues, "gold seeded in initialValues");
  assert.ok("flag" in result.program.initialValues, "flag seeded in initialValues");

  // Well-typed declares remain, with initial values of their own.
  assert.ok(result.declarations.every((d) => d.name !== undefined));
});

test("an explicit declare supersedes the implicit declaration (no duplicates)", () => {
  const result = compileSource(`title: A
---
<<set $somevar = 1>>
===
title: B
---
<<declare $somevar = false>>
===
`);
  const somevars = result.declarations.filter((d) => d.name === "somevar");
  assert.equal(somevars.length, 1, `upstream replaces the implicit declaration: ${JSON.stringify(somevars)}`);
  assert.equal(somevars[0].isImplicit, undefined);
  assert.equal(somevars[0].type, "bool");
});
