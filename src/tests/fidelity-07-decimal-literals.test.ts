// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 07 bonus (verified finding) — the runtime evaluator's
 * number literals. Upstream NUMBER is INT('.'INT)? (no sign — unary minus
 * is parseUnary's job; no exponent), so a decimal literal that doesn't
 * round-trip through String() still resolves: the old
 * `expr.trim() === String(num)` check rejected "1.0" (String(1) is "1"),
 * which composed {1.0/3} as 0.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ExpressionEvaluator } from "../runtime/evaluator.js";
import { InMemoryVariableStorage } from "../runtime/variableStorage.js";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";

test("a non-round-tripping decimal literal resolves (1.0)", () => {
  const ev = new ExpressionEvaluator(new InMemoryVariableStorage());
  // evaluate() is the boolean-condition seam; tryEvaluateExpression is the
  // raw-value seam the {…} composition and fallback sets use.
  const raw = (e: string): unknown => (ev.tryEvaluateExpression(e) as { ok: true; value: unknown }).value;
  assert.equal(raw("1.0"), 1);
  assert.equal(raw("1.0 / 3") as number > 0.3, true);
  assert.equal(raw("0.5"), 0.5);
});

test("integers still resolve, and non-numbers still fail", () => {
  const ev = new ExpressionEvaluator(new InMemoryVariableStorage());
  const raw = (e: string): unknown => (ev.tryEvaluateExpression(e) as { ok: true; value: unknown }).value;
  assert.equal(raw("42"), 42);
  assert.equal(raw("007"), 7);
  // No exponent in upstream NUMBER: "1e3" is not a literal — the
  // evaluation fails (out-of-band undefined here, the historical
  // soften-to-undefined contract).
  assert.equal(raw("1e3"), undefined);
});

test("{1.0/3} composes a nonzero value end-to-end", () => {
  const source = `title: Start\n---\nx {1.0/3}\n===\n`;
  const dialogue = new Dialogue(compileOk(source));
  const lines = runUntilCompleteEvents(dialogue)
    .filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line")
    .map((e) => e.text.trim());
  assert.ok(lines[0].startsWith("x 0.3"), lines.join("; "));
});