// SPDX-License-Identifier: CC0-1.0
/**
 * ParseFailures validation wave (ticket 54): the compiler-side validations
 * whose absence let 12 upstream must-fail fixtures compile clean.
 *
 * Expectations are SOURCED, not hand-copied (upstream-submodule ticket 06):
 * the corpus-level must-fail contract stays exactly upstream's ("has
 * errors" — upstream-conformance.test.ts), and here every emitted
 * diagnostic is cross-checked against the submodule's per-code Definitions
 * registry — the code must exist upstream, and its severity must equal the
 * definition's defaultSeverity. Exact message texts are deliberately not
 * asserted: upstream's registry carries codes, severities, and example
 * scripts, never messages, so a hand-copied message pin would be a
 * stricter-than-upstream invention that drifts at every bump.
 *
 * Tests go through the public compile seam only (coding standards §6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../index.js";
import type { CompileResult } from "../compile/compileSource.js";
import { loadDiagnosticDefinitions } from "./upstream/diagnosticDefinitions.js";

/** The submodule's per-code registry, keyed by code. */
const DEFINITIONS = new Map(loadDiagnosticDefinitions().map((d) => [d.code, d]));

function codesOf(result: CompileResult): string[] {
  return result.diagnostics.map((d) => d.code);
}

function errorCodesOf(result: CompileResult): string[] {
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
}

/**
 * Cross-check every emitted diagnostic against the Definitions registry
 * (ticket 06): the code must exist in the submodule's registry, and an
 * emitted severity must equal the definition's defaultSeverity. An emitted
 * code upstream does not define — or a severity that drifts from the
 * registry — fails here.
 */
function checkAgainstDefinitions(result: CompileResult): void {
  for (const d of result.diagnostics) {
    const def = DEFINITIONS.get(d.code);
    assert.ok(def, `emitted ${d.code} has no upstream Definitions entry`);
    if (def.defaultSeverity) {
      assert.equal(
        d.severity,
        def.defaultSeverity,
        `${d.code} severity drifts from the Definitions registry`,
      );
    }
  }
}

/** Pin the emitted error codes exactly, then run the registry cross-check. */
function assertCodes(result: CompileResult, expectedErrorCodes: string[]): void {
  assert.deepEqual(errorCodesOf(result), expectedErrorCodes);
  checkAgainstDefinitions(result);
}

/** No errors — and any diagnostics present still match the registry. */
function assertClean(result: CompileResult): void {
  assertCodes(result, []);
}

// --- Newlines not permitted in commands (YS0006 UnclosedCommand) ------------

test("a command opened but not closed on its line is YS0006", () => {
  const result = compileSource("title: Start\n---\n<<command \n===\n");
  assertCodes(result, ["YS0006"]);
});

test("a closed command with a trailing comment still compiles clean", () => {
  const result = compileSource('title: Start\n---\n<<set $x = 1>> // noted\nDone.\n===\n');
  assertClean(result);
});

// --- <<declare>>/<<set>> must have a value (YS0006 / YS0005) ----------------

test("<<declare>> without a value is YS0006 (upstream reports the unclosed command)", () => {
  const result = compileSource("title: Start\n---\n<<declare $variable>>\n===\n");
  assertCodes(result, ["YS0006"]);
});

test("<<set>> without an operator is YS0006", () => {
  const result = compileSource("title: Start\n---\n<<set $x>>\n===\n");
  assertCodes(result, ["YS0006"]);
});

test("<<set>> with an operator but no value is YS0005", () => {
  const result = compileSource("title: Start\n---\n<<set $x = >>\n===\n");
  assertCodes(result, ["YS0005"]);
});

