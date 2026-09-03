import { test } from "node:test";
import { strictEqual } from "node:assert";
import { compileOk } from "./compileOk.js";
import * as pkg from "../index.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

const lineTexts = (events: DialogueEvent[]) =>
  events.filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line").map((e) => e.text);

// The AST-level lowering seam is internal (deepening-wave ticket 09): real
// for tooling and the compiler's own tests, unreachable from the package
// root — hosts meet only the collect-don't-throw seam.
test("compileDocument and its error types are not package surface", () => {
  strictEqual("compileDocument" in pkg, false);
  strictEqual("LoweringError" in pkg, false);
  strictEqual("CompileDocumentOptions" in pkg, false);
});

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

  const ir = compileOk(dialogue);
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
