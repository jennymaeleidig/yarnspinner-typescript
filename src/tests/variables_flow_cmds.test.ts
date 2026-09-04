// SPDX-License-Identifier: CC0-1.0
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { compileOk } from "./compileOk.js";
import { Dialogue, Library } from "../runtime/dialogue.js";
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
  return new Dialogue(program, { startAt: "Start", ...opts });
}

/** Drain the dialogue, collecting line text (as delivered, without speaker prefix). */
function drainTexts(dialogue: Dialogue): string[] {
  return runUntilCompleteEvents(dialogue)
    .filter((event): event is Extract<DialogueEvent, { type: "line" }> => event.type === "line")
    .map((event) => event.text);
}

test("variables, flow control, and commands", () => {
  const script = `
title: Start
---
<<set $score to 10>>
<<if $score >= 10>>
    Narrator: High
<<else>>
    Narrator: Low
<<endif>>
===
`;

  const ir = compileOk(script);
  const dialogue = new Dialogue(ir, { startAt: "Start" });

  // `<<set>>` is internal; the branch line arrives in the first batch.
  const events: DialogueEvent[] = dialogue.continue();
  strictEqual(events.some((e) => e.type === "command"), false, "state commands never surface");
  strictEqual(events.some((e) => e.type === "line" && e.text === "High"), true, "Expected High branch");
  strictEqual(dialogue.getVariable("score"), 10, "Variable should be set");
});

test("equality operators support ==, !=, and single =", () => {
  const script = `
title: Start
---
<<set $doorOpen to true>>
<<if $doorOpen = true>>
    Narrator: Single equals ok
<<endif>>
<<if $doorOpen == true>>
    Narrator: Double equals ok
<<endif>>
<<if $doorOpen != false>>
    Narrator: Not equals ok
<<endif>>
===
`;

  const dialogue = makeDialogue(script);
  const seen = drainTexts(dialogue);

  strictEqual(seen.includes("Single equals ok"), true, "Single equals comparison should succeed");
  strictEqual(seen.includes("Double equals ok"), true, "Double equals comparison should succeed");
  strictEqual(seen.includes("Not equals ok"), true, "Not equals comparison should succeed");
});

test("set command supports equals syntax with arithmetic reassignment", () => {
  const script = `
title: StreetCred
---
<<set $reputation = 100>>
<<set $reputation = $reputation - 25 >>
Narrator: Current street cred: {$reputation}
===
`;

  const dialogue = makeDialogue(script, { startAt: "StreetCred" });
  const seen = drainTexts(dialogue);

  strictEqual(seen.includes("Current street cred: 75"), true, "Should reflect arithmetic subtraction");
  strictEqual(dialogue.getVariable("reputation"), 75, "Variable should store updated numeric value");
});

test("set command respects arithmetic precedence and parentheses", () => {
  const script = `
title: MathChecks
---
<<set $score = 10>>
<<set $score = $score + 10 * 2>>
<<set $score = ($score + 10) / 2>>
Narrator: Score now {$score}
===
`;

  const dialogue = makeDialogue(script, { startAt: "MathChecks" });
  const lines = drainTexts(dialogue);

  strictEqual(lines.includes("Score now 20"), true, "Should honor operator precedence and parentheses");
  strictEqual(dialogue.getVariable("score"), 20, "Final numeric value should be 20");
});

test("variables passed from host accept $ prefix and mutate via arithmetic set", () => {
  const script = `
title: HostVars
---
Narrator: Start {$reputation}
<<set $reputation = $reputation - 25 >>
Narrator: After {$reputation}
===
`;

  const dialogue = makeDialogue(script, { startAt: "HostVars", variables: { $reputation: 100 } });
  const lines = drainTexts(dialogue);

  strictEqual(lines.includes("Start 100"), true, "Initial host variable should be visible");
  strictEqual(lines.includes("After 75"), true, "Arithmetic mutation should be reflected");
  strictEqual(dialogue.getVariable("reputation"), 75, "Runner variable store should update");
});

test("host variables work with math helpers and propagate results", () => {
  const script = `
title: MathHost
---
Narrator: Incoming {$energy}
<<set $energy = max($energy, 50)>>
<<set $residual = floor($energy / 3)>>
Narrator: After max {$energy}
Narrator: Residual {$residual}
===
`;

  const dialogue = makeDialogue(script, { startAt: "MathHost", variables: { $energy: 37 } }, {
    declarations: { variables: { energy: { type: "number" }, residual: { type: "number" } } },
  });
  const lines = drainTexts(dialogue);

  strictEqual(lines.includes("Incoming 37"), true, "Should read initial host variable");
  strictEqual(lines.includes("After max 50"), true, "max() should clamp the variable");
  strictEqual(lines.includes("Residual 16"), true, "floor division should be reflected");
  strictEqual(dialogue.getVariable("energy"), 50, "Host variable should hold updated max result");
  strictEqual(dialogue.getVariable("residual"), 16, "New variables from math operations should be stored");
});

