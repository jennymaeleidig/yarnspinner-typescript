// SPDX-License-Identifier: CC0-1.0
/**
 * Runtime tests over the instruction-stream program: the
 * VM executes the compiled bytecode (ADR 0001) behind the public runtime
 * API — the one `Dialogue` event stream since the tree IR retired.
 *
 * Coverage here is the VM behavior the conformance corpus leaves implicit:
 * full-set option delivery with availability flags, the no-option-selected
 * fall-through, node lifecycle across jumps, codegen-failure fallbacks,
 * per-instance generated-variable state, and the variable access surface.
 * (Coding standards §6: assertions only through the compile → run seam.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource, Dialogue, noOptionSelected } from "../index.js";
import type { Dialogue as DialogueClass } from "../index.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import type { Program } from "../compile/program.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof DialogueClass>[1]): DialogueClass {
  const result = compileSource(source);
  assert.ok(result.program, "the compile seam emits a program");
  return new Dialogue(result.program, { startAt: "Start", ...opts });
}

/** Run the dialogue to completion, auto-selecting via `onOptions`. */
function drain(
  dialogue: DialogueClass,
  onOptions: (count: number) => number | typeof noOptionSelected,
): DialogueEvent[] {
  return runUntilCompleteEvents(dialogue, (options) => onOptions(options.length));
}

const textsOf = (events: DialogueEvent[]) =>
  events.filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line").map((e) => e.text);

// ── Linear flow ──────────────────────────────────────────────────────────

test("the VM runs linear flow end-to-end: lines, sets, ifs, node lifecycle", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<declare $count = 0>>
<<set $count to {$count} + 1>>
Narrator: Count is {$count}
<<if $count == 1>>
    First!
<<else>>
    Later
<<endif>>
<<jump End>>
===
title: End
---
Done
===
`);
  const events = drain(dialogue, () => noOptionSelected);
  assert.deepEqual(
    events.map((e) => e.type),
    ["nodeStart", "line", "line", "nodeComplete", "nodeStart", "line", "nodeComplete", "dialogueComplete"],
  );
  assert.deepEqual(textsOf(events), ["Count is 1", "First!", "Done"]);
  assert.equal(dialogue.currentNode, null, "a completed dialogue is not in a node");
  assert.equal(dialogue.isActive, false);
});

test("events batch to stopping points: one line per continue()", () => {
  const dialogue = makeDialogue(`
title: Start
---
One
Two
===
`);
  const first = dialogue.continue();
  assert.deepEqual(first.map((e) => e.type), ["nodeStart", "line"]);
  const second = dialogue.continue();
  assert.deepEqual(second.map((e) => e.type), ["line"]);
  const last = dialogue.continue();
  assert.deepEqual(last.map((e) => e.type), ["nodeComplete", "dialogueComplete"]);
});

// ── Options ──────────────────────────────────────────────────────────────

test("the VM delivers the full option set with availability flags", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<declare $flag = false>>
Choose
-> Hidden <<if $flag>>
    Never picked
-> Shown
    Picked
===
`);
  // The set arrives in its own batch (the "Choose" line stops the previous one).
  let batch = dialogue.continue();
  while (!batch.some((e) => e.type === "options")) {
    batch = dialogue.continue();
  }
  const options = batch.find((e): e is Extract<DialogueEvent, { type: "options" }> => e.type === "options");
  assert.ok(options, "an options event is delivered");
  // The full set, in authored order — unavailable options included
  // (upstream OptionSet semantics; availability is advisory).
  assert.deepEqual(
    options.options.map((o) => [o.text, o.isAvailable]),
    [
      ["Hidden", false],
      ["Shown", true],
    ],
  );

  // Selecting the available option runs its body and resumes after the block.
  dialogue.selectOption(1);
  const rest = drain(dialogue, () => noOptionSelected);
  assert.deepEqual(textsOf(rest), ["Picked"]);
});

test("selectOption(noOptionSelected) falls through the options block", () => {
  const dialogue = makeDialogue(`
title: Start
---
Choose
-> Only
    Body
After
===
`);
  dialogue.continue();
  dialogue.selectOption(noOptionSelected);
  const rest = drain(dialogue, () => noOptionSelected);
  // The option body is skipped entirely; execution resumes after the block.
  assert.deepEqual(textsOf(rest), ["After"]);
});

