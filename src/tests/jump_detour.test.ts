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

test("jump and detour", () => {
  const script = `
title: Start
---
Narrator: Go to Next
<<jump Next>>
===

title: Next
---
Narrator: In Next
<<detour Aside>>
Narrator: Back from Aside
===

title: Aside
---
Narrator: Inside Aside
===
`;

  const doc = parseYarn(script);
  const ir = compile(doc);
  const dialogue = new Dialogue(ir, { startAt: "Start" });

  // Node entry + first line.
  const a = dialogue.continue();
  strictEqual(lineTexts(a)[0], "Go to Next", "Expect first line");

  // The jump executes: the node-complete fires, Next starts, its line is
  // delivered — all in one batch.
  const b = dialogue.continue();
  strictEqual(lineTexts(b)[0], "In Next", "Expect Next node line");
  okTypes(b, ["nodeComplete", "nodeStart", "line"]);

  // The detour executes: Aside starts and delivers its line.
  const c = dialogue.continue();
  strictEqual(lineTexts(c)[0], "Inside Aside", "Expect detour content");
  okTypes(c, ["nodeStart", "line"]);

  // Aside ends: node-complete fires and the detour returns to Next.
  const d = dialogue.continue();
  strictEqual(lineTexts(d)[0], "Back from Aside", "Expect return from detour");
  okTypes(d, ["nodeComplete", "line"]);

  // Next ends: the dialogue completes.
  const e = dialogue.continue();
  okTypes(e, ["nodeComplete", "dialogueComplete"]);
});

function okTypes(events: DialogueEvent[], expected: string[]): void {
  strictEqual(
    events.map((e) => e.type).join(","),
    expected.join(","),
    `Unexpected event sequence: ${events.map((e) => e.type).join(", ")}`,
  );
}
