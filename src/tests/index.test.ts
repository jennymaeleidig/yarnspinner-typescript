import { test } from "node:test";
import { strictEqual } from "node:assert";
import { parseYarn, compile } from "../index.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compile(parseYarn(source));
  return new Dialogue(program, { startAt: "Start", ...opts });
}

const lineTexts = (events: DialogueEvent[]) =>
  events.filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line").map((e) => e.text);

test("basic dialogue with options", () => {
  const dialogue = `
title: Start
---
Narrator: Hi
-> Opt A
    Narrator: A chosen
-> Opt B
    Narrator: B chosen
===
`;

  const doc = parseYarn(dialogue);
  const ir = compile(doc);
  const runner = new Dialogue(ir, { startAt: "Start" });

  strictEqual(lineTexts(runner.continue())[0], "Hi");

  const optionsEvent = runner.continue().find(
    (e): e is Extract<DialogueEvent, { type: "options" }> => e.type === "options",
  );
  strictEqual(optionsEvent?.options.length, 2);
  runner.selectOption(0);

  const chosen = lineTexts(runner.continue());
  strictEqual(chosen.includes("A chosen"), true);
});
