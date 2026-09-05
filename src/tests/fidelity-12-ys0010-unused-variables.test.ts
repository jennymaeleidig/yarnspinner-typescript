// SPDX-License-Identifier: CC0-1.0
/**
 * YS0010 UnusedVariable (ticket 12): the compile-end unused-declared-
 * variable analysis — a port of upstream's compile-end pass (Compiler.cs:
 * declarations never appearing in NodeMetadataVisitor's VariableReferences
 * report YS0010) and of its ErrorHandlingTests.cs pins
 * (TestUnusedDeclaredVarsGenerateDiagnostic +
 * TestUsedVariablesShouldntGenerateDiagnostic +
 * TestDiagnosticsCanHaveOverriddenSeverities's UnusedVariable row).
 *
 * Messages quoted from the upstream registry template
 * (Definitions/YS0010-UnusedVariable.md); severities from the registry via
 * the compile seam. Upstream's exact rule — verified against the vendored
 * 3.2.2 source: a `<<set>>` target IS a reference
 * (NodeMetadataVisitor.VisitSet_statement), so a declared-but-only-written
 * variable is used; the declared variable's own `<<declare>>` is not.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, compileSource } from "../index.js";
import type { CompileResult } from "../compile/compileSource.js";

function show(result: CompileResult): string {
  return result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ") || "(none)";
}

/** Upstream CreateTestNode: wrap a statement in a minimal node. */
function testNode(input: string): string {
  return `title: Start\n---\n${input}\n===`;
}

// ── ErrorHandlingTests.cs: TestUnusedDeclaredVarsGenerateDiagnostic ─────────

test("port: TestUnusedDeclaredVarsGenerateDiagnostic — a declared variable never read reports YS0010 (info)", () => {
  const cases = [
    { input: "<<declare $somevar = 123>>", varName: "$somevar" },
    { input: "<<declare $somevar = \"hello\">>", varName: "$somevar" },
    { input: "<<declare $somevar = false>>", varName: "$somevar" },
  ] as const;
  for (const { input, varName } of cases) {
    const result = compileSource(testNode(input));
    const diags = result.diagnostics;
    assert.equal(diags.length, 1, `expected exactly one diagnostic, got ${show(result)}`);
    const diag = diags[0];
    assert.equal(diag.code, "YS0010");
    assert.equal(diag.severity, "info");
    assert.equal(diag.message, `Variable '${varName}' is declared but never used`);
  }
});

// ── ErrorHandlingTests.cs: TestUsedVariablesShouldntGenerateDiagnostic ──────

test("port: TestUsedVariablesShouldntGenerateDiagnostic — read variables never report YS0010", () => {
  const cases = [
    // read in the node's `when:` header
    "title: A\nwhen: $somevar == true\n---\n<<declare $somevar = false>>\n===",
    // written by a <<set>> — upstream VisitSet_statement records the
    // assignment target as a reference, so set-only counts as used
    "title: A\n---\n<<declare $somevar = false>>\n<<set $somevar = true>>\n===",
    // read in an <<if>> condition
    "title: A\n---\n<<declare $somevar = false>>\n<<if $somevar>>\n    internal line\n<<endif>>\n===",
    // read in interpolation
    "title: A\n---\n<<declare $somevar = false>>\nthe value is {$somevar}\n===",
  ] as const;
  for (const input of cases) {
    const result = compileSource(input);
    const unused = result.diagnostics.filter((d) => d.code === "YS0010");
    assert.deepEqual(
      unused,
      [],
      `expected no YS0010, got ${show(result)}\nscript:\n${input}`,
    );
  }
});

// ── ErrorHandlingTests.cs: TestDiagnosticsCanHaveOverriddenSeverities ───────

test("port: TestDiagnosticsCanHaveOverriddenSeverities — YS0010's severity is overridable per code", () => {
  for (const severity of ["error", "warning", "info", "none"] as const) {
    const result = compileSource(testNode("<<declare $x = 1>>"), {
      diagnosticsSeverity: { YS0010: severity },
    });
    const diag = result.diagnostics.find((d) => d.code === "YS0010");
    assert.ok(diag, `expected a YS0010, got ${show(result)}`);
    assert.equal(diag.severity, severity, `override to ${severity} did not apply`);
  }
});

// ── The vendored definition's example is its own executable spec ────────────

test("YS0010's vendored example fires the diagnostic (only the unused $somevar)", () => {
  const script = `title: Start
---
<<declare $somevar = 123>>
<<declare $usedVar = true>>
===

title: Another
---
=> line that uses usedVar <<if $usedVar>>
===`;
  const result = compileSource(script);
  const unused = result.diagnostics.filter((d) => d.code === "YS0010");
  assert.equal(unused.length, 1, `expected YS0010 for $somevar only, got ${show(result)}`);
  assert.equal(unused[0].message, "Variable '$somevar' is declared but never used");
  assert.equal(unused[0].severity, "info");
});

// ── Exclusions the ticket's spec pins ───────────────────────────────────────

test("smart variables are excluded from the unused set (ticket spec)", () => {
  const result = compileSource(testNode("<<declare $smart = $other + 1>>"));
  assert.ok(
    !result.diagnostics.some((d) => d.code === "YS0010"),
    `a smart variable must not report YS0010, got ${show(result)}`,
  );
});

test("external declarations are excluded from the unused set (ticket spec)", () => {
  const result = compile([{ name: "input", source: testNode("the value is {$ext}") }], {
    declarations: { variables: { ext: { type: "number", defaultValue: 0 } } },
  });
  // A never-read external variable is also excluded — the host's variable
  // store is not the script's problem.
  const storeOnly = compile([{ name: "input", source: testNode("===") }], {
    declarations: { variables: { ghost: { type: "number", defaultValue: 0 } } },
  });
  assert.ok(!result.diagnostics.some((d) => d.code === "YS0010"), show(result));
  assert.ok(!storeOnly.diagnostics.some((d) => d.code === "YS0010"), show(storeOnly));
});