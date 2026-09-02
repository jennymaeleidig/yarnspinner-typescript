import { test } from "node:test";
import { strictEqual, ok, match } from "node:assert";
import { parseYarn, compile } from "../index.js";
import { Dialogue, Library } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compile(parseYarn(source));
  return new Dialogue(program, { startAt: "Start", ...opts });
}

function drain(dialogue: Dialogue, guard = 100): DialogueEvent[] {
  const events: DialogueEvent[] = [];
  for (let i = 0; i < guard; i++) {
    const batch = dialogue.continue();
    if (batch.length === 0) break;
    events.push(...batch);
    if (events[events.length - 1].type === "dialogueComplete") break;
  }
  return events;
}

const firstLine = (dialogue: Dialogue): Extract<DialogueEvent, { type: "line" }> => {
  const events = drain(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  if (!line) throw new Error("Expected a line event");
  return line;
};

const composed = (line: Extract<DialogueEvent, { type: "line" }>): string =>
  line.speaker ? `${line.speaker}: ${line.text}` : line.text;

test("custom functions", () => {
  const yarnText = `
title: CustomFuncs
---
<<declare $doubled = multiply(2, 3)>>
<<declare $concatenated = concat("Hello", " World")>>
<<declare $power = pow(2, 3)>>
<<declare $conditionalValue = ifThen(true, "yes", "no")>>
Result: {$doubled}, {$concatenated}, {$power}, {$conditionalValue}
===
`;

  const dialogue = makeDialogue(yarnText, {
    startAt: "CustomFuncs",
    library: (() => {
      const lib = new Library();
      lib.registerFunction("multiply", (a, b) => Number(a) * Number(b));
      lib.registerFunction("concat", (a, b) => String(a) + String(b));
      lib.registerFunction("pow", (base, exp) => Math.pow(Number(base), Number(exp)));
      lib.registerFunction("ifThen", (cond, yes, no) => Boolean(cond) ? yes : no);
      return lib;
    })(),
  });

  // `<<declare>>` statements are internal: the first continue() delivers
  // the composed result line directly.
  const line = firstLine(dialogue);
  strictEqual(composed(line), "Result: 6, Hello World, 8, yes");
});

test("custom functions with type coercion", () => {
  const yarnText = `
title: TypeCoercion
---
<<declare $numFromStr = multiply("2", "3")>>
<<declare $concatNums = concat(123, 456)>>
<<declare $boolStr = ifThen("true", 1, 0)>>
Result: {$numFromStr}, {$concatNums}, {$boolStr}
===
`;

  const dialogue = makeDialogue(yarnText, {
    startAt: "TypeCoercion",
    library: (() => {
      const lib = new Library();
      lib.registerFunction("multiply", (a, b) => Number(a) * Number(b));
      lib.registerFunction("concat", (a, b) => String(a) + String(b));
      lib.registerFunction("ifThen", (cond, yes, no) => Boolean(cond) ? yes : no);
      return lib;
    })(),
  });

  const line = firstLine(dialogue);
  strictEqual(composed(line), "Result: 6, 123456, 1");
});

test("custom functions error handling", () => {
  const yarnText = `
title: ErrorHandling
---
<<declare $result = safeDivide(10, 0)>>
Result: {$result}
===
`;

  const dialogue = makeDialogue(yarnText, {
    startAt: "ErrorHandling",
    library: (() => {
      const lib = new Library();
      lib.registerFunction("safeDivide", (a, b) => {
        const numerator = Number(a);
        const denominator = Number(b);
        return denominator === 0 ? "Cannot divide by zero" : numerator / denominator;
      });
      return lib;
    })(),
  });

  const line = firstLine(dialogue);
  strictEqual(composed(line), "Result: Cannot divide by zero");
});

test("custom functions alongside built-in functions", () => {
  const yarnText = `
title: MixedFunctions
---
<<declare $random = random()>>
<<declare $doubled = multiply($random, 2)>>
<<declare $formatted = format_number($doubled)>>
Result: {$formatted}
===
`;

  const dialogue = makeDialogue(yarnText, {
    startAt: "MixedFunctions",
    library: (() => {
      const lib = new Library();
      lib.registerFunction("multiply", (a, b) => Number(a) * Number(b));
      lib.registerFunction("format_number", (n) => Number(n).toFixed(2));
      return lib;
    })(),
  });

  const line = firstLine(dialogue);
  const fullText = composed(line);
  const resultNumber = parseFloat(fullText.replace("Result: ", ""));
  ok(resultNumber >= 0);
  ok(resultNumber <= 2);
  match(fullText, /Result: \d+\.\d{2}/);
});