test("tightened shapes report the same codes as spaced ones", () => {
  // No whitespace before the operator.
  assertCodes(compileSource("title: Start\n---\n<<declare $x=>>\n===\n"), ["YS0005"]);
  assertCodes(compileSource("title: Start\n---\n<<set $x=>>\n===\n"), ["YS0005"]);
  // `as` clause without a value, and bare keywords.
  assertCodes(compileSource("title: Start\n---\n<<declare $x as Num>>\n===\n"), ["YS0006"]);
  assertCodes(compileSource("title: Start\n---\n<<set>>\n===\n"), ["YS0006"]);
  assertCodes(compileSource("title: Start\n---\n<<declare>>\n===\n"), ["YS0006"]);
});

test("<<declare>> with a value compiles clean", () => {
  const result = compileSource("title: Start\n---\n<<declare $x = 1>>\nDone.\n===\n");
  assertClean(result);
});

// --- Indentation following options (YS0005) ---------------------------------

test("an indented whitespace-only line directly after an option is YS0005", () => {
  const result = compileSource("title: Start\n---\n-> option 1\n            \n===\n");
  assertCodes(result, ["YS0005"]);
});

test("an indented whitespace-only line directly after a line-group item is YS0005", () => {
  const result = compileSource("title: Start\n---\n=> alt one\n   \ntext after\n===\n");
  assertCodes(result, ["YS0005"]);
});

test("a plain blank line after an option still compiles clean", () => {
  const result = compileSource("title: Start\n---\n-> option 1\n\nMore text.\n===\n");
  assertClean(result);
});

test("an indented blank line inside an option body (after content) compiles clean", () => {
  const result = compileSource("title: Start\n---\n-> opt\n    body text\n   \nmore text\n===\n");
  assertClean(result);
});

// --- when: headers must have an expression (YS0005) --------------------------

test("a when: header without an expression is YS0005", () => {
  const result = compileSource("title: NodeGroup\nwhen:\n---\nText.\n===\n");
  assertCodes(result, ["YS0005"]);
});

test("when: headers with expressions and when: always still compile clean", () => {
  const withExpr = compileSource("title: Group\nwhen: $flag\n---\nText.\n===\n");
  assertClean(withExpr);
  const always = compileSource("title: Group\nwhen: always\n---\nText.\n===\n");
  assertClean(always);
});

// --- Jump-target expressions must be strings (YS0050) ------------------------

test("a jump to a number-typed expression is YS0050", () => {
  const result = compileSource(
    "title: Start\n---\n<<declare $myDestination = 5>>\n<<jump {$myDestination}>>\n===\n",
  );
  assertCodes(result, ["YS0050"]);
});

test("jump targets that resolve to strings compile clean", () => {
  const literal = compileSource("title: Start\n---\n<<jump {\"Other\"}>>\n===\ntitle: Other\n---\nHi.\n===\n");
  assertClean(literal);
  const stringVar = compileSource(
    'title: Start\n---\n<<declare $dest = "Other">>\n<<jump {$dest}>>\n===\ntitle: Other\n---\nHi.\n===\n',
  );
  assertClean(stringVar);
});

// --- Operator typing (YS0050) ------------------------------------------------

test("'+' with bool operands is YS0050", () => {
  const result = compileSource("title: Start\n---\n<<set $a = true + false>>\n===\n");
  assertCodes(result, ["YS0050"]);
});

test("arithmetic operators with non-number operands are YS0050", () => {
  const result = compileSource('title: Start\n---\n<<set $a = 1 - true>>\n===\n');
  assertCodes(result, ["YS0050"]);
  const strDiv = compileSource('title: Start\n---\n<<set $a = "x" / 2>>\n===\n');
  assertCodes(strDiv, ["YS0050"]);
});

test("numbers and strings may be used with '+'", () => {
  const result = compileSource('title: Start\n---\n<<declare $s = "a">>\n<<set $n = 1 + 2>>\n<<set $t = $s + "b">>\n===\n');
  assertClean(result);
});

// --- Assignment type conflicts (YS0050) ---------------------------------------

