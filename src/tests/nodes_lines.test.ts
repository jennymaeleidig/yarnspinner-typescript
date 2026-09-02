import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { parseYarn, compile } from "../index.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compile(parseYarn(source));
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

  const doc = parseYarn(script);
  const ir = compile(doc);
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

  const doc = parseYarn(script);
  const ir = compile(doc);
  const dialogue = new Dialogue(ir, { startAt: "Start" });

  const batch = dialogue.continue();
  const event = lineOf(batch[1]);
  ok(event, "Expected a line event with markup");
  ok(event?.markup, "Expected markup data to be present");
  const markup = event!.markup!;
  strictEqual(markup.text, "Plain bold custom");

  const boldSegment = markup.segments.find((segment) =>
    segment.wrappers.some((wrapper) => wrapper.name === "b" && wrapper.type === "default")
  );
  ok(boldSegment, "Expected bold segment");
  strictEqual(markup.text.slice(boldSegment!.start, boldSegment!.end), "bold");

  const customSegment = markup.segments.find((segment) =>
    segment.wrappers.some((wrapper) => wrapper.name === "wave" && wrapper.type === "custom")
  );
  ok(customSegment, "Expected custom segment");
  const waveWrapper = customSegment!.wrappers.find((wrapper) => wrapper.name === "wave");
  ok(waveWrapper);
  strictEqual(waveWrapper!.properties.speed, 2);
});
