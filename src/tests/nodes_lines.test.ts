// SPDX-License-Identifier: CC0-1.0
import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

const lineOf = (event: DialogueEvent | undefined): Extract<DialogueEvent, { type: "line" }> | undefined =>
  event?.type === "line" ? event : undefined;

test("nodes and lines delivery", () => {
  const script = `
title: Start
---
Narrator: Line one
Narrator: Line two
===
`;

  const ir = compileOk(script);
  const dialogue = new Dialogue(ir, { startAt: "Start" });

  // Each continue() delivers the events up to the next stopping point: the
  // node-start rides along, the line stops the batch.
  const first = dialogue.continue();
  strictEqual(first[0].type, "nodeStart", "Expected the node-start event first");
  const line1 = lineOf(first[1]);
  ok(line1, "Expected a line event");
  strictEqual(line1.text.includes("Line one"), true, "Expected 'Line one'");

  const second = dialogue.continue();
  const line2 = lineOf(second[0]);
  ok(line2, "Expected a line event");
  strictEqual(line2.text.includes("Line two"), true, "Expected 'Line two'");

  const third = dialogue.continue();
  strictEqual(third[third.length - 1].type, "dialogueComplete", "Expected dialogue completion");
});

test("markup parsing propagates to runtime", () => {
  const script = `
title: Start
---
Narrator: Plain [b]bold[/b] [wave speed=2]custom[/wave]
===
  `;

  const ir = compileOk(script);
  const dialogue = new Dialogue(ir, { startAt: "Start" });

  const batch = dialogue.continue();
  const event = lineOf(batch[1]);
  ok(event, "Expected a line event with markup");
  ok(event?.markup, "Expected markup data to be present");
  const markup = event!.markup!;
  strictEqual(markup.text, "Plain bold custom");

  const bold = markup.attributes.find((attribute) => attribute.name === "b");
  ok(bold, "Expected bold attribute");
  strictEqual(markup.text.slice(bold.position, bold.position + bold.length), "bold");

  const wave = markup.attributes.find((attribute) => attribute.name === "wave");
  ok(wave, "Expected wave attribute");
  strictEqual(markup.text.slice(wave.position, wave.position + wave.length), "custom");
  strictEqual(wave.properties["speed"]?.integerValue, 2);
});
