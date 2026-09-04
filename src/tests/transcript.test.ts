// SPDX-License-Identifier: CC0-1.0
/**
 * Contract tests for the transcript-reduction module (`runUntilStopped`,
 * CONTEXT.md "Transcript" / "stopping point").
 *
 * The module is exported non-upstream orchestration over the pull API (same
 * standing as the loader and the React adapter — docs/compatibility.md): it
 * packages the stopping-point contract that hosts previously re-derived at
 * six sites. The contract itself is upstream behaviour — the runtime pauses
 * each batch at the next stopping point and the consumer resumes it — so
 * each pin below cites its upstream counterpart:
 *
 * - A delivered line stops the pull (upstream delivers `Line` and waits —
 *   .NET `Dialogue.LineHandler`; the pull mirror is Rust
 *   `Dialogue::continue_`, ADR 0002).
 * - An option set stops the pull and awaits selection; ALL options deliver
 *   with advisory availability (upstream `OptionSet` / `OptionsHandler`).
 * - Pulling while pending must not happen (upstream fails loudly — .NET
 *   throws `DialogueException`, `VirtualMachine.cs:537–540`; Rust returns
 *   `Err(ContinueOnOptionSelectionError)`, `virtual_machine.rs:214–224`;
 *   this fork's log-and-empty divergence is never triggered by the module).
 * - Commands surface and are skipped past on the next pull (upstream
 *   `CommandHandler`).
 * - Node lifecycle and line-hint events ride through and never stop.
 * - Completion terminates (upstream `DialogueComplete`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileOk } from "./compileOk.js";
import { Dialogue, noOptionSelected } from "../index.js";
import { EMPTY_TRANSCRIPT, runUntilComplete, runUntilStopped } from "../index.js";
import type { Transcript } from "../index.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, opts);
}

test("a delivered line stops the pull", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Line one
Narrator: Line two
===
`);

  const first = runUntilStopped(dialogue);
  assert.equal(first.stopped, "line");
  assert.deepEqual(
    first.transcript.lines.map((l) => [l.speaker, l.text]),
    [["Narrator", "Line one"]],
  );
  assert.equal(first.transcript.options, null);
  assert.deepEqual(first.transcript.commands, []);

  // The next pull resumes past the stopping point; lines accumulate.
  const second = runUntilStopped(dialogue, first.transcript);
  assert.equal(second.stopped, "line");
  assert.deepEqual(
    second.transcript.lines.map((l) => l.text),
    ["Line one", "Line two"],
  );
  // The prior transcript is never mutated.
  assert.deepEqual(first.transcript.lines.map((l) => l.text), ["Line one"]);
});

test("an option set stops the pull and awaits selection; all options deliver with advisory availability", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Choose
-> Open the door
-> Close the door <<if false>>
===
`);

  const result = runUntilStopped(dialogue, runUntilStopped(dialogue).transcript);
  assert.equal(result.stopped, "options");
  assert.deepEqual(
    result.transcript.options?.map((o) => [o.text, o.isAvailable]),
    [
      ["Open the door", true],
      ["Close the door", false],
    ],
  );
});

test("pulling while an option set is pending returns the prior transcript and never trips the divergence", () => {
  const logErrors: string[] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
Narrator: Choose
-> A
-> B
===
`,
    { logError: (m) => logErrors.push(m) },
  );

  const first = runUntilStopped(dialogue, runUntilStopped(dialogue).transcript);
  assert.equal(first.stopped, "options");

  // Upstream fails loudly here (.NET throws, Rust errs — header citation);
  // the module guards the at-rest state instead of making the call.
  const again = runUntilStopped(dialogue, first.transcript);
  assert.equal(again.stopped, "options");
  assert.equal(again.transcript, first.transcript, "the prior transcript is returned as-is");
  assert.deepEqual(logErrors, [], "no log-and-empty diagnostic was triggered");
});

test("a command surfaces, then the next pull skips past it; commands accumulate", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<flash red>>
Narrator: After the flash
===
`);

  const first = runUntilStopped(dialogue);
  assert.equal(first.stopped, "command");
  assert.deepEqual(first.transcript.commands, ["flash red"]);

  const second = runUntilStopped(dialogue, first.transcript);
  assert.equal(second.stopped, "line");
  assert.deepEqual(
    second.transcript.lines.map((l) => l.text),
    ["After the flash"],
  );
  assert.deepEqual(second.transcript.commands, ["flash red"], "commands accumulate in the merge");

  // A second command surfaces with the first still in the transcript —
  // pinned through the module's own drain, with the prior transcript
  // carried in so commands accumulate across the setNode boundary.
  void dialogue.setNode("Start");
  const drained = runUntilComplete(dialogue, second.transcript);
  assert.deepEqual(drained.transcript.commands, ["flash red", "flash red"]);
  assert.equal(drained.stopped, "complete");
});

test("runUntilComplete drains line and command stops to the terminal stopping point", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<flash>>
Narrator: One
Narrator: Two
===
`);

  const { transcript, stopped } = runUntilComplete(dialogue);
  assert.equal(stopped, "complete");
  assert.deepEqual(transcript.commands, ["flash"]);
  assert.deepEqual(
    transcript.lines.map((l) => l.text),
    ["One", "Two"],
  );
});

test("node lifecycle events ride through; a jump lands as one stopped line on the new node", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Last line of Start
<<jump Second>>
===

title: Second
---
Rogue: First line of Second
===
`);

  let result = runUntilStopped(dialogue);
  assert.equal(result.stopped, "line");
  result = runUntilStopped(dialogue, result.transcript);
  assert.equal(result.stopped, "line");
  const lines = result.transcript.lines.map((l) => [l.speaker, l.text]);
  assert.deepEqual(lines, [
    ["Narrator", "Last line of Start"],
    ["Rogue", "First line of Second"],
  ]);

  // The jump's nodeComplete/nodeStart rode the same batch as the new line;
  // neither ever names the stopping point.
  result = runUntilStopped(dialogue, result.transcript);
  assert.equal(result.stopped, "complete");
});

test("line hints ride through and never stop a pull", () => {
  const dialogue = makeDialogue(
    `
title: Start
---
Narrator: One
Narrator: Two
===
`,
    { lineHints: true },
  );

  const first = runUntilStopped(dialogue);
  assert.equal(first.stopped, "line", "hints delivered at node entry do not stop the pull");
  assert.equal(first.transcript.lines.length, 1);
});

test("completion terminates the run; further pulls return the prior transcript", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: The end
===
`);

  const first = runUntilStopped(dialogue);
  assert.equal(first.stopped, "line");
  const second = runUntilStopped(dialogue, first.transcript);
  assert.equal(second.stopped, "complete");
  assert.equal(dialogue.isComplete, true);

  const third = runUntilStopped(dialogue, second.transcript);
  assert.equal(third.stopped, "complete");
  assert.equal(third.transcript, second.transcript, "nothing left to deliver");
  assert.equal(third.transcript.lines.length, 1, "no duplicated lines");
});

test("stop() makes the next pull deliver the queued complete event", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: One
Narrator: Two
Narrator: Three
===
`);

  const first = runUntilStopped(dialogue);
  assert.equal(first.stopped, "line");
  dialogue.stop();
  assert.equal(dialogue.isComplete, false, "stop() alone does not complete");

  const stopped = runUntilStopped(dialogue, first.transcript);
  assert.equal(stopped.stopped, "complete");
  assert.equal(dialogue.isComplete, true);
});

test("selecting an option resolves the set: the next pull carries no options", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Choose
-> Take it
    Narrator: Taken
-> Leave it
    Narrator: Left
===
`);

  let result = runUntilStopped(dialogue, runUntilStopped(dialogue).transcript);
  assert.equal(result.stopped, "options");
  assert.ok(result.transcript.options);

  dialogue.selectOption(0);
  result = runUntilStopped(dialogue, result.transcript);
  assert.equal(result.stopped, "line", "the option body's line delivers next");
  assert.equal(result.transcript.options, null, "the resolved set left the transcript");
  assert.deepEqual(
    result.transcript.lines.map((l) => l.text),
    ["Choose", "Taken"],
  );
});

test("noOptionSelected falls through: the resolved set leaves and the run completes", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Choose
-> A
    Narrator: A
-> B
    Narrator: B
===
`);

  const first = runUntilStopped(dialogue, runUntilStopped(dialogue).transcript);
  assert.equal(first.stopped, "options");
  dialogue.selectOption(noOptionSelected);
  const second = runUntilStopped(dialogue, first.transcript);
  assert.equal(second.stopped, "complete");
  assert.equal(second.transcript.options, null);
  assert.deepEqual(
    second.transcript.lines.map((l) => l.text),
    ["Choose"],
  );
});

test("a program without its start node completes with an empty transcript", () => {
  const logErrors: string[] = [];
  const dialogue = makeDialogue(
    `
title: NotStart
---
Narrator: Unreachable
===
`,
    { logError: (m) => logErrors.push(m) },
  );

  const result = runUntilStopped(dialogue);
  assert.equal(result.stopped, "complete");
  assert.deepEqual(result.transcript, EMPTY_TRANSCRIPT satisfies Transcript);
  assert.ok(logErrors.length > 0, "the constructor's diagnostic still surfaced");
});

test("the empty transcript is the merge identity", () => {
  const source = `
title: Start
---
Narrator: Hello
===
`;
  const fromDefault = runUntilStopped(makeDialogue(source));
  const fromExplicit = runUntilStopped(makeDialogue(source), EMPTY_TRANSCRIPT);
  assert.deepEqual(fromExplicit.transcript, fromDefault.transcript);
  assert.deepEqual(EMPTY_TRANSCRIPT, { lines: [], options: null, commands: [] } satisfies Transcript);
});

// ── scene on NodeStartEvent ───────────────────────────────

test("a node's scene header lands on the transcript from its NodeStartEvent", () => {
  const source = `
title: Start
scene: street
---
Narrator: Line one
===
`;
  const result = runUntilStopped(makeDialogue(source));
  assert.equal(result.transcript.scene, "street");
});

test("a scene-less node keeps the carried scene; a new header replaces it", () => {
  const source = `
title: Start
scene: street
---
Narrator: Line one
<<jump Next>>
===

title: Next
---
Narrator: Line two
<<jump Last>>
===

title: Last
scene: interior
---
Narrator: Line three
===
`;
  const dialogue = makeDialogue(source);
  const first = runUntilStopped(dialogue);
  assert.equal(first.transcript.scene, "street");
  const second = runUntilStopped(dialogue, first.transcript);
  assert.equal(
    second.transcript.scene,
    "street",
    "a scene-less node keeps the carried scene (the view keeps its last background)",
  );
  const third = runUntilStopped(dialogue, second.transcript);
  assert.equal(third.transcript.scene, "interior", "a new header replaces the carried scene");
});
