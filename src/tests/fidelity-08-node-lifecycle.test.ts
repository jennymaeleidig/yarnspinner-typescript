// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 08: VM node-lifecycle event fidelity against upstream
 * 3.2.2 `VirtualMachine.cs`:
 * - a `runNode` jump from inside a detour unwinds the whole call stack and
 *   fires `nodeComplete` for every unwound frame (upstream
 *   `ExecuteJumpToNode`, VirtualMachine.cs:1008-1031: `ReturnFromNode` for
 *   the current node, then one per popped call-stack entry);
 * - a detour return re-enters the caller via `SetNode(clearState: false)`
 *   (VirtualMachine.cs:873-887), which fires `nodeStart` — and the
 *   line-hint lookahead — again;
 * - `<<stop>>` (the stop opcode, VirtualMachine.cs:844-858) records the
 *   current node's visit and every call-stack node's visit, unwinding the
 *   stack;
 * - node entry fires `nodeStart` before the line hints (upstream `SetNode`
 *   invokes `NodeStartHandler` before `PrepareForLinesHandler`);
 * - `setNode` with an unknown node leaves the dialogue inactive (upstream
 *   sets `ExecutionState.Stopped` before throwing);
 * - `stop()` after completion still fires the dialogue-complete event
 *   (upstream `Stop` always invokes `DialogueCompleteHandler`).
 */

import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";
import { visitCountVariableKey } from "../runtime/generatedVariables.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

const START_WITH_DETOUR = `
title: Start
---
Narrator: start line
<<detour Sub>>
Narrator: back in Start
===
title: Sub
---
Narrator: sub line
<<jump Other>>
===
title: Other
---
Narrator: other line
===
`;

test("jump-from-detour fires nodeComplete for every unwound call-stack frame", () => {
  const dialogue = makeDialogue(START_WITH_DETOUR);
  const events = runUntilCompleteEvents(dialogue);
  // Upstream ExecuteJumpToNode (non-detour): the current node returns
  // (NodeComplete), then every node on the return stack unwinds with its
  // own NodeComplete — both Sub (current) and Start (the detoured caller).
  const completes = events
    .filter((e): e is Extract<DialogueEvent, { type: "nodeComplete" }> => e.type === "nodeComplete")
    .map((e) => e.nodeName);
  deepStrictEqual(completes, ["Sub", "Start", "Other"], "the jump from inside the detour completes Sub AND Start");
  ok(
    events.some((e) => e.type === "nodeStart" && e.nodeName === "Other"),
    "the jump target still starts",
  );
});

test("jump-from-detour records visit counts for every unwound frame", () => {
  const storage = new Map<string, unknown>();
  const dialogue = makeDialogue(START_WITH_DETOUR, {
    variableStorage: { has: (k) => storage.has(k), get: (k) => storage.get(k), set: (k, v) => storage.set(k, v), entries: () => storage.entries() },
  });
  runUntilCompleteEvents(dialogue);
  runUntilCompleteEvents(dialogue);
  // Upstream: the jump unwind records Sub (the current node) and Start (the
  // detoured caller) via ReturnFromNode; Other is visited when it ends.
  equal(storage.get(visitCountVariableKey("Start")), 1, "Start's visit is recorded by the jump unwind");
  equal(storage.get(visitCountVariableKey("Sub")), 1);
  equal(storage.get(visitCountVariableKey("Other")), 1);
});

test("detour return re-fires nodeStart for the resumed caller", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: before
<<detour Aside>>
Narrator: after
===
title: Aside
---
Narrator: inside
===
`);
  dialogue.continue(); // start node + "before"
  dialogue.continue(); // the detour: Aside starts + its line
  const returnBatch = dialogue.continue();
  // Upstream's Return re-enters the caller via SetNode(clearState: false),
  // which fires nodeStart for the resumed node before its next line.
  deepStrictEqual(
    returnBatch.map((e) => e.type),
    ["nodeComplete", "nodeStart", "line"],
    "the detour return re-fires nodeStart for Start",
  );
  ok(returnBatch.some((e) => e.type === "nodeStart" && e.nodeName === "Start"));
});

test("detour return re-fires the line-hint lookahead after nodeStart", () => {
  const dialogue = makeDialogue(
    `
title: Start
---
Narrator: before
<<detour Aside>>
Narrator: after
===
title: Aside
---
Narrator: inside
===
`,
    { lineHints: true },
  );
  dialogue.continue();
  dialogue.continue(); // detour entry
  const returnBatch = dialogue.continue();
  const kinds = returnBatch.map((e) => e.type);
  // Upstream SetNode: nodeStart first, then the prepare-for-lines delivery.
  deepStrictEqual(kinds, ["nodeComplete", "nodeStart", "lineHints", "line"]);
  // Upstream SetNode: nodeStart first, then the prepare-for-lines delivery.
  deepStrictEqual(kinds, ["nodeComplete", "nodeStart", "lineHints", "line"]);
});

test("node-entry batches fire nodeStart before line hints (upstream SetNode order)", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: One
===
`, { lineHints: true });
  const batch = dialogue.continue();
  deepStrictEqual(
    batch.map((e) => e.type),
    ["nodeStart", "lineHints", "line"],
    "nodeStart precedes the line hints",
  );
});

test("<<stop>> records visit counts for the current node and unwound frames", () => {
  const storage = new Map<string, unknown>();
  const dialogue = makeDialogue(`
title: Start
---
Narrator: start line
<<detour Sub>>
===
title: Sub
---
Narrator: sub line
<<stop>>
===
`, {
    variableStorage: { has: (k) => storage.has(k), get: (k) => storage.get(k), set: (k, v) => storage.set(k, v), entries: () => storage.entries() },
  });
  const events = runUntilCompleteEvents(dialogue);
  ok(events.some((e) => e.type === "dialogueComplete"), "<<stop>> completes the dialogue");
  equal(storage.get(visitCountVariableKey("Start")), 1, "the unwound Start frame is visited");
  equal(storage.get(visitCountVariableKey("Sub")), 1, "the stopping Sub node is visited");
  // The complete event fires after the unwinding nodeCompletes.
  const kinds = events.map((e) => e.type);
  ok(kinds.indexOf("dialogueComplete") > kinds.lastIndexOf("nodeComplete"), "completion follows the unwind");
});

test("setNode with an unknown node leaves the dialogue inactive (upstream stops first)", () => {
  const errors: string[] = [];
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Only line
===
`, { logError: (m) => errors.push(m) });

  dialogue.setNode("Nope");
  equal(errors.length, 1, "a diagnostic reports the unknown node");
  equal(dialogue.currentNode, null, "no node is running");
  equal(dialogue.isActive, false, "the dialogue is inactive");
  // No events are produced afterwards (upstream stops without firing the
  // complete handler).
  const batch = dialogue.continue();
  deepStrictEqual(batch, [], "continue() after the failed setNode yields nothing");
});

test("stop() after completion still fires the dialogue-complete event", () => {
  const dialogue = makeDialogue(`
title: Start
---
Narrator: Only line
===
`);
  const first = dialogue.continue();
  ok(first.some((e) => e.type === "line"));
  const done = dialogue.continue();
  ok(done.some((e) => e.type === "dialogueComplete"), "the run completed");
  dialogue.stop();
  const after = dialogue.continue();
  ok(
    after.some((e) => e.type === "dialogueComplete"),
    "upstream Stop always invokes the complete handler; the port delivers the event",
  );
  equal(dialogue.isActive, false);
});
