// SPDX-License-Identifier: CC0-1.0
/**
 * Contract tests for the pull-based runtime API (ADR 0002).
 *
 * The event-stream seam: `continue()` returns the dialogue events up to the
 * next stopping point; `selectOption(index | noOptionSelected)` resumes a
 * delivered option set; `setNode()`/`stop()` round out the API. State
 * statements never surface as `Command` events; runtime failures surface
 * through the `logError`/`logDebug` callbacks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileOk } from "./compileOk.js";
import { Dialogue, noOptionSelected, Library } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";

function makeDialogue(
  source: string,
  opts?: ConstructorParameters<typeof Dialogue>[1],
  compileOpts?: Parameters<typeof compileOk>[1],
): Dialogue {
  // The runtime library doubles as the compile-time signature source; the
  // compile options carry host variable declarations for the type checker.
  const program = compileOk(source, { library: opts?.library, ...compileOpts });
  return new Dialogue(program, opts);
}

/** Drain a dialogue to completion, collecting every event. */
const drain = runUntilCompleteEvents;

const typesOf = (events: DialogueEvent[]) => events.map((e) => e.type);

test("continue() returns events up to the next stopping point", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Line one
Narrator: Line two
===
`);

  const first = dialogue.continue();
  // Node lifecycle rides along; the line stops the batch.
  assert.deepEqual(typesOf(first), ["nodeStart", "line"]);
  const line1 = first[1];
  assert.ok(line1.type === "line");
  assert.equal(line1.text, "Line one");
  assert.equal(line1.speaker, "Narrator");

  const second = dialogue.continue();
  assert.deepEqual(typesOf(second), ["line"]);
  assert.ok(second[0].type === "line" && second[0].text === "Line two");

  const third = dialogue.continue();
  assert.deepEqual(typesOf(third), ["nodeComplete", "dialogueComplete"]);
  assert.equal(dialogue.isActive, false);
  assert.equal(dialogue.currentNode, null);

  // An inactive dialogue yields no events.
  assert.deepEqual(dialogue.continue(), []);
});

test("selectOption runs the chosen option body, then continues after the options block", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Choose one
-> A
    Narrator: Picked A
-> B
    Narrator: Picked B
===
`);

  dialogue.continue(); // [nodeStart, line "Choose one"]
  const optionsEvent = dialogue.continue();
  assert.deepEqual(typesOf(optionsEvent), ["options"]);
  assert.ok(optionsEvent[0].type === "options");
  assert.deepEqual(
    optionsEvent[0].options.map((o) => o.text),
    ["A", "B"],
  );
  assert.equal(dialogue.isActive, true);

  dialogue.selectOption(1);
  const batch = dialogue.continue();
  assert.deepEqual(typesOf(batch), ["line"]);
  assert.ok(batch[0].type === "line" && batch[0].text === "Picked B");

  // After the option body, execution continues after the options block.
  const rest = drain(dialogue);
  assert.deepEqual(typesOf(rest), ["nodeComplete", "dialogueComplete"]);
});

test("options deliver the full set with isAvailable flags", () => {
  const dialogue = makeDialogue(
    `
title: StartFalse
---
<<declare $flag = false>>
-> Hidden <<if $flag>>
    Narrator: Hidden
-> Visible
    Narrator: Visible
===
`,
    { startAt: "StartFalse" },
  );

  const batch = dialogue.continue();
  // `<<declare>>` is silent, so the options arrive with the node start.
  assert.deepEqual(typesOf(batch), ["nodeStart", "options"]);
  const options = batch[1].type === "options" ? batch[1].options : [];
  assert.equal(options.length, 2, "unavailable options are delivered, not dropped");
  assert.deepEqual(
    options.map((o) => ({ text: o.text, isAvailable: o.isAvailable })),
    [
      { text: "Hidden", isAvailable: false },
      { text: "Visible", isAvailable: true },
    ],
  );
  // Any delivered option may be selected (availability is advisory).
  dialogue.selectOption(1);
  const line = dialogue.continue();
  assert.ok(line[0].type === "line" && line[0].text === "Visible");
});

test("selectOption(noOptionSelected) falls through past the options block", () => {
  const dialogue = makeDialogue(`
title: Start
---
-> Option A <<if false>>
-> Option B <<if false>>
Line after fallthrough
===
`);

  const batch = dialogue.continue();
  assert.deepEqual(typesOf(batch), ["nodeStart", "options"]);
  const optionsEvent = batch[1];
  assert.ok(optionsEvent.type === "options");
  assert.ok(optionsEvent.options.every((o) => !o.isAvailable));

  dialogue.selectOption(noOptionSelected);
  const rest = drain(dialogue);
  const line = rest.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line, "expected the fall-through line");
  assert.equal(line.text, "Line after fallthrough");
  assert.equal(typesOf(rest).includes("dialogueComplete"), true);
});

test("state commands never surface as Command events", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<set $score to 42>>
<<declare $level = 3>>
Narrator: Score {$score} level {$level}
===
`);

  const events = drain(dialogue);
  const commands = events.filter((e) => e.type === "command");
  assert.deepEqual(commands, [], "set/declare are internal");
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "Score 42 level 3");
  assert.equal(dialogue.getVariable("score"), 42);
});

test("delivered commands surface as Command events with substitutions expanded", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<set $who to "world">>
<<hello {$who}>>
===
`);

  const events = drain(dialogue);
  const command = events.find((e): e is Extract<DialogueEvent, { type: "command" }> => e.type === "command");
  assert.ok(command);
  assert.equal(command.command, "hello world");
});

test("node lifecycle: jump fires NodeComplete then NodeStart; detour returns without a second NodeStart", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Go
<<jump Next>>
===

title: Next
---
Narrator: In Next
<<detour Aside>>
Narrator: Back
===

title: Aside
---
Narrator: Inside
===
`);

  const events = drain(dialogue);
  assert.deepEqual(typesOf(events), [
    "nodeStart", // Start
    "line", // Go
    "nodeComplete", // Start (jump away)
    "nodeStart", // Next
    "line", // In Next
    "nodeStart", // Aside (detour)
    "line", // Inside
    "nodeComplete", // Aside (natural end returns from the detour)
    "line", // Back
    "nodeComplete", // Next
    "dialogueComplete",
  ]);
  const speakers = events
    .filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line")
    .map((e) => e.text);
  assert.deepEqual(speakers, ["Go", "In Next", "Inside", "Back"]);
});

test("<<stop>> and <<return>> outside a detour complete the dialogue", () => {
  const stopDialogue = makeDialogue(`
title: Start
---
Narrator: Before stop
<<stop>>
Narrator: Never seen
===
`);
  const stopEvents = drain(stopDialogue);
  assert.deepEqual(typesOf(stopEvents), ["nodeStart", "line", "nodeComplete", "dialogueComplete"]);

  const returnDialogue = makeDialogue(`
title: Start
---
Narrator: Before return
<<return>>
Narrator: Never seen
===
`);
  const returnEvents = drain(returnDialogue);
  assert.deepEqual(typesOf(returnEvents), ["nodeStart", "line", "nodeComplete", "dialogueComplete"]);
});

test("stop() discards execution state and delivers dialogueComplete", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: One
Narrator: Two
===
`);
  dialogue.continue();
  dialogue.stop();
  assert.equal(dialogue.isActive, false);
  const batch = dialogue.continue();
  assert.deepEqual(typesOf(batch), ["dialogueComplete"]);
});

test("setNode re-enters a node with fresh execution state but preserved story state", () => {
  const dialogue = makeDialogue(
    `
title: Start
---
<<set $runCount to $runCount + 1>>
Narrator: Run {$runCount}
===
`,
    { variables: { $runCount: 0 } },
  );
  const first = drain(dialogue);
  const firstLine = first.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(firstLine && firstLine.text === "Run 1");

  dialogue.setNode("Start");
  assert.equal(dialogue.currentNode, "Start");
  const second = drain(dialogue);
  const secondLine = second.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(secondLine && secondLine.text === "Run 2", "variables persist across setNode");
});

