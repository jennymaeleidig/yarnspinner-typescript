import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { parseYarn, compile } from "../index.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent, OptionsEvent } from "../runtime/dialogue.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compile(parseYarn(source));
  return new Dialogue(program, { startAt: "Start", ...opts });
}

function nextOptions(dialogue: Dialogue, guard = 25): OptionsEvent {
  for (let i = 0; i < guard; i++) {
    const batch = dialogue.continue();
    const options = batch.find((e): e is OptionsEvent => e.type === "options");
    if (options) return options;
    if (batch.some((e) => e.type === "dialogueComplete")) break;
  }
  throw new Error("Failed to reach an options event");
}

const lineTexts = (events: DialogueEvent[]) =>
  events.filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line").map((e) => e.text);

test("options selection", () => {
  const script = `
title: Start
---
Narrator: Choose one
-> A
    Narrator: Picked A
-> B
    Narrator: Picked B
===
`;

  const doc = parseYarn(script);
  const ir = compile(doc);
  const dialogue = new Dialogue(ir, { startAt: "Start" });

  const first = dialogue.continue();
  ok(first[1].type === "line" && first[1].text === "Choose one", "Expected intro text");
  const optionsEvent = nextOptions(dialogue);
  strictEqual(optionsEvent.options.length, 2, "Should have 2 options");
  // choose B (index 1)
  dialogue.selectOption(1);
  const batch = dialogue.continue();
  ok(lineTexts(batch).includes("Picked B"), "Expected body of option B");
});

test("option markup is exposed", () => {
  const script = `
title: Start
---
Narrator: Choose
-> [b]Bold[/b]
    Narrator: Bold
-> [wave intensity=5]Custom[/wave]
    Narrator: Custom
===
  `;

  const dialogue = makeDialogue(script);
  dialogue.continue(); // node start + "Choose"
  const optionsEvent = nextOptions(dialogue);
  const options = optionsEvent.options;
  ok(options[0].markup, "Expected markup on first option");
  ok(options[1].markup, "Expected markup on second option");
  const boldMarkup = options[0].markup!;
  strictEqual(boldMarkup.text, "Bold");
  ok(
    boldMarkup.segments.some((segment) =>
      segment.wrappers.some((wrapper) => wrapper.name === "b" && wrapper.type === "default")
    ),
    "Expected bold wrapper"
  );
  const customWrapper = options[1].markup!.segments
    .flatMap((segment) => segment.wrappers)
    .find((wrapper) => wrapper.name === "wave");
  ok(customWrapper, "Expected custom wrapper on second option");
  strictEqual(customWrapper!.properties.intensity, 5);
});

test("option text interpolates variables", () => {
  const script = `
title: Start
---
<<set $cost to 150>>
<<set $bribe to 300>>
Narrator: Decide
-> Pay {$cost}
    Narrator: Paid
 -> Haggle {$bribe}
    Narrator: Haggle
===
`;

  const dialogue = makeDialogue(script);
  // `<<set>>` statements are internal: the intro line arrives immediately.
  const first = dialogue.continue();
  ok(first[1].type === "line" && first[1].text === "Decide", "Expected narration after the sets");

  const optionsEvent = nextOptions(dialogue);
  const [pay, haggle] = optionsEvent.options;
  strictEqual(pay.text, "Pay 150", "Should replace placeholder with variable value");
  strictEqual(haggle.text, "Haggle 300", "Should evaluate expressions inside placeholders");
});

test("conditional options respect once blocks and if statements", () => {
  const script = `
title: Start
---
<<declare $secret = false>>
Narrator: Boot
<<once>>
    <<set $secret = true>>
<<endonce>>
Narrator: Menu
<<if $secret>>
    -> Secret Option
        Narrator: Secret taken
        <<set $secret = false>>
        <<jump Start>>
<<endif>>
-> Regular Option
    Narrator: Regular taken
    <<jump Start>>
===
`;

  const dialogue = makeDialogue(script);

  // First pass: the secret option's condition holds, so the if-wrapped
  // option group is reached (the compiler merges the lists into one —
  // ticket 46).
  const secretMenu = nextOptions(dialogue);
  strictEqual(secretMenu.options.length, 1, "First pass should expose the conditional secret option");
  strictEqual(secretMenu.options[0].text, "Secret Option");
  strictEqual(secretMenu.options[0].isAvailable, true, "the secret option is available on the first pass");

  // Consume the secret option to flip the flag off, then walk to the next
  // options event (secret body line, jump, Start re-entry).
  dialogue.selectOption(0);
  const fallbackMenu = nextOptions(dialogue);
  strictEqual(fallbackMenu.options.length, 1, "After the secret path is used, only the regular option should remain");
  strictEqual(fallbackMenu.options[0].text, "Regular Option");
  strictEqual(fallbackMenu.options[0].isAvailable, true);
});

test("options allow space-indented bodies", () => {
  const script = `
title: Start
---
-> Pay
  <<jump Pay>>
-> Run
  <<jump Run>>
===

title: Pay
---
Narrator: Pay branch
===

title: Run
---
Narrator: Run branch
===
`;

  const dialogue = makeDialogue(script);
  const optionsEvent = nextOptions(dialogue);
  strictEqual(optionsEvent.options.length, 2, "Space indents should still group options together");
  strictEqual(optionsEvent.options[0].text, "Pay");
  strictEqual(optionsEvent.options[1].text, "Run");
});

test("option-line <<if>> conditions set availability", () => {
  const script = `
title: StartFalse
---
<<declare $flag = false>>
-> Hidden <<if $flag>>
    Narrator: Hidden
-> Visible
    Narrator: Visible
===

title: StartTrue
---
<<declare $flag = true>>
-> Hidden <<if $flag>>
    Narrator: Hidden
-> Visible
    Narrator: Visible
===
`;

  const doc = parseYarn(script);
  const ir = compile(doc);

  const flagsFor = (startNode: string, flag: boolean) => {
    const dialogue = new Dialogue(ir, { startAt: startNode });
    // The two nodes both declare $flag, so only one initial value survives
    // compile; host writes are the reliable way to vary the input.
    dialogue.setVariable("flag", flag);
    const optionsEvent = nextOptions(dialogue);
    return optionsEvent.options.map((o) => ({ text: o.text, isAvailable: o.isAvailable }));
  };

  strictEqual(
    JSON.stringify(flagsFor("StartFalse", false)),
    JSON.stringify([
      { text: "Hidden", isAvailable: false },
      { text: "Visible", isAvailable: true },
    ]),
    "a false condition delivers the option with isAvailable: false",
  );

  strictEqual(
    JSON.stringify(flagsFor("StartTrue", true)),
    JSON.stringify([
      { text: "Hidden", isAvailable: true },
      { text: "Visible", isAvailable: true },
    ]),
    "both options are available when the condition holds",
  );
});
