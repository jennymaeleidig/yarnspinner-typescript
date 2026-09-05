// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 06 — unicode identifiers per upstream's IDENTIFIER ranges
 * (YarnSpinnerLexer.g4 IDENTIFIER_HEAD / IDENTIFIER_CHARACTER, transcribed
 * into the shared `src/parse/identifier.ts` classes):
 *
 * - header KEYS accept the full upstream ID ranges (`跳线: 1` parses with
 *   its value);
 * - variable names assign and read in conditions (`$生命`);
 * - enum case names compile and resolve (`Color.红色`);
 * - node titles lex/parse as upstream header values — while the
 *   title/subtitle YS0027 generated-name validation keeps its recorded
 *   ASCII simplification (docs/compatibility.md), per the ticket's
 *   "acceptance is lexical only" boundary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource, parseYarn } from "../index.js";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";

const node = (content: string): string => `title: Start\n---\n${content}\n===\n`;

function drainLines(dialogue: Dialogue): string[] {
  return runUntilCompleteEvents(dialogue)
    .filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line" && !!e.text.trim())
    .map((e) => e.text.trim());
}

// ── header keys ──────────────────────────────────────────────────────────────

test("a non-ASCII header key parses with its value (跳线: 1)", () => {
  const source = `title: Start\n跳线: 1\n---\nHello\n===\n`;
  const doc = parseYarn(source);
  assert.equal(doc.nodes[0].headers["跳线"], "1");
  // The header rides through the compile seam untouched (headers other
  // than the known ones are not diagnostics).
  const result = compileSource(source);
  assert.deepEqual(
    result.diagnostics.map((d) => d.code),
    [],
  );
});

// ── variable names ───────────────────────────────────────────────────────────

test("a non-ASCII variable assigns and reads in conditions", () => {
  const dialogue = new Dialogue(
    compileOk(
      node("<<set $生命 to 5>>\n<<if $生命 > 3>>\nAlive\n<<else>>\nGone\n<<endif>>"),
    ),
  );
  assert.deepEqual(drainLines(dialogue), ["Alive"]);
});

test("a non-ASCII variable name in an inline expression composes", () => {
  const dialogue = new Dialogue(
    compileOk(node("<<set $生命 to 41>>\nIt is { $生命 + 1 }")),
  );
  assert.deepEqual(drainLines(dialogue), ["It is 42"]);
});

// ── enum case names ──────────────────────────────────────────────────────────

test("a non-ASCII enum case compiles and resolves (Color.红色)", () => {
  const source = node(
    '<<enum Color>>\n    <<case 红色 = 1>>\n<<endenum>>\n<<declare $favourite = Color.红色 as Color>>\n<<if $favourite == Color.红色>>\nRed\n<<else>>\nNot red\n<<endif>>',
  );
  const result = compileSource(source);
  assert.deepEqual(
    result.diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`),
    [],
  );
  const color = result.userDefinedTypes.find((t) => t.name === "Color");
  assert.ok(color, "Color enum registered");
  assert.deepEqual(
    color.cases.map((c) => [c.name, c.rawValue]),
    [["红色", 1]],
  );
  const dialogue = new Dialogue(result.program!);
  assert.deepEqual(drainLines(dialogue), ["Red"]);
});

test("non-ASCII `.Case` shorthand resolves through the checker's rewrite", () => {
  // The checker rewrites resolvable shorthand to the full form before
  // lowering (ADR 0004); a unicode case name must resolve too.
  const source = node(
    '<<enum Color>>\n    <<case 红色 = 1>>\n<<endenum>>\n<<declare $favourite = Color.红色 as Color>>\n<<if $favourite == .红色>>\nRed\n<<else>>\nNot red\n<<endif>>',
  );
  const dialogue = new Dialogue(compileOk(source));
  assert.deepEqual(drainLines(dialogue), ["Red"]);
});

// ── node titles ──────────────────────────────────────────────────────────────

test("a non-ASCII node title lexes/parses (lexical acceptance)", () => {
  const doc = parseYarn(`title: 跳线\n---\nHello\n===\n`);
  assert.equal(doc.nodes[0].title, "跳线");
});

test("title/subtitle YS0027 keeps the recorded ASCII simplification", () => {
  // Ticket 06 boundary: title/subtitle header VALUES keep the documented
  // ASCII-simplification rule for generated names (docs/compatibility.md) —
  // acceptance is lexical only; the YS0027 pass is untouched.
  const result = compileSource(`title: 跳线\n---\nHello\n===\n`);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ["YS0027"]);
});