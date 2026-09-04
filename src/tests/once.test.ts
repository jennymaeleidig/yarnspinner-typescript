// SPDX-License-Identifier: CC0-1.0
import { test } from "node:test";
import { strictEqual } from "node:assert";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

const drain = runUntilCompleteEvents;

const lineTexts = (events: DialogueEvent[]) =>
  events.filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line").map((e) => e.text);

test("once block behavior", () => {
  const script = `
title: Start
---
<<once>>
    Narrator: One time only
<<endonce>>
Narrator: Always
===
`;

  const ir = compileOk(script);
  void ir;

  // First run: the once block's content appears, then the always line.
  const dialogue = makeDialogue(script);
  const firstLine = lineTexts(dialogue.continue());
  strictEqual(firstLine.some((t) => /One time only/.test(t)), true, "Expect once block content on first run");

  const secondLine = lineTexts(dialogue.continue());
  strictEqual(secondLine.some((t) => /Always/.test(t)), true, "Expect always line after once");

  // Once-state lives in the dialogue's variable storage (coding standards
  // §4): re-entering the same dialogue skips the once block.
  dialogue.setNode("Start");
  const reentry = lineTexts(drain(dialogue));
  strictEqual(reentry.some((t) => /One time only/.test(t)), false, "once content is skipped on re-entry");
  strictEqual(reentry.some((t) => /Always/.test(t)), true);

  // A NEW dialogue starts with fresh state.
  const fresh = lineTexts(drain(makeDialogue(script)));
  strictEqual(fresh.some((t) => /One time only/.test(t)), true, "a new dialogue has fresh once-state");
});
