/**
 * ParseFailures validation wave (ticket 54): the compiler-side validations
 * whose absence let 12 vendored upstream must-fail fixtures compile clean.
 *
 * Each test pins the exact upstream YS-code from the vendored per-code
 * registry (test/fixtures/upstream/YarnSpinner/Diagnostics/Definitions/);
 * codes and message shapes were verified against the upstream v3.2.2
 * compiler itself (coding standards §1: upstream is the source of truth).
 * The fixture-level assertion lives in upstream-conformance.test.ts, whose
 * MUST_FAIL_ALLOWLIST self-cleaned as these validations landed.
 *
 * Tests go through the public compile seam only (coding standards §6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../index.js";
import type { CompileResult } from "../compile/compileSource.js";

function codesOf(result: CompileResult): string[] {
  return result.diagnostics.map((d) => d.code);
}

function errorsOf(result: CompileResult): string[] {
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.message}`);
}

// --- Newlines not permitted in commands (YS0006 UnclosedCommand) ------------

test("a command opened but not closed on its line is YS0006", () => {
  const result = compileSource("title: Start\n---\n<<command \n===\n");
  assert.deepEqual(errorsOf(result), ["YS0006: Unclosed command: missing >>"]);
});

test("a closed command with a trailing comment still compiles clean", () => {
  const result = compileSource('title: Start\n---\n<<set $x = 1>> // noted\nDone.\n===\n');
  assert.deepEqual(codesOf(result).filter((c) => c === "YS0006"), []);
});

// --- <<declare>>/<<set>> must have a value (YS0006 / YS0005) ----------------

test("<<declare>> without a value is YS0006 (upstream reports the unclosed command)", () => {
  const result = compileSource("title: Start\n---\n<<declare $variable>>\n===\n");
  assert.deepEqual(errorsOf(result), ["YS0006: Unclosed command: missing >>"]);
});

test("<<set>> without an operator is YS0006", () => {
  const result = compileSource("title: Start\n---\n<<set $x>>\n===\n");
  assert.deepEqual(errorsOf(result), ["YS0006: Unclosed command: missing >>"]);
});

test("<<set>> with an operator but no value is YS0005", () => {
  const result = compileSource("title: Start\n---\n<<set $x = >>\n===\n");
  assert.deepEqual(errorsOf(result), ['YS0005: Syntax error: Unexpected ">>" while reading an expression']);
});

test("tightened shapes report the same codes as spaced ones", () => {
  // No whitespace before the operator.
  assert.deepEqual(
    errorsOf(compileSource("title: Start\n---\n<<declare $x=>>\n===\n")),
    ["YS0005: Syntax error: Unexpected \">>\" while reading an expression"],
  );
  assert.deepEqual(
    errorsOf(compileSource("title: Start\n---\n<<set $x=>>\n===\n")),
    ["YS0005: Syntax error: Unexpected \">>\" while reading an expression"],
  );
  // `as` clause without a value, and bare keywords.
  assert.deepEqual(errorsOf(compileSource("title: Start\n---\n<<declare $x as Num>>\n===\n")), [
    "YS0006: Unclosed command: missing >>",
  ]);
  assert.deepEqual(errorsOf(compileSource("title: Start\n---\n<<set>>\n===\n")), [
    "YS0006: Unclosed command: missing >>",
  ]);
  assert.deepEqual(errorsOf(compileSource("title: Start\n---\n<<declare>>\n===\n")), [
    "YS0006: Unclosed command: missing >>",
  ]);
});

test("<<declare>> with a value compiles clean", () => {
  const result = compileSource("title: Start\n---\n<<declare $x = 1>>\nDone.\n===\n");
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
});

// --- Indentation following options (YS0005) ---------------------------------

test("an indented whitespace-only line directly after an option is YS0005", () => {
  const result = compileSource("title: Start\n---\n-> option 1\n            \n===\n");
  assert.equal(codesOf(result).filter((c) => c === "YS0005").length, 1);
});

test("an indented whitespace-only line directly after a line-group item is YS0005", () => {
  const result = compileSource("title: Start\n---\n=> alt one\n   \ntext after\n===\n");
  assert.equal(codesOf(result).filter((c) => c === "YS0005").length, 1);
});

test("a plain blank line after an option still compiles clean", () => {
  const result = compileSource("title: Start\n---\n-> option 1\n\nMore text.\n===\n");
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
});

test("an indented blank line inside an option body (after content) compiles clean", () => {
  const result = compileSource("title: Start\n---\n-> opt\n    body text\n   \nmore text\n===\n");
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
});

// --- when: headers must have an expression (YS0005) --------------------------

test("a when: header without an expression is YS0005", () => {
  const result = compileSource("title: NodeGroup\nwhen:\n---\nText.\n===\n");
  assert.equal(codesOf(result).filter((c) => c === "YS0005").length, 1);
});

test("when: headers with expressions and when: always still compile clean", () => {
  const withExpr = compileSource("title: Group\nwhen: $flag\n---\nText.\n===\n");
  assert.deepEqual(withExpr.diagnostics.filter((d) => d.severity === "error"), []);
  const always = compileSource("title: Group\nwhen: always\n---\nText.\n===\n");
  assert.deepEqual(always.diagnostics.filter((d) => d.severity === "error"), []);
});

// --- Jump-target expressions must be strings (YS0050) ------------------------

test("a jump to a number-typed expression is YS0050", () => {
  const result = compileSource(
    "title: Start\n---\n<<declare $myDestination = 5>>\n<<jump {$myDestination}>>\n===\n",
  );
  assert.deepEqual(errorsOf(result), [
    "YS0050: jump statement's expression must be convertible to String, but Number is not",
  ]);
});

test("jump targets that resolve to strings compile clean", () => {
  const literal = compileSource("title: Start\n---\n<<jump {\"Other\"}>>\n===\ntitle: Other\n---\nHi.\n===\n");
  assert.deepEqual(literal.diagnostics.filter((d) => d.severity === "error"), []);
  const stringVar = compileSource(
    'title: Start\n---\n<<declare $dest = "Other">>\n<<jump {$dest}>>\n===\ntitle: Other\n---\nHi.\n===\n',
  );
  assert.deepEqual(stringVar.diagnostics.filter((d) => d.severity === "error"), []);
});

// --- Operator typing (YS0050) ------------------------------------------------

test("'+' with bool operands is YS0050", () => {
  const result = compileSource("title: Start\n---\n<<set $a = true + false>>\n===\n");
  assert.deepEqual(errorsOf(result), ["YS0050: Operation '+' can't be used with a value of type Bool"]);
});

test("arithmetic operators with non-number operands are YS0050", () => {
  const result = compileSource('title: Start\n---\n<<set $a = 1 - true>>\n===\n');
  assert.deepEqual(errorsOf(result), ["YS0050: Operation '-' can't be used with a value of type Bool"]);
  const strDiv = compileSource('title: Start\n---\n<<set $a = "x" / 2>>\n===\n');
  assert.deepEqual(errorsOf(strDiv), ["YS0050: Operation '/' can't be used with a value of type String"]);
});

test("numbers and strings may be used with '+'", () => {
  const result = compileSource('title: Start\n---\n<<declare $s = "a">>\n<<set $n = 1 + 2>>\n<<set $t = $s + "b">>\n===\n');
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
});

// --- Assignment type conflicts (YS0050) ---------------------------------------

test("assigning a Number to a Bool variable is YS0050", () => {
  const result = compileSource("title: Start\n---\n<<declare $a = true>>\n<<set $a = 1>>\n===\n");
  assert.deepEqual(errorsOf(result), ["YS0050: $a (Bool) cannot be assigned a Number"]);
});

test("assigning a matching type compiles clean", () => {
  const result = compileSource("title: Start\n---\n<<declare $a = true>>\n<<set $a = false>>\n===\n");
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
});

// --- Type inference (YS0029 / YS0014 / YS0050) --------------------------------

test("a set whose variable and value are both untypeable is YS0029", () => {
  const result = compileSource("title: Start\n---\n<<set $a = somefunc()>>\n===\n");
  const inference = result.diagnostics.filter((d) => d.code === "YS0029").map((d) => d.message);
  assert.deepEqual(inference, [
    "Can't determine the type of the expression somefunc().",
    "Can't determine the type of the expression $a.",
  ]);
});

test("an implicit function's return type is pinned by its first typed use", () => {
  const result = compileSource(
    "title: Start\n---\n<<declare $a = 1>>\n<<declare $b = true>>\n\n<<set $a = somefunc()>>\n<<set $b = somefunc()>>\n===\n",
  );
  assert.deepEqual(errorsOf(result), ["YS0050: $b (Bool) cannot be assigned a Number"]);
});

test("an implicit function called with inconsistent arity is YS0014", () => {
  const result = compileSource(
    "title: Start\n---\n<<declare $a = 1>>\n\n<<set $a = somefunc(1)>>\n<<set $a = somefunc(1,2)>>\n===\n",
  );
  const wrong = result.diagnostics.find((d) => d.code === "YS0014");
  assert.ok(wrong, `expected YS0014, got ${JSON.stringify(errorsOf(result))}`);
  assert.equal(
    wrong.message,
    "Invalid function call: somefunc was called elsewhere with 1 parameter, but is called with 2 parameters here",
  );
});

test("an undeclared variable used only in a line is YS0029", () => {
  const result = compileSource("title: Start\n---\nHere's a variable: {$myVar}\n===\n");
  assert.deepEqual(errorsOf(result), ["YS0029: Can't determine the type of the expression $myVar."]);
});

test("comparison of two unknown variables stays unresolved (upstream imposes no base type)", () => {
  // Upstream's ExitExpComparison only requires identical operand types —
  // it does not constrain them to Number, so both stay unknown and the
  // inline line use still reports YS0029 (regression guard against an
  // ungoverned Number fallback).
  const result = compileSource("title: Start\n---\n<<if $a < $b>>\nBig: {$a}\n<<endif>>\n===\n");
  assert.deepEqual(errorsOf(result), ["YS0029: Can't determine the type of the expression $a."]);
});

test("a variable typed elsewhere resolves for line use", () => {
  const declared = compileSource("title: Start\n---\n<<declare $myVar = 1>>\nHere: {$myVar}\n===\n");
  assert.deepEqual(declared.diagnostics.filter((d) => d.severity === "error"), []);
  const setFirst = compileSource("title: Start\n---\n<<set $x = 1>>\nHere: {$x}\n===\n");
  assert.deepEqual(setFirst.diagnostics.filter((d) => d.severity === "error"), []);
});

test("an unknown jump target variable is constrained to String, not an error", () => {
  const result = compileSource("title: Start\n---\n<<jump {$dest}>>\n===\n");
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
});

// --- Parity-completeness items (no vendored fixture covers these) -------------

test("a bare <<call>> is a YS0005 (upstream's grammar requires a call expression)", () => {
  const result = compileSource("title: Start\n---\n<<call>>\n===\n");
  assert.equal(codesOf(result).filter((c) => c === "YS0005").length, 1);
});

test("<<call>> with a bare identifier but no call expression is YS0006", () => {
  const result = compileSource("title: Start\n---\n<<call foo>>\n===\n");
  assert.deepEqual(errorsOf(result), ["YS0006: Unclosed command: missing >>"]);
});

test("<<call>> with a call expression compiles clean", () => {
  const result = compileSource("title: Start\n---\n<<call foo()>>\n===\n");
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
});

test("a trailing /// after a declaration becomes its description (upstream allowCommentsAfter)", () => {
  const result = compileSource("title: Start\n---\n/// preceding docs\n<<declare $x = 1>> /// trailing docs\n{ $x }\n===\n");
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
  const decl = result.declarations.find((d) => d.name === "x");
  assert.ok(decl, "declaration recorded");
  assert.equal(decl.description, "trailing docs");
});