test("host variables use custom add/subtract functions", () => {
  const script = `
title: HostMathFns
---
Narrator: Credits {$credits}
<<set $credits = add($credits, 25)>>
<<set $credits = subtract($credits, 10)>>
Narrator: Final {$credits}
===
`;

  const dialogue = makeDialogue(script, {
    startAt: "HostMathFns",
    variables: { $credits: 15 },
    library: (() => {
      const lib = new Library();
      lib.registerFunction("add", (a: unknown, b: unknown) => Number(a) + Number(b), { params: ["any", "any"], returns: "number" });
      lib.registerFunction("subtract", (a: unknown, b: unknown) => Number(a) - Number(b), { params: ["any", "any"], returns: "number" });
      return lib;
    })(),
  }, {
    declarations: { variables: { credits: { type: "number" } } },
  });

  const lines = drainTexts(dialogue);

  strictEqual(lines.includes("Credits 15"), true, "Should read initial credits");
  strictEqual(lines.includes("Final 30"), true, "Custom add/subtract functions should apply math");
  strictEqual(dialogue.getVariable("credits"), 30, "Stored variable should reflect final value");
});

test("<<call>> invokes the registered host function and discards the result (upstream CallStatement pin)", () => {
  let observed: string | null = null;
  let callCount = 0;
  const dialogue = makeDialogue(
    `
title: Start
---
<<call spy("hello")>>
<<call spy($who)>>
Mae: done
===
`,
    {
      variables: { $who: "second" },
      library: (() => {
        const lib = new Library();
        lib.registerFunction("spy", (v: unknown) => {
          observed = String(v);
          callCount++;
          return "this return value is discarded";
        });
        return lib;
      })(),
    },
  );

  const lines = drainTexts(dialogue);
  strictEqual(callCount, 2, "each <<call>> invokes its function once");
  strictEqual(observed, "second", "arguments evaluate; the last call wins");
  strictEqual(lines.includes("done"), true, "the dialogue continues after <<call>>");
  // `<<call>>` is a state statement: internal, never a Command event.
  strictEqual(lines.includes("spy"), false);
});

test("<<call>> of an unknown function is a runtime diagnostic, not a throw (§3)", () => {
  const errors: string[] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
<<call no_such_function(1)>>
Mae: still here
===
`,
    { logError: (message) => errors.push(message) },
  );

  const lines = drainTexts(dialogue);
  ok(
    errors.some((message) => message.includes("<<call>> failed") && message.includes("no_such_function")),
    `expected a <<call>> diagnostic, got: ${errors.join(" | ")}`,
  );
  strictEqual(lines.includes("still here"), true, "the run continues after the diagnostic");
});

test("<<wait>> is a consumer-timed command: delivered as a command event, then the batch stops", () => {
  const dialogue = makeDialogue(
    `
title: Start
---
Mae: before
<<wait 2>>
Mae: after the wait
===
`,
  );

  // Walk batches until the wait command is delivered; nothing follows it in
  // its batch — the delivered command is the stopping point, and the host
  // resumes on its own clock (the timer is the consumer's, not the library's).
  let commandText: string | null = null;
  let sawBefore = false;
  for (let i = 0; i < 10 && commandText === null; i++) {
    const batch = dialogue.continue();
    const commandIndex = batch.findIndex((event) => event.type === "command");
    if (commandIndex >= 0) {
      deepStrictEqual(
        batch.length,
        commandIndex + 1,
        "the delivered command is the batch's stopping point",
      );
      const commandEvent = batch[commandIndex];
      ok(commandEvent.type === "command");
      commandText = commandEvent.command;
      break;
    }
    sawBefore ||= batch.some((event) => event.type === "line" && event.text.includes("before"));
  }
  ok(sawBefore, "the line before the wait delivered first");
  strictEqual(commandText, "wait 2");

  // The next continue() delivers what follows the consumer-timed pause.
  const second = dialogue.continue();
  const after = second.find((event) => event.type === "line");
  ok(after && after.type === "line" && after.text.includes("after the wait"));
});
