// SPDX-License-Identifier: CC0-1.0
import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";

function makeDialogue(
  source: string,
  opts?: ConstructorParameters<typeof Dialogue>[1],
): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

const lineTexts = (events: DialogueEvent[]) =>
  events
    .filter(
      (e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line",
    )
    .map((e) => e.text);

function nextOptions(dialogue: Dialogue, guard = 25): DialogueEvent[] {
  for (let i = 0; i < guard; i++) {
    const batch = dialogue.continue();
    if (batch.some((e) => e.type === "options")) return batch;
    if (
      batch.length === 0 ||
      batch[batch.length - 1].type === "dialogueComplete"
    )
      break;
  }
  throw new Error("Failed to reach an options event");
}

test("full featured Yarn script with all elements", () => {
  const script = `
title: Start
group: Demo
color: blue
---
Narrator: Welcome to the comprehensive Yarn test.
<<set $score to 7>>
<<if $score >= 10>>
    Narrator: High score branch.
<<elseif $score >= 5>>
    Narrator: Medium score branch.
<<else>>
    Narrator: Low score branch.
<<endif>>

<<once>>
    Narrator: This once block should only appear the first time.
<<endonce>>

-> Take the main path
    Narrator: Proceeding on the main path.
    <<jump NextScene>>
-> Explore a detour
    Narrator: Let's explore a detour first.
    <<detour AsideInfo>>
    Narrator: Back from detour.
    <<jump NextScene>>
===

title: NextScene
group: Demo
---
Narrator: You have arrived in the next scene.
-> Ask about features
    Player: What can this system do?
    Narrator: It supports options, conditions, once, jump, and detour.
-> Finish
    Narrator: Ending the scene.
===

title: AsideInfo
group: Demo
---
Narrator: This is detour content.
===
`;

  const ir = compileOk(script);

  // First run: once content should appear.
  const dialogue = new Dialogue(ir, { startAt: "Start" });

  // Welcome text (the `<<set>>` never surfaces as a command event).
  const a = dialogue.continue();
  ok(
    lineTexts(a).includes("Welcome to the comprehensive Yarn test."),
    "Should show welcome",
  );

  // Medium score branch (score is 7, >= 5 but < 10), then the once block.
  const b = dialogue.continue();
  ok(
    lineTexts(b).includes("Medium score branch."),
    "Should take medium branch",
  );
  const c = dialogue.continue();
  ok(
    lineTexts(c).includes("This once block should only appear the first time."),
    "Once block should appear first time",
  );

  // Options.
  const e = nextOptions(dialogue);
  const optionsEvent = e.find(
    (ev): ev is Extract<DialogueEvent, { type: "options" }> =>
      ev.type === "options",
  );
  strictEqual(optionsEvent?.options.length, 2, "Should have 2 options");

  // Choose detour path (index 1): option body, detour, return — each line
  // is one continue().
  dialogue.selectOption(1);
  ok(
    lineTexts(dialogue.continue()).includes("Let's explore a detour first."),
    "Should show option body",
  );
  ok(
    lineTexts(dialogue.continue()).includes("This is detour content."),
    "Should enter detour",
  );
  ok(
    lineTexts(dialogue.continue()).includes("Back from detour."),
    "Should return from detour",
  );

  // The jump lands in NextScene: arrival line, then its options.
  ok(
    lineTexts(dialogue.continue()).includes(
      "You have arrived in the next scene.",
    ),
    "Should jump to NextScene",
  );
  const next = nextOptions(dialogue);
  const nextOptionsEvent = next.find(
    (ev): ev is Extract<DialogueEvent, { type: "options" }> =>
      ev.type === "options",
  );
  strictEqual(
    nextOptionsEvent?.options.length,
    2,
    "Should have 2 options in NextScene",
  );

  // Second pass: once block should be skipped. Same runtime re-enters Start
  // (once-state lives in the dialogue's variable storage, per coding
  // standards §4; a NEW dialogue would start with fresh state).
  dialogue.setNode("Start");
  const second = dialogue.continue();
  ok(
    lineTexts(second).includes("Welcome to the comprehensive Yarn test."),
    "Welcome should appear",
  );
  const branch = dialogue.continue();
  ok(lineTexts(branch).includes("Medium score branch."), "branch line");

  // The once block is skipped: the options arrive right after the branch.
  const l = nextOptions(dialogue);
  ok(
    !lineTexts(l).includes(
      "This once block should only appear the first time.",
    ),
    "Once should be skipped on second run",
  );
  ok(
    l.some((ev) => ev.type === "options"),
    "Once should be skipped on second run",
  );
});
