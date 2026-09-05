// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 05 — expression fidelity against upstream 3.2.2
 * (YarnSpinnerParser.g4 `expression` rule):
 *
 * - comparison binds TIGHTER than equality (upstream `expComparison` sits
 *   below `expEquality` in the ANTLR precedence ladder), so `$a == $b < $c`
 *   parses `$a == ($b < $c)`;
 * - string literals honor `\"` and `\\` escapes (upstream lexer STRING:
 *   `'"' (~('"'|'\\'|'\r'|'\n') | '\\' ('"'|'\\'))* '"'`);
 * - malformed `when:` header expressions are compile diagnostics
 *   (upstream: header_when_expression is a grammar rule — `when: foo bar`
 *   never parses), while `always`/`once`/`once if expr` spellings stay
 *   accepted;
 * - the runtime evaluator's `not`/`!` prefix binds tighter than arithmetic,
 *   agreeing with the checker's tree (`not 0 + 1` ≡ `(!0) + 1`).
 *
 * The `=`/`===`/`!==` and case-insensitive keyword tolerance is a recorded
 * upstream divergence (ADR 0005; docs/compatibility.md).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../compile/compileSource.js";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";
import { ExpressionEvaluator } from "../runtime/evaluator.js";
import { InMemoryVariableStorage } from "../runtime/variableStorage.js";

const node = (content: string): string => `title: Start\n---\n${content}\n===\n`;

const drain = runUntilCompleteEvents;

// ── comparison above equality ────────────────────────────────────────────────

test("$a == $b < $c parses comparison-tighter (upstream precedence ladder)", () => {
  // Upstream tree: $a == ($b < $c). With $a=false, $b=1, $c=0: the inner
  // comparison is false, so `false == false` is TRUE. The merged-level tree
  // ($a == $b) < $c would evaluate (false == 1) < 0 → false — the trees
  // differ observably. ($a is declared bool so the equality's operand
  // types are legal — Bool == Bool.)
  const source = node(
    '<<declare $a = false>>\n<<declare $b = 1>>\n<<declare $c = 0>>\n<<if $a == $b < $c>>\nUpstream tree\n<<else>>\nMerged tree\n<<endif>>',
  );
  const dialogue = new Dialogue(compileOk(source));
  const events = drain(dialogue);
  const lines = events.filter((e) => e.type === "line").map((e) => (e as { text: string }).text);
  assert.deepEqual(lines, ["Upstream tree"]);
});

test("the checker's tree and the runtime result agree on the upstream tree", () => {
  // The compiled bytecode must encode the upstream tree: the comparison's
  // operands are $b and $c (lessThan), then equalTo against $a. Inspect via
  // the program's instructions — the public compile seam's program.
  const { program } = compileSource(
    node('<<declare $a = false>>\n<<declare $b = 1>>\n<<declare $c = 0>>\n<<if $a == $b < $c>>\nX\n<<endif>>'),
  );
  const ops = JSON.stringify(program);
  // lessThan must be emitted BEFORE equalTo (postfix: inner comparison first)
  const lessAt = ops.indexOf('"op":"lessThan"');
  const eqAt = ops.indexOf('"op":"equalTo"');
  assert.ok(lessAt !== -1 && eqAt !== -1, ops);
  assert.ok(lessAt < eqAt, `comparison must compile below equality: ${ops}`);
});

// ── string escapes ───────────────────────────────────────────────────────────

test('<<set $x to "a\\"b">> compiles and evaluates (upstream STRING escapes)', () => {
  const dialogue = new Dialogue(compileOk(node('<<set $x to "a\\"b">>\n{ $x }')));
  const events = drain(dialogue);
  const text = events.filter((e) => e.type === "line").map((e) => (e as { text: string }).text);
  assert.deepEqual(text, ['a"b']);
});

test("escaped backslash in a string literal evaluates (upstream \\\\ escape)", () => {
  const dialogue = new Dialogue(compileOk(node('<<set $x to "a\\\\b">>\n{ $x }')));
  const events = drain(dialogue);
  const text = events.filter((e) => e.type === "line").map((e) => (e as { text: string }).text);
  assert.deepEqual(text, ["a\\b"]);
});

// ── when: validation ─────────────────────────────────────────────────────────

test("when: foo bar is a compile diagnostic (upstream: header_when_expression must parse)", () => {
  const { diagnostics } = compileSource("title: Start\nwhen: foo bar\n---\nLine one\n===\n");
  // The fork keeps the program observable on error diagnostics (the
  // recorded divergence); the YS0005 error is the contract.
  assert.ok(
    diagnostics.some((d) => d.code === "YS0005" && d.severity === "error"),
    JSON.stringify(diagnostics),
  );
});

test("when: $x && (dangling operator) is a compile diagnostic", () => {
  const { diagnostics } = compileSource("title: Start\nwhen: $x &&\n---\nLine one\n===\n");
  assert.ok(diagnostics.some((d) => d.code === "YS0005" && d.severity === "error"), JSON.stringify(diagnostics));
});

test("when: always / once / once if expr / valid expressions stay accepted", () => {
  for (const when of ["always", "once", "once if $flag", "$flag", "$a == $b"]) {
    const source = `title: Start\nwhen: ${when}\n---\nLine one\n===\n`;
    const { program, diagnostics } = compileSource(source);
    assert.ok(program, `${when}: ${JSON.stringify(diagnostics)}`);
    assert.ok(!diagnostics.some((d) => d.severity === "error"), `${when}: ${JSON.stringify(diagnostics)}`);
  }
});

// ── runtime not-precedence agrees with the checker's tree ────────────────────

test("runtime not 0 + 1 equals (!0) + 1 (prefix binds tighter than arithmetic)", () => {
  const ev = new ExpressionEvaluator(new InMemoryVariableStorage());
  // (!0) + 1 — truthy number, not the negation of (0 + 1)
  assert.equal(ev.evaluate("not 0 + 1"), true);
  assert.equal(ev.evaluate("!0 + 1"), true);
  // and the bare negation shape still works
  assert.equal(ev.evaluate("not 0"), true);
  assert.equal(ev.evaluate("not 1"), false);
  assert.equal(ev.evaluate("!1 && true"), false);
});

// ── recorded divergence: = / === / !== tolerance ────────────────────────────

test("the tolerated equality spellings still evaluate (ADR 0005, recorded divergence)", () => {
  const ev = new ExpressionEvaluator(new InMemoryVariableStorage());
  assert.equal(ev.evaluate("1 = 1"), true);
  assert.equal(ev.evaluate("1 === 1"), true);
  assert.equal(ev.evaluate("1 !== 2"), true);
  const { program } = compileSource(node("<<if 1 = 1>>\nX\n<<endif>>"));
  assert.ok(program);
});
