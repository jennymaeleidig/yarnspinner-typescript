// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 01 regression: `<<set $x= 1>>` (no whitespace before `=`)
 * is valid upstream input — the upstream lexer hands the attached `=` to the
 * set_statement's OPERATOR_ASSIGNMENT — and must assign exactly like the
 * spaced form. The port's state-statement grammar used to demand `\s+`
 * before `=`, so the statement failed to parse, the compiler kept the raw
 * command (`runCommand "set $x= 1"`), the variable was never assigned, and
 * no diagnostic was raised: silent wrong behavior on valid input.
 *
 * Seams: the compiled instruction stream (compileSource().program) and the
 * runtime event stream + variable storage.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../compile/compileSource.js";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";

const drain = runUntilCompleteEvents;

test("<<set $x= 1>> compiles to the identical program as the spaced form", () => {
  const attached = compileSource("title: Start\n---\n<<set $x= 1>>\n===");
  const spaced = compileSource("title: Start\n---\n<<set $x = 1>>\n===");
  assert.ok(
    !attached.diagnostics.some((d) => d.severity === "error"),
    `attached form must compile clean, got ${JSON.stringify(attached.diagnostics)}`,
  );
  assert.ok(
    !spaced.diagnostics.some((d) => d.severity === "error"),
    `spaced form must compile clean, got ${JSON.stringify(spaced.diagnostics)}`,
  );
  assert.deepEqual(
    attached.program,
    spaced.program,
    "the attached form must compile to the identical program artifact as the spaced form",
  );
});

test("<<set $x= 1>> assigns at runtime", () => {
  const dialogue = new Dialogue(compileOk("title: Start\n---\n<<set $x= 1>>\n{ $x }\n==="));
  const events = drain(dialogue);
  const text = events.filter((e) => e.type === "line").map((e) => (e as { text: string }).text);
  assert.deepEqual(text, ["1"]);
  assert.equal(dialogue.getVariable("x"), 1);
});

test("<<set $x=1>> (fully attached) assigns too", () => {
  const dialogue = new Dialogue(compileOk("title: Start\n---\n<<set $x=1>>\n==="));
  drain(dialogue);
  assert.equal(dialogue.getVariable("x"), 1);
});

test("every compound operator accepts the attached-variable spelling", () => {
  const cases: Array<[string, string, number]> = [
    ["+=", "1", 6],
    ["-=", "1", 4],
    ["*=", "2", 10],
    ["/=", "2", 2.5],
    ["%=", "2", 1],
  ];
  for (const [op, rhs, expected] of cases) {
    const dialogue = new Dialogue(
      compileOk(`title: Start\n---\n<<declare $n = 5>>\n<<set $n${op}${rhs}>>\n===`),
    );
    drain(dialogue);
    assert.equal(dialogue.getVariable("n"), expected, `attached $n${op}${rhs}`);
  }
});

test("a set-shaped statement that cannot lower raises a diagnostic, not silence", () => {
  // `==` is not an upstream assignment operator: `set $x == 1` would fail to
  // parse upstream (YS0005). The port must surface the failure too — never
  // silently fall through to a generic command.
  const { diagnostics } = compileSource("title: Start\n---\n<<set $x == 1>>\n===");
  assert.ok(
    diagnostics.some((d) => d.code === "YS0005" && d.severity === "error"),
    `expected a YS0005 error for <<set $x == 1>>, got ${JSON.stringify(diagnostics)}`,
  );
});

test("set with a malformed value expression raises YS0005 (no silent command)", () => {
  const { diagnostics } = compileSource('title: Start\n---\n<<set $x = )garbage(>>\n===');
  assert.ok(
    diagnostics.some((d) => d.code === "YS0005" && d.severity === "error"),
    `expected a YS0005 error, got ${JSON.stringify(diagnostics)}`,
  );
});

test("the identifier/operator boundary stays intact (set $xto 1 is not set $x to 1)", () => {
  // `set $xto 1` fails upstream's lexer (VAR_ID $xto, then no operator);
  // the tightened grammar must not mis-read it as `set $x to 1`.
  const { diagnostics } = compileSource("title: Start\n---\n<<set $xto 1>>\n===");
  assert.ok(
    diagnostics.some((d) => d.severity === "error"),
    `expected an error for <<set $xto 1>>, got ${JSON.stringify(diagnostics)}`,
  );
});