test("an uncompilable option condition delivers the option as unavailable", () => {
  // `$a +` cannot compile; the evaluator's catch → false is the observable
  // contract, so the fallback pins the option unavailable (not missing).
  const dialogue = makeDialogue(`
title: Start
---
-> Broken <<if $a +>>
    Never
-> Fine
    Body
===
`);
  const batch = dialogue.continue();
  const options = batch.find((e): e is Extract<DialogueEvent, { type: "options" }> => e.type === "options");
  assert.ok(options);
  assert.deepEqual(
    options.options.map((o) => [o.text, o.isAvailable]),
    [
      ["Broken", false],
      ["Fine", true],
    ],
  );
});

test("selectOption with an out-of-range index is a diagnostic, not a crash", () => {
  const errors: string[] = [];
  const dialogue = makeDialogue(
    `
title: Start
---
-> Only
    Body
===
`,
    { logError: (m) => errors.push(m) },
  );
  dialogue.continue();
  dialogue.selectOption(5);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not a valid option/);
  // The set is still pending: a valid selection still works.
  dialogue.selectOption(0);
  assert.deepEqual(textsOf(drain(dialogue, () => noOptionSelected)), ["Body"]);
});

// ── State ────────────────────────────────────────────────────────────────

test("host variables seed storage; smart variables recompute on the VM", () => {
  const dialogue = makeDialogue(
    `
title: Start
---
<<declare $gold = 0>>
<<declare $doubled = $gold * 2>>
Narrator: You have {$gold} ({$doubled} doubled)
===
`,
    { variables: { $gold: 25 } },
  );
  drain(dialogue, () => noOptionSelected);
  assert.equal(dialogue.getVariable("gold"), 25);
  const doubled = dialogue.tryGetSmartVariable("doubled");
  assert.ok(doubled.ok && doubled.value === 50, "the smart variable recomputes");

  dialogue.setVariable("gold", 7);
  const recomputed = dialogue.tryGetSmartVariable("doubled");
  assert.ok(recomputed.ok && recomputed.value === 14, "recomputing tracks new storage");

  const visible = dialogue.getVariables();
  assert.equal(visible["gold"], 7);
  for (const key of Object.keys(visible)) {
    assert.ok(!key.startsWith("Yarn.Internal."), "generated variables are not story variables");
  }
});

test("generated-variable state is per-instance: two dialogues never share state", () => {
  const source = `
title: Start
---
-> Opt <<once>>
    Once body
Always
===
`;
  const first = makeDialogue(source);
  assert.deepEqual(textsOf(drain(first, () => 0)), ["Once body", "Always"]);

  const second = makeDialogue(source);
  assert.deepEqual(
    textsOf(drain(second, () => 0)),
    ["Once body", "Always"],
    "a new dialogue starts with clean generated-variable state",
  );
});