test("setNode queues nodeStart for the next batch; unknown node is a diagnostic and changes nothing", () => {
  const errors: string[] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
Narrator: Only line
===
`,
    { logError: (m) => errors.push(m) },
  );

  dialogue.setNode("Nope");
  assert.equal(dialogue.currentNode, "Start");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /No node named "Nope"/);

  const first = dialogue.continue();
  assert.equal(first[0].type, "nodeStart");
});

test("continue() while awaiting a selection is a diagnostic, not an event", () => {
  const errors: string[] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
-> A
    Narrator: A
===
`,
    { logError: (m) => errors.push(m) },
  );
  // The option list is the node's first content: it arrives immediately.
  const batch = dialogue.continue();
  assert.deepEqual(typesOf(batch), ["nodeStart", "options"]);
  const before = errors.length;
  assert.deepEqual(dialogue.continue(), []);
  assert.equal(errors.length, before + 1);
  assert.match(errors[errors.length - 1], /selectOption/);

  // The runtime still awaits a valid selection.
  dialogue.selectOption(0);
  const line = dialogue.continue();
  assert.ok(line[0].type === "line" && line[0].text === "A");
});

test("selectOption validation: out-of-range and mistimed calls are diagnostics", () => {
  const errors: string[] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
-> A
    Narrator: A
-> B
    Narrator: B
===
`,
    { logError: (m) => errors.push(m) },
  );
  const first = dialogue.continue();
  assert.deepEqual(typesOf(first), ["nodeStart", "options"]);

  const before = errors.length;
  dialogue.selectOption(5);
  assert.equal(errors.length, before + 1, "out-of-range selection is rejected");
  assert.ok(dialogue.isActive && dialogue.currentNode === "Start");

  dialogue.selectOption(0);
  const line = dialogue.continue();
  assert.ok(line[0].type === "line" && line[0].text === "A");
});

test("Library: host functions participate; built-ins remain; hosts may override built-ins", () => {
  const dialogue = makeDialogue(
    `
title: Start
---
<<declare $doubled = multiply(2, 3)>>
Result: {$doubled} {random_check()} {min(3, 1)}
===
`,
    {
      library: (() => {
        const lib = new Library();
        lib.registerFunction("multiply", (a, b) => Number(a) * Number(b), { params: ["any", "any"], returns: "number" });
        lib.registerFunction("random_check", () => "ok", { params: [], returns: "string" });
        return lib;
      })(),
    },
  );
  const events = drain(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.speaker, "Result");
  assert.equal(line.text, "6 ok 1", "host functions + built-ins (variadic min)");
  assert.equal(dialogue.getLibrary().hasFunction("multiply"), true);

  // Host override of a built-in.
  const override = makeDialogue(
    `
title: Start
---
Narrator: {int(2.7)}
===
`,
    {
      library: (() => {
        const lib = new Library();
        lib.registerFunction("int", () => 999);
        return lib;
      })(),
    },
  );
  const overrideEvents = drain(override);
  const overrideLine = overrideEvents.find(
    (e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line",
  );
  assert.ok(overrideLine);
  assert.equal(overrideLine.text, "999", "imported library takes precedence over built-ins");
});

test("Library command handlers fire at delivery; the Command event still surfaces", () => {
  const seen: string[][] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
<<quest start "Find the hat">>
===
`,
    {
      library: (() => {
        const lib = new Library();
        lib.registerCommandHandler("quest", (parameters) => seen.push(parameters));
        return lib;
      })(),
    },
  );
  const events = drain(dialogue);
  assert.deepEqual(seen, [["start", "Find the hat"]]);
  const command = events.find((e): e is Extract<DialogueEvent, { type: "command" }> => e.type === "command");
  assert.ok(command);
  assert.equal(command.command, "quest start \"Find the hat\"");
});

