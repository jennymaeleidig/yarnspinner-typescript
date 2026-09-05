// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 02: line-group (`=>`) item bodies.
 *
 * Upstream grammar (`YarnSpinnerParser.g4` line_group_item, v3.2.2):
 * `line_group_item : '=>' line_statement (INDENT statement* DEDENT)?` —
 * an indented body under an item belongs to that item, and
 * `CodeGenerationVisitor.VisitLine_group_statement` lowers each item's
 * child statements inside the selected item's region (after the RunLine,
 * before the jump to the group's end). The body therefore runs only when
 * its item is selected — never as an unconditional top-level sibling.
 *
 * Regression (2025-09-04 fidelity review H2): the parser ended the group
 * at the first non-`=>` statement, orphaning the body as a top-level
 * sibling that ran regardless of selection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { compileSource, Dialogue } from "../index.js";
import { runUntilCompleteEvents } from "../index.js";
import type { DialogueEvent } from "../index.js";

/** Compile a source, asserting it compiles clean. */
function compile(source: string) {
  const { program, diagnostics } = compileSource(source);
  assert.ok(
    program,
    `compilation failed: ${diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`,
  );
  return program;
}

/** Run a dialogue to completion; return line texts and command texts. */
function run(
  source: string,
  configure?: (d: Dialogue) => void,
): { lines: string[]; commands: string[] } {
  const dialogue = new Dialogue(compile(source));
  configure?.(dialogue);
  const lines: string[] = [];
  const commands: string[] = [];
  for (const event of runUntilCompleteEvents(dialogue) as DialogueEvent[]) {
    if (event.type === "line") lines.push(event.text);
    if (event.type === "command") commands.push(event.command);
  }
  return { lines, commands };
}

test("line-group item body does not run when its item is unselected", () => {
  // The only item's condition fails; the whole group (body included) skips.
  const source = `title: Start
---
<<declare $pies = 0>>
=> specific <<if $pies > 0>>
    specific body
===
`;
  const { lines, commands } = run(source, (d) =>
    d.setSaliencyStrategy("best_least_recently_seen"),
  );
  assert.deepEqual(lines, []);
  assert.deepEqual(commands, []);
});

test("line-group item body runs with the selected item", () => {
  const source = `title: Start
---
<<declare $pies = 0>>
=> generic
    generic body
=> specific <<if $pies > 0>>
    specific body
===
`;
  // Both items pass; the conditional item wins under BLRV (complexity 1
  // beats 0). Only the selected item's body follows its line.
  const dialogue = new Dialogue(compile(source), { variables: { pies: 1 } });
  dialogue.setSaliencyStrategy("best_least_recently_seen");
  const lines: string[] = [];
  for (const event of runUntilCompleteEvents(dialogue)) {
    if (event.type === "line") lines.push(event.text);
  }
  assert.deepEqual(lines, ["specific", "specific body"]);
});

test("line-group item body: each selection outcome runs only its own body", () => {
  const source = `title: Start
---
<<declare $pies = 0>>
=> generic
    generic body
=> specific <<if $pies > 0>>
    specific body
===
`;
  // Only the generic item passes → generic + its body, never the
  // conditional item's body.
  const dialogue = new Dialogue(compile(source), { variables: { pies: 0 } });
  dialogue.setSaliencyStrategy("best_least_recently_seen");
  const lines: string[] = [];
  for (const event of runUntilCompleteEvents(dialogue)) {
    if (event.type === "line") lines.push(event.text);
  }
  assert.deepEqual(lines, ["generic", "generic body"]);
});

test("line-group item body commands run on selection", () => {
  const source = `title: Start
---
<<declare $seen = 0>>
=> chosen <<once>>
    <<set $seen = 1>>
    body line
===
`;
  const dialogue = new Dialogue(compile(source));
  dialogue.setSaliencyStrategy("first");
  const lines: string[] = [];
  for (const event of runUntilCompleteEvents(dialogue)) {
    if (event.type === "line") lines.push(event.text);
  }
  // State commands never surface as events (their effect does): the body's
  // `<<set>>` ran exactly when the item was selected — the item's own line
  // and its body's line delivered in order.
  assert.deepEqual(lines, ["chosen", "body line"]);
  assert.equal(dialogue.getVariable("seen"), 1);
});

test("line-group item body lines register in the string table", () => {
  const source = `title: Start
---
<<declare $pies = 0>>
=> generic
    generic body
=> specific <<if $pies > 0>>
    specific body
===
`;
  const { program, stringTable } = compileSource(source);
  assert.ok(program);
  assert.ok(stringTable);
  const texts = new Set(
    Object.values(stringTable)
      .map((info) => info.text)
      .filter((t): t is string => t !== null),
  );
  assert.ok(texts.has("generic"), "group item line missing from string table");
  assert.ok(
    texts.has("generic body"),
    "item body line missing from string table",
  );
  assert.ok(
    texts.has("specific"),
    "conditional item line missing from string table",
  );
  assert.ok(
    texts.has("specific body"),
    "conditional item body line missing from string table",
  );
  // Registration order is document order (upstream's parse-tree visit): an
  // item's body registers right after its item, before the next item. The
  // running count seeds every implicit ID, so order is observable.
  const order = Object.values(stringTable)
    .map((info) => info.text)
    .filter((t): t is string => t !== null);
  assert.deepEqual(
    order.filter((t) =>
      ["generic", "generic body", "specific", "specific body"].includes(t),
    ),
    ["generic", "generic body", "specific", "specific body"],
  );
});