test("setNode preserves variables but restarts execution; stop() completes", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<declare $x = 1>>
Narrator: x is {$x}
===
title: Other
---
Narrator: other node
===
`);
  drain(dialogue, () => noOptionSelected);
  dialogue.setNode("Other");
  assert.equal(dialogue.currentNode, "Other");
  assert.equal(dialogue.getVariable("x"), 1, "variables survive setNode");
  assert.deepEqual(textsOf(drain(dialogue, () => noOptionSelected)), ["other node"]);

  dialogue.setNode("Start");
  dialogue.stop();
  // The nodeStart queued by setNode() still delivers; nothing else runs.
  const afterStop = dialogue.continue();
  assert.deepEqual(afterStop.map((e) => e.type), ["nodeStart", "dialogueComplete"]);
  assert.equal(dialogue.isActive, false);
});

// ── Line hints ───────────────────────────────────────────────────────────

test("lineHints events are opt-in and cover line and option IDs", () => {
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
  assert.equal(first[1].type, "nodeStart");
  const hintIds = first[0].type === "lineHints" ? first[0].lineIds : [];
  assert.ok(hintIds.length >= 2, "line and option text IDs are hinted");

  const withoutHints = makeDialogue(source);
  assert.equal(withoutHints.continue()[0].type, "nodeStart", "no hints by default");
});

// ── Format dispatch ──────────────────────────────────────────────────────

const EQUIVALENCE_SOURCES: Record<string, string> = {
  "linear flow": `
title: Start
---
Narrator: Same events either way
===
`,
  "logical operators coerce to booleans": `
title: Start
---
<<set $x to 1 and 2>>
<<set $y to 0 or "">>
Result: {$x} {$y}
===
`,
  "nested option groups with conditions": `
title: Start
---
<<declare $on = true>>
-> Outer <<if $on>>
    -> Inner
        Deep
    -> Inner2 <<if not $on>>
        Deep2
    Back
-> Outer2
    Other
===
`,
  "compound assignment and string rendering": `
title: Start
---
<<declare $n = 45>>
<<set $n += 1>>
<<set $s = "v" + $n>>
{$s} {$n}
===
`,
};

test("event streams across the surface", () => {
  for (const [name, source] of Object.entries(EQUIVALENCE_SOURCES)) {
    const result = compileSource(source);
    assert.ok(result.program, `${name}: compiles`);
    const run = (program: ConstructorParameters<typeof DialogueClass>[0]) => {
      const dialogue = new Dialogue(program);
      return drain(dialogue, (count) => (count > 0 ? 0 : noOptionSelected));
    };
    const summarize = (events: DialogueEvent[]) =>
      events.map((e) =>
        e.type === "line"
          ? `line:${e.text}`
          : e.type === "options"
            ? `options:[${e.options.map((o) => `${o.text}${o.isAvailable ? "" : "!"}`).join("|")}]`
            : e.type,
      );
    assert.ok(summarize(run(result.program))!.length > 0, `${name}: delivers events`);
  }
});

test("logical operators produce booleans", () => {
  // `1 and 2` is 1 && 2 = 2 on raw JS values; the runtime contract is the
  // evaluator's `!!`-coerced boolean.
  const source = EQUIVALENCE_SOURCES["logical operators coerce to booleans"];
  const dialogue = new Dialogue(compileSource(source).program!);
  drain(dialogue, () => noOptionSelected);
  assert.equal(dialogue.getVariable("x"), true);
  assert.equal(dialogue.getVariable("y"), false);
});

// --- xor in the string-evaluator fallback (deepening-wave-2 ticket 03) ---
// The `xor` word alias is not in codegen's word-alias table (ticket 08's
// grammar diff), so expressions authored with it fail codegen and ride the
// fallback paths — where 850d579's xor fix missed the string evaluator
// (`true xor false` evaluated to false). These pins exercise xor through
// both fallback consumers, the paths no earlier test evaluated.

test("uncompilable <<set>> with xor evaluates bool-xor through the fallback", () => {
  // `xor` fails codegen (word-alias gap) → the raw-command fallback →
  // the string evaluator. Upstream BooleanType.MethodXor: bool ^ bool.
  const dialogue = makeDialogue(`
title: Start
---
<<set $a to true>>
<<set $b to false>>
<<set $x to $a xor $b>>
<<set $y to $a xor $a>>
Narrator: {$x} / {$y}
===
`);
  const events = runUntilCompleteEvents(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "True / False");
});

test("a when: condition with xor selects saliency through the fallback", () => {
  // Node-group conditions compile lazily; the `xor` word fails codegen and
  // the string evaluator decides. $a xor $b with (true, false) → true, so
  // the xor member is the only eligible one and the jump lands there.
  const dialogue = makeDialogue(`
title: Start
---
<<set $a to true>>
<<set $b to false>>
<<jump Group>>
===
title: Group
---
Narrator: plain member
===
title: Group
when: $a xor $b
---
Narrator: xor member
===
title: Group
when: $a xor $a
---
Narrator: never eligible
===
`);
  const events = runUntilCompleteEvents(dialogue);
  const lines = events
    .filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line")
    .map((e) => e.text);
  assert.deepEqual(lines, ["xor member"]);
});

// --- mixed comparison+logical layering in the fallback (ticket 09) ---
// The fallback evaluator dispatched comparison splitting BEFORE the
// logical level, so `$a == 1 && $b > 2` evaluated as
// `$a == ((1 && $b) > 2)` — the opposite of the checker's parse, the
// codegen's parse, and upstream's single grammar. A leading `!` claimed
// the comparison dispatcher too (`!true` threw), and a fully
// parenthesized logical `(1 && 0)` recursed infinitely. All through the
// same dispatch — one fix, these pins on the inline-text path (inline
// `{expr}` composes through the string evaluator at delivery, ADR 0005).

test("inline text: comparison and logical levels layer like the checker parses them", () => {
  // Checker/codegen parse ($a == 1) && ($b > 2). The old evaluator parsed
  // $a == ((1 && $b) > 2) and composed "True" here (verified pre-fix:
  // and(1,1) folded to true, true > 2 to false via number coercion, and
  // 1 == false collapsed to 1 == 1).
  const dialogue = makeDialogue(`
title: Start
---
<<set $a to 1>>
<<set $b to 1>>
Narrator: {$a == 1 && $b > 2} / {$a == 1 && $b > 0}
===
`);
  const events = runUntilCompleteEvents(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "False / True");
});

test("fallback evaluator: negation is reachable and binds like unary", () => {
  // `!true` used to throw ("Invalid comparison") — the bare `!` claimed
  // the comparison dispatcher. `!$flag == true` parses as (!flag) == true
  // upstream (unary binds to the first operand) → true == true → True.
  const dialogue = makeDialogue(`
title: Start
---
<<set $flag to false>>
Narrator: {!true} / {!$flag} / {!$flag == true}
===
`);
  const events = runUntilCompleteEvents(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "False / True / True");
});

test("fallback evaluator: parens and quotes no longer crash or split wrong", () => {
  // `(1 && 0)` used to recurse infinitely (stack overflow); `&&` inside a
  // string literal used to split at the wrong place.
  const dialogue = makeDialogue(`
title: Start
---
Narrator: {(1 && 0)} / {1 < 2 && "&&" != ""}
===
`);
  const events = runUntilCompleteEvents(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "False / True");
});

test("inline text: the || branch layers like the checker parses them too", () => {
  // The ticket-09 pin table's named case (`a || b == c`): the checker and
  // the codegen parse $a || ($b == $c); the pre-fix evaluator parsed
  // ($a || $b) == $c (comparison split first) and composed "False" here.
  const dialogue = makeDialogue(`
title: Start
---
<<set $a to true>>
<<set $b to false>>
Narrator: {$a || $b == $b} / {$b || $a == $b}
===
`);
  const events = runUntilCompleteEvents(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  // true || (false == false) → True; false || (true == false) → False.
  assert.equal(line.text, "True / False");
});

// --- the four-consumer agreement through the fallback (ticket 05) ---
// The review's spec axis flagged ticket 05's Tests item as partial: the
// fallback path's structural agreement was pinned only indirectly. These
// pins walk one statement through all four consumers: the checker
// validates the word alias, the codegen defers (word-xor is not in its
// alias table — ADR 0005's recorded gap), the raw command rides
// runCommand, the state-statement grammar parses the same shape the
// checker validated, and the evaluator applies the operand-semantics
// module's rules.

test("uncompilable <<set>> with a word alias agrees structurally across the consumers", () => {
  // `xor` fails codegen → the raw command → parseStateStatement → the
  // string evaluator applies bool-xor. $n starts false; $n xor true → true.
  const dialogue = makeDialogue(`
title: Start
---
<<set $n to false>>
<<set $n to $n xor true>>
Narrator: {$n}
===
`);
  const events = runUntilCompleteEvents(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "True");
});

test("uncompilable <<set>> with trailing garbage lands best-effort, not crash", () => {
  // `1 2` fails codegen (trailing input) → the raw command → the same
  // grammar parse → best-effort evaluation (the evaluator yields no value;
  // no diagnostic channel fires — the fallback path's documented
  // collect-don't-throw shape). The line composes and $m stays empty.
  const dialogue = makeDialogue(`
title: Start
---
<<set $m to 1 2>>
Narrator: value={$m}
===
`);
  const events = runUntilCompleteEvents(dialogue);
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "value=");
});