test("assigning a Number to a Bool variable is YS0050", () => {
  const result = compileSource("title: Start\n---\n<<declare $a = true>>\n<<set $a = 1>>\n===\n");
  assertCodes(result, ["YS0050"]);
});

test("assigning a matching type compiles clean", () => {
  const result = compileSource("title: Start\n---\n<<declare $a = true>>\n<<set $a = false>>\n===\n");
  assertClean(result);
});

// --- Type inference (YS0029 / YS0014 / YS0050) --------------------------------

test("a set whose variable and value are both untypeable is YS0029", () => {
  const result = compileSource("title: Start\n---\n<<set $a = somefunc()>>\n===\n");
  // Both the value expression and the set target stay undetermined — two
  // YS0029 emissions (upstream reports each unresolved expression).
  assertCodes(result, ["YS0029", "YS0029"]);
});

test("an implicit function's return type is pinned by its first typed use", () => {
  const result = compileSource(
    "title: Start\n---\n<<declare $a = 1>>\n<<declare $b = true>>\n\n<<set $a = somefunc()>>\n<<set $b = somefunc()>>\n===\n",
  );
  assertCodes(result, ["YS0050"]);
});

test("an implicit function called with inconsistent arity is YS0014", () => {
  const result = compileSource(
    "title: Start\n---\n<<declare $a = 1>>\n\n<<set $a = somefunc(1)>>\n<<set $a = somefunc(1,2)>>\n===\n",
  );
  assert.ok(result.diagnostics.some((d) => d.code === "YS0014"), `expected YS0014, got ${codesOf(result)}`);
  checkAgainstDefinitions(result);
});

test("an undeclared variable used only in a line is YS0029", () => {
  const result = compileSource("title: Start\n---\nHere's a variable: {$myVar}\n===\n");
  assertCodes(result, ["YS0029"]);
});

test("comparison of two unknown variables stays unresolved (upstream imposes no base type)", () => {
  // Upstream's ExitExpComparison only requires identical operand types —
  // it does not constrain them to Number, so both stay unknown and the
  // inline line use still reports YS0029 (regression guard against an
  // ungoverned Number fallback).
  const result = compileSource("title: Start\n---\n<<if $a < $b>>\nBig: {$a}\n<<endif>>\n===\n");
  assertCodes(result, ["YS0029"]);
});

test("a variable typed elsewhere resolves for line use", () => {
  const declared = compileSource("title: Start\n---\n<<declare $myVar = 1>>\nHere: {$myVar}\n===\n");
  assertClean(declared);
  const setFirst = compileSource("title: Start\n---\n<<set $x = 1>>\nHere: {$x}\n===\n");
  assertClean(setFirst);
});

test("an unknown jump target variable is constrained to String, not an error", () => {
  const result = compileSource("title: Start\n---\n<<jump {$dest}>>\n===\n");
  assertClean(result);
});

// --- Parity-completeness items (no vendored fixture covers these) -------------

test("a bare <<call>> is a YS0005 (upstream's grammar requires a call expression)", () => {
  const result = compileSource("title: Start\n---\n<<call>>\n===\n");
  assertCodes(result, ["YS0005"]);
});

test("<<call>> with a bare identifier but no call expression is YS0006", () => {
  const result = compileSource("title: Start\n---\n<<call foo>>\n===\n");
  assertCodes(result, ["YS0006"]);
});

test("<<call>> with a call expression compiles clean", () => {
  const result = compileSource("title: Start\n---\n<<call foo()>>\n===\n");
  assertClean(result);
});

test("a trailing /// after a declaration becomes its description (upstream allowCommentsAfter)", () => {
  const result = compileSource("title: Start\n---\n/// preceding docs\n<<declare $x = 1>> /// trailing docs\n{ $x }\n===\n");
  assertClean(result);
  const decl = result.declarations.find((d) => d.name === "x");
  assert.ok(decl, "declaration recorded");
  assert.equal(decl.description, "trailing docs");
});