test("runtime failures surface as logError diagnostics; content failures do not throw", () => {
  const errors: string[] = [];
  const debugs: string[] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
Narrator: Jumping
<<jump Missing>>
===
`,
    {
      logError: (m) => errors.push(m),
      logDebug: (m) => debugs.push(m),
    },
  );
  const events = drain(dialogue);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Missing/);
  assert.equal(typesOf(events).includes("dialogueComplete"), true, "a failed jump completes the dialogue");
});

test("lineHints events are opt-in", () => {
  const source = `
title: Start
---
Narrator: One
-> Opt
    Narrator: Option body
===
`;

  const withHints = makeDialogue(source, { lineHints: true });
  const first = withHints.continue();
  assert.equal(first[0].type, "lineHints", "hints precede the node start");
  assert.ok(first[1].type === "nodeStart");
  const hintIds = first[0].type === "lineHints" ? first[0].lineIds : [];
  assert.ok(hintIds.length >= 2, "line and option text IDs are hinted");

  const withoutHints = makeDialogue(source);
  const plain = withoutHints.continue();
  assert.equal(plain[0].type, "nodeStart", "no hints by default");
});

test("host variables seed storage; getVariables excludes generated variables", () => {
  const dialogue = makeDialogue(
    `
title: Start
---
Narrator: Gold {$gold}
===
`,
    { variables: { $gold: 25 } },
    { declarations: { variables: { gold: { type: "number" } } } },
  );
  drain(dialogue);
  assert.equal(dialogue.getVariable("gold"), 25);
  assert.deepEqual(dialogue.getVariables()["gold"], 25);
  for (const key of Object.keys(dialogue.getVariables())) {
    assert.ok(!key.startsWith("Yarn.Internal."), "generated variables are not story variables");
  }
});

test("tryGetSmartVariable recomputes from current storage", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<declare $money = 10>>
<<declare $double = $money * 2>>
===
`);
  assert.deepEqual(dialogue.tryGetSmartVariable("double"), { ok: true, value: 20 });
  dialogue.setVariable("money", 15);
  assert.deepEqual(dialogue.tryGetSmartVariable("double"), { ok: true, value: 30 });
  assert.equal(dialogue.tryGetSmartVariable("money").ok, false);
});

test("state queries track option selection and completion", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Pick one
-> First
    Narrator: First chosen
-> Second
    Narrator: Second chosen
===
`);
  // Before the first continue(): nothing pending, nothing complete.
  assert.equal(dialogue.isWaitingForOptionSelection, false);
  assert.equal(dialogue.isComplete, false);

  const lineBatch = dialogue.continue();
  assert.deepEqual(typesOf(lineBatch), ["nodeStart", "line"]);
  assert.equal(dialogue.isWaitingForOptionSelection, false);
  assert.equal(dialogue.isComplete, false);

  const optionsBatch = dialogue.continue();
  assert.equal(optionsBatch[optionsBatch.length - 1].type, "options");
  assert.equal(dialogue.isWaitingForOptionSelection, true);
  assert.equal(dialogue.isComplete, false);

  dialogue.selectOption(0);
  assert.equal(dialogue.isWaitingForOptionSelection, false);

  drain(dialogue);
  // A DialogueComplete event has been delivered (the isComplete contract).
  assert.equal(dialogue.isComplete, true);
  assert.equal(dialogue.isWaitingForOptionSelection, false);
});

test("stop() makes the dialogue inactive but not complete; the queued complete event still delivers", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Line one
Narrator: Line two
===
`);
  dialogue.continue(); // nodeStart + line one
  dialogue.stop();
  assert.equal(dialogue.isActive, false);
  assert.equal(dialogue.isComplete, false); // complete is queued, not delivered

  const batch = dialogue.continue();
  assert.deepEqual(typesOf(batch), ["dialogueComplete"]);
  assert.equal(dialogue.isComplete, true);
});

test("continue() while an option set is pending returns no events (the recorded divergence)", () => {
  const logErrors: string[] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
Narrator: Pick one
-> First
    Narrator: First chosen
-> Second
    Narrator: Second chosen
===
`,
    { logError: (message) => logErrors.push(message) },
  );
  dialogue.continue(); // line
  dialogue.continue(); // options
  assert.deepEqual(dialogue.continue(), []);
  assert.equal(dialogue.isWaitingForOptionSelection, true);
  assert.ok(logErrors.length > 0, "the divergence logs a diagnostic");

  dialogue.selectOption(0);
  assert.equal(dialogue.isWaitingForOptionSelection, false);
});

test("setNode resets the state queries for a fresh run", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: one
===
title: Other
---
Narrator: other
===
`);
  drain(dialogue);
  assert.equal(dialogue.isComplete, true);

  dialogue.setNode("Other");
  assert.equal(dialogue.isComplete, false);
  assert.equal(dialogue.isWaitingForOptionSelection, false);
});
