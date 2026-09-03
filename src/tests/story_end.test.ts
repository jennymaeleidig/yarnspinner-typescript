import { test } from "node:test";
import { ok, strictEqual } from "node:assert";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";

test("dialogue completion and the variables snapshot", () => {
  const script = `
title: Start
---
Narrator: Beginning
<<set $score = 42>>
Narrator: Done
===
`;
  const ir = compileOk(script);
  const dialogue = new Dialogue(ir, { startAt: "Start" });

  const first = dialogue.continue();
  ok(first[0].type === "nodeStart");
  ok(first[1].type === "line" && first[1].text === "Beginning");

  // `<<set>>` is internal (never a Command event): the next batch runs
  // straight through to the following line.
  const second = dialogue.continue();
  ok(second.length === 1 && second[0].type === "line" && second[0].text === "Done");

  const last = dialogue.continue();
  ok(last.some((e) => e.type === "dialogueComplete"), "Expected the dialogue-complete event");
  strictEqual(dialogue.isActive, false);

  // The story's variables are readable from the variable storage (the old
  // API delivered them as an onStoryEnd payload).
  strictEqual(dialogue.getVariables()["score"], 42);
});
