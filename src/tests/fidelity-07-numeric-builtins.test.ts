// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 07: numeric & builtin fidelity — the runtime's operators
 * and builtin function library against upstream 3.2.2.
 *
 * Every expectation here was verified against the vendored upstream C#
 * (and, where the C# semantics hinge on .NET runtime behavior —
 * `Convert.ToInt32`'s midpoint rounding, `Convert.ToBoolean(string)`,
 * `float.ToString` — against a real .NET run of the same expressions):
 * - `%` converts both operands to int (upstream `ConvertTo<int>`:
 *   banker's rounding at midpoints) and divides-by-zero as an error
 *   (`NumberType.MethodModulus`, `Types/NumberType.cs:75-78`);
 * - `round`/`round_places` are C# `Math.Round` — midpoint-to-even
 *   (`Dialogue.cs` StandardLibrary);
 * - `number`/`bool` throw on unconvertible input (upstream
 *   `Convert.ToSingle`/`Convert.ToBoolean` FormatException);
 * - `decimal` preserves the sign (`value - trunc(value)`);
 * - `string` renders booleans with C# `Convert.ToString` casing;
 * - `random_range`/`random_range_float`/`dice` throw on invalid bounds
 *   (upstream `Random.Next` ArgumentOutOfRangeException) instead of
 *   clamping; `random_range_float` is registered;
 * - `format_invariant` renders at float (32-bit) precision, upstream's
 *   non-finite spellings ("NaN", "Infinity"), and C# exponent notation;
 * - `min`/`max` take exactly two arguments, `format` exactly one
 *   (upstream's declared parameters).
 *
 * Failures surface as runtime diagnostics (collect-don't-throw, coding
 * standards §3), so the throwing cases are asserted through `logError`.
 */

import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert";
import { compile } from "../index.js";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { Library } from "../runtime/library.js";
import { applyBinaryOp } from "../runtime/operands.js";

type LineEvent = Extract<DialogueEvent, { type: "line" }>;

function makeDialogue(
  source: string,
  opts?: ConstructorParameters<typeof Dialogue>[1],
): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

/** Evaluate one `{expr}` in a line and return the composed text. */
function evaluateText(
  expression: string,
  opts?: ConstructorParameters<typeof Dialogue>[1],
): string {
  const dialogue = makeDialogue(
    `
title: Start
---
Result: {${expression}}
===
`,
    opts,
  );
  const batch = dialogue.continue();
  const line = batch.find((e): e is LineEvent => e.type === "line");
  ok(line, `expected a line event for {${expression}}`);
  return line.text;
}

/** Compose the text a `<<set>>`-evaluated expression renders as. */
function setExpression(expression: string): string {
  const dialogue = makeDialogue(
    `
title: Start
---
<<declare $x = ''>>
<<set $x = ${expression}>>
Result: {$x}
===
`,
  );
  const texts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const batch = dialogue.continue();
    for (const event of batch) {
      if (event.type === "line") texts.push(event.text);
    }
    if (batch.some((e) => e.type === "dialogueComplete")) break;
  }
  return texts.join("|");
}

/** Collect runtime diagnostics while draining the dialogue. */
function drainCollectingErrors(dialogue: Dialogue): {
  texts: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const texts: string[] = [];
  for (let i = 0; i < 20; i++) {
    const batch = dialogue.continue();
    for (const event of batch) {
      if (event.type === "line") texts.push(event.text);
    }
    if (batch.some((e) => e.type === "dialogueComplete")) break;
  }
  return { texts, errors };
}

function runCollectingErrors(source: string): {
  texts: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const dialogue = makeDialogue(source, { logError: (m) => errors.push(m) });
  const texts: string[] = [];
  for (let i = 0; i < 20; i++) {
    const batch = dialogue.continue();
    for (const event of batch) {
      if (event.type === "line") texts.push(event.text);
    }
    if (batch.some((e) => e.type === "dialogueComplete")) break;
  }
  return { texts, errors };
}

// ── `%` — integer modulo (upstream NumberType.MethodModulus) ─────────────

test("% converts both operands to int (upstream ConvertTo<int>)", () => {
  equal(
    applyBinaryOp("modulo", 7.5, 2),
    0,
    "7.5 % 2: Convert.ToInt32(7.5) is 8 (midpoint-to-even), 8 % 2 = 0",
  );
  equal(applyBinaryOp("modulo", 7.2, 2), 1, "7.2 % 2: 7 % 2 = 1");
  equal(
    applyBinaryOp("modulo", 2.5, 2),
    0,
    "2.5 % 2: Convert.ToInt32(2.5) is 2 (midpoint-to-even)",
  );
  equal(applyBinaryOp("modulo", -7.5, 2), 0, "-7.5 % 2: -8 % 2 = 0");
  equal(applyBinaryOp("modulo", 7, 2), 1);
  equal(
    applyBinaryOp("modulo", -7, 2),
    -1,
    "C# remainder: sign follows the dividend",
  );
});

test("modulo by zero is a runtime error, not NaN", () => {
  const { errors } = runCollectingErrors(`
title: Start
---
<<set $x = 5 % 0>>
===
`);
  ok(errors.length > 0, "a modulo-by-zero raises a runtime error");
  const { texts } = runCollectingErrors(`
title: Start
---
Result: {5 % 0}
===
`);
  ok(
    !texts.some((t) => t.includes("NaN")),
    "modulo by zero never renders as NaN",
  );
});

// ── round / round_places — C# Math.Round (midpoint-to-even) ──────────────

test("round uses banker's rounding (upstream Math.Round)", () => {
  equal(evaluateText("round(2.5)"), "2", "round(2.5) is 2, not 3");
  equal(evaluateText("round(0.5)"), "0", "round(0.5) is 0");
  equal(evaluateText("round(1.5)"), "2");
  equal(evaluateText("round(3.5)"), "4");
  equal(evaluateText("round(-2.5)"), "-2");
  equal(evaluateText("round(2.4)"), "2");
});

test("round_places midpoints match banker's rounding", () => {
  equal(
    evaluateText("round_places(2.25, 1)"),
    "2.2",
    "2.25 to 1 place rounds to even → 2.2",
  );
  equal(
    evaluateText("round_places(2.35, 1)"),
    "2.4",
    "the scaled value 23.5 rounds to even → 2.4",
  );
  equal(evaluateText("round_places(2.5, 0)"), "2");
  equal(
    evaluateText("round_places(2.675, 2)"),
    "2.68",
    "the scaled value 267.5 rounds to even → 2.68",
  );
  equal(evaluateText("round_places(0.5, 0)"), "0");
  equal(evaluateText("round_places(1.5, 0)"), "2");
});

// ── number / bool — throw on failed coercion (upstream Convert.*) ────────

test("number() throws on unconvertible input (upstream Convert.ToSingle)", () => {
  const { errors } = runCollectingErrors(`
title: Start
---
<<set $x = number("abc")>>
===
`);
  ok(
    errors.length > 0,
    'number("abc") is a runtime error (upstream FormatException), not NaN',
  );
});

test("bool() parses true/false strings; other strings throw (upstream Convert.ToBoolean)", () => {
  // Upstream Convert.ToBoolean(string) accepts "true"/"false" (case-insensitive).
  equal(
    evaluateText('bool("false")'),
    "False",
    'bool("false") is False, not true',
  );
  equal(evaluateText('bool("False")'), "False");
  equal(evaluateText('bool("true")'), "True");
  // A non-boolean string is a FormatException upstream — a runtime error here.
  const { errors } = runCollectingErrors(`
title: Start
---
<<set $x = bool("abc")>>
===
`);
  ok(errors.length > 0, 'bool("abc") throws (upstream FormatException)');
});

// ── decimal / string — sign and casing ───────────────────────────────────

test("decimal preserves the sign (upstream value - trunc(value))", () => {
  equal(
    evaluateText("decimal(-1.5)"),
    "-0.5",
    "decimal(-1.5) is -0.5, not 0.5",
  );
  equal(evaluateText("decimal(1.5)"), "0.5");
  equal(evaluateText("decimal(3)"), "0");
});

test("string() renders booleans with upstream casing", () => {
  equal(evaluateText("string(true)"), "True");
  equal(evaluateText("string(false)"), "False");
});

// ── random_range / random_range_float / dice — bounds are errors ─────────

test("random_range with reversed bounds is a runtime error (upstream Random.Next throws)", () => {
  const { errors } = runCollectingErrors(`
title: Start
---
<<set $x = random_range(5, 1)>>
===
`);
  ok(
    errors.length > 0,
    "random_range(5, 1) throws upstream (ArgumentOutOfRangeException), it does not clamp",
  );
});

test("dice with non-positive sides is a runtime error", () => {
  const { errors } = runCollectingErrors(`
title: Start
---
<<set $x = dice(-5)>>
===
`);
  ok(
    errors.length > 0,
    "dice(-5) throws upstream (Random.Next ArgumentOutOfRangeException)",
  );
});

test("random_range returns a value in [min, trunc(max)] (integer span above min)", () => {
  const lib = new Library();
  let sequence = [0.0, 0.4999, 0.9999];
  let call = 0;
  // Drive Math.random deterministically to observe the span arithmetic:
  // upstream random_range(min, max) = Random.Next(trunc(max)-trunc(min)+1) + min.
  const originalRandom = Math.random;
  Math.random = () => sequence[Math.min(call++, sequence.length - 1)];
  try {
    const values = [
      Number(evaluateText("random_range(1.2, 3.7)")),
      Number(evaluateText("random_range(1.2, 3.7)")),
      Number(evaluateText("random_range(1.2, 3.7)")),
    ];
    deepStrictEqual(
      values,
      [1.2, 2.2, 3.2],
      "Next(span) + min: results ride above the untruncated min",
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("random_range_float is registered and follows upstream's integer-span semantics", () => {
  // Upstream: Random.Next((int)max - (int)min + 1) + minInclusive.
  const originalRandom = Math.random;
  Math.random = () => 0.9999;
  try {
    equal(
      Number(evaluateText("random_range_float(2, 5)")),
      5,
      "span covers the inclusive max",
    );
  } finally {
    Math.random = originalRandom;
  }

  const { errors } = runCollectingErrors(`
title: Start
---
<<set $x = random_range_float(5, 1)>>
===
`);
  ok(errors.length > 0, "reversed bounds throw, like random_range");
});

// ── format_invariant — upstream float rendering ──────────────────────────

test("format_invariant renders at float (32-bit) precision", () => {
  // 1/3 as a C# float is 0.33333334 (float32 shortest round-trip), not the
  // double's 0.3333333333333333. (Avoid a `1.0` literal here: the string
  // evaluator's decimal-literal resolution is not this ticket's file.)
  equal(evaluateText("format_invariant(1/3)"), "0.33333334");
  equal(evaluateText("format_invariant(0.5)"), "0.5");
  equal(evaluateText("format_invariant(5)"), "5");
  equal(
    evaluateText("format_invariant(123456789)"),
    "123456790",
    "values round-trip through float32",
  );
});

test("format_invariant non-finite handling matches upstream spellings", () => {
  equal(
    evaluateText("format_invariant(5/0)"),
    "Infinity",
    "positive infinity renders as Infinity, not 0",
  );
  equal(evaluateText("format_invariant(-5/0)"), "-Infinity");
  equal(evaluateText("format_invariant(0/0)"), "NaN");
});

test("format_invariant uses C# exponent notation outside the plain window", () => {
  // Upstream float.ToString(InvariantCulture): scientific below 1e-5 and
  // at 1e9 and above; exponent form "E±XX" with a sign and two digits.
  equal(evaluateText("format_invariant(0.00001)"), "1E-05");
  equal(evaluateText("format_invariant(0.0001)"), "0.0001");
  equal(evaluateText("format_invariant(100000000)"), "100000000");
  equal(evaluateText("format_invariant(1000000000)"), "1E+09");
});

// ── min / max / format — upstream arity ──────────────────────────────────

test("min and max take exactly two arguments (upstream arity)", () => {
  equal(evaluateText("min(3, 1)"), "1");
  equal(evaluateText("max(3, 1)"), "3");
  // A 3-argument call is a compile diagnostic (the library signature is the
  // two-parameter upstream shape), not a silently accepted extra argument.
  const result = compile([
    {
      name: "s.yarn",
      source: "title: Start\n---\nResult: {min(3, 1, 2)}\n===\n",
    },
  ]);
  ok(
    result.diagnostics.some(
      (d) => d.code === "YS0014" && /min expects 2 parameters/.test(d.message),
    ),
    `expected an arity diagnostic, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
  );
});

test("format accepts exactly one argument (upstream arity)", () => {
  // (via a command — a `{0}` placeholder inside an inline `{expr}` span
  // collides with the line substitution scanner's first-`}` contract)
  equal(setExpression("format('x{0}y', 5)"), "x5y");
  const result = compile([
    {
      name: "s.yarn",
      source:
        "title: Start\n---\n<<declare $x = ''>>\n<<set $x = format(\"x{0}{1}y\", 5, 6)>>\n===\n",
    },
  ]);
  ok(
    result.diagnostics.some(
      (d) =>
        d.code === "YS0014" && /format expects 2 parameters/.test(d.message),
    ),
    `expected an arity diagnostic, got: ${result.diagnostics.map((d) => d.code).join(", ")}`,
  );
});
