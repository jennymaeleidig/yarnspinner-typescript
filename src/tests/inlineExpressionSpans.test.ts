// SPDX-License-Identifier: CC0-1.0
/**
 * The inline-expression span scanner's pins (deepening-wave-2 ticket 07).
 * The runtime composer (src/runtime/interpolate.ts) is the escape
 * contract's authority; the compile-side classifiers (markup validation's
 * blanking, string-table detection, the type checker's variable
 * collection) had drifted from it — skipping two chars after any
 * backslash where the runtime only escapes `\{` / `\}`. These pins state
 * the contract once; all four consumers inherit them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSubstitutions, inlineExpressionSpans } from "../runtime/interpolate.js";

const sources = (text: string) => inlineExpressionSpans(text).map((s) => s.source);

test("plain spans: one span per brace pair, non-overlapping", () => {
  assert.deepEqual(sources("Hello {$name} and {$other}!"), ["$name", "$other"]);
  assert.deepEqual(inlineExpressionSpans("{$x}"), [
    { start: 0, end: 4, source: "$x" },
  ]);
});

test("escaped braces never open a span", () => {
  assert.deepEqual(sources("\\{not an expr\\}"), []);
  assert.deepEqual(sources("a \\{ b {$x}"), ["$x"], "an escaped brace before a real span");
});

test("an escaped backslash does not escape the brace after it", () => {
  // `\\{expr}`: the runtime composes a literal backslash, then an escaped
  // brace — literal text, no span. The old compile-side scanners skipped
  // two chars after any backslash and classified this as a span.
  assert.deepEqual(sources("\\\\{expr}"), []);
  assert.deepEqual(sources("\\\\{$x} {$y}"), ["$y"]);
});

test("a backslash before anything else is literal — the span after it is real", () => {
  // The old blanking skipped two chars after *any* backslash; the runtime
  // composes `\x` literally and evaluates the following span.
  assert.deepEqual(sources("\\x{$x}"), ["$x"]);
});

test("unclosed braces compose literally — not spans", () => {
  assert.deepEqual(sources("{unclosed"), []);
  assert.deepEqual(sources("a { b"), []);
});

test("a span runs to the next `}` — braces are not balanced in expressions", () => {
  assert.deepEqual(sources('{"a}"}'), ['"a'], "a `}` inside a string literal closes the span");
  assert.deepEqual(sources("{a {b}"), ["a {b"], "the inner brace rides inside the outer span");
});

test("expandSubstitutions: evaluation, escapes, and composition agree with the pins", () => {
  assert.equal(expandSubstitutions("Hello {$name}!", () => "World"), "Hello World!");
  assert.equal(expandSubstitutions("\\{literal\\}", () => "never"), "{literal}");
  assert.equal(expandSubstitutions("\\\\{x}", () => "EVAL"), "\\{x}", "escaped backslash then escaped brace — literal text");
  assert.equal(expandSubstitutions("{unclosed", () => "EVAL"), "{unclosed");
  assert.equal(expandSubstitutions("{$fail} tail", () => ""), " tail", "a failing expression composes empty");
  assert.equal(expandSubstitutions("{x} \\{y} {z}", () => "V"), "V {y} V");
});