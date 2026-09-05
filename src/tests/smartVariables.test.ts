// SPDX-License-Identifier: CC0-1.0
/**
 * Smart variables end-to-end.
 *
 * Upstream contract (Yarn Spinner 3.2):
 * - A `<<declare>>` whose initial value is anything other than a plain
 *   literal (number with optional single unary minus, string, `true`/`false`,
 *   or an enum member reference) is a *smart variable* (upstream
 *   "inline expansion", `Declaration.IsInlineExpansion`) — including
 *   parenthesized literals like `(1)` (YS0030 registry example).
 * - Smart variables are read-only: `<<set>>` to one is the YS0030 compile
 *   error "…cannot be modified (it's a smart variable and is always equal
 *   to …)".
 * - Smart variables are recomputed on every access, and may reference other
 *   smart variables so long as no reference loop exists — loops are the
 *   YS0045 compile error "Smart variables cannot contain reference loops
 *   (referencing … here creates a loop for the smart variable …)".
 * - The runtime exposes `tryGetSmartVariable` (upstream
 *   `Dialogue.TryGetSmartVariable`); a host write to the same name shadows
 *   the smart variable (upstream `VariableKind.Stored` wins).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../index.js";
import { Dialogue } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import type { Diagnostic } from "../compile/diagnostics.js";
import { hasErrors } from "../compile/diagnostics.js";
import type { Program } from "../compile/program.js";

function compile(source: string): {
  program: Program | null;
  diagnostics: Diagnostic[];
} {
  return compileSource(source);
}

test("a declare over a plain literal is a stored variable, not a smart variable", () => {
  const result = compile(`title: Start
---
<<declare $x = -1>>
<<set $x += 1>>
===
`);
  assert.equal(
    hasErrors(result.diagnostics),
    false,
    JSON.stringify(result.diagnostics),
  );
  assert.equal(result.program?.smartVariables["x"], undefined);
  assert.equal(result.program?.initialValues["x"] !== undefined, true);
});

test("a declare whose initializer references variables is a smart variable", () => {
  const result = compile(`title: Start
---
<<declare $money = 0>>
<<declare $can_afford = $money > 10>>
===
`);
  assert.equal(
    hasErrors(result.diagnostics),
    false,
    JSON.stringify(result.diagnostics),
  );
  // Smart variables compile their initializer to bytecode (the
  // compiled form).
  assert.deepEqual(result.program?.smartVariables["can_afford"], [
    { op: "pushVariable", name: "money" },
    { op: "pushNumber", value: 10 },
    { op: "greaterThan" },
  ]);
  // Smart variables have no initial value (upstream: not in InitialValues).
  assert.equal(result.program?.initialValues["can_afford"], undefined);
});

test("a parenthesized literal is a smart variable (upstream YS0030 registry example)", () => {
  const result = compile(`title: Start
---
<<declare $x = (1)>>
<<set $x = 2>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0030"]);
});

test("YS0030: setting a smart variable is a compile error with the upstream message", () => {
  const result = compile(`title: Start
---
<<declare $money = 0>>
<<declare $can_afford = $money > 10>>
<<set $can_afford = true>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0030"]);
  assert.equal(
    result.diagnostics[0].message,
    "$can_afford cannot be modified (it's a smart variable and is always equal to $money > 10)",
  );
});

test("YS0030: compound assignment to a smart variable is also read-only", () => {
  const result = compile(`title: Start
---
<<declare $money = 0>>
<<declare $double = $money * 2>>
<<set $double += 1>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0030"]);
});

test("YS0045: a smart-variable reference loop is a compile error with the upstream message", () => {
  const result = compile(`title: Start
---
<<declare $A = $B || false>>
<<declare $B = $C>>
<<declare $C = $A || (2 > 1)>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0045", "YS0045", "YS0045"]);
  assert.equal(
    result.diagnostics[0].message,
    "Smart variables cannot contain reference loops (referencing $A here creates a loop for the smart variable A).",
  );
});

test("YS0045: a self-referencing smart variable is a loop", () => {
  const result = compile(`title: Start
---
<<declare $a = $a + 1>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0045"]);
});

test("smart variables may reference other smart variables without a loop", () => {
  const result = compile(`title: Start
---
<<declare $player_money = 0>>
<<declare $player_can_afford_pie = $player_money > 10>>
<<declare $a = false as bool>>
<<declare $b = false as bool>>
<<declare $C = (((!$a) && $b) || $b)>>
<<declare $D = $C || $player_can_afford_pie>>
<<declare $E = $C || $C>>
===
`);
  assert.equal(
    hasErrors(result.diagnostics),
    false,
    JSON.stringify(result.diagnostics),
  );
  assert.deepEqual(Object.keys(result.program?.smartVariables ?? {}).sort(), [
    "C",
    "D",
    "E",
    "player_can_afford_pie",
  ]);
});

test("smart variables are recomputed on every access", () => {
  const { program } = compile(`title: Start
---
<<declare $money = 0>>
<<declare $can_afford = $money > 10>>
<<if $can_afford>>
    Player: One pie, please.
<<else>>
    Player: Can I have a pie?
<<endif>>
===
`);
  assert.ok(program);
  const dialogue = new Dialogue(program!, { startAt: "Start" });
  assert.equal(nextLine(dialogue), "Can I have a pie?");

  // Same dialogue, changed inputs: the smart variable recomputes. The
  // re-executed declare instruction is an initialization, not an
  // assignment (upstream: declares are Program.InitialValues, seeded at
  // start-up), so the host-written input survives node re-entry.
  dialogue.setNode("Start");
  dialogue.setVariable("money", 15);
  assert.equal(nextLine(dialogue), "One pie, please.");
});

/** The first line event of the dialogue. */
function nextLine(dialogue: Dialogue): string {
  const event = runUntilCompleteEvents(dialogue).find(
    (e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line",
  );
  if (!event) throw new Error("stalled without a line event");
  return event.text;
}

test("tryGetSmartVariable computes the current value on access", () => {
  const { program } = compile(`title: Start
---
<<declare $money = 5>>
<<declare $double = $money * 2>>
===
`);
  const dialogue = new Dialogue(program!, { startAt: "Start" });
  const result = dialogue.tryGetSmartVariable("double");
  assert.deepEqual(result, { ok: true, value: 10 });

  dialogue.setVariable("money", 7);
  assert.deepEqual(dialogue.tryGetSmartVariable("double"), {
    ok: true,
    value: 14,
  });

  // Non-smart and unknown names report failure (upstream TryGetSmartVariable).
  assert.equal(dialogue.tryGetSmartVariable("money").ok, false);
  assert.equal(dialogue.tryGetSmartVariable("nope").ok, false);
});

test("a host write to a smart variable name shadows it (upstream VariableKind.Stored wins)", () => {
  const { program } = compile(`title: Start
---
<<declare $money = 1>>
<<declare $double = $money * 2>>
===
`);
  const dialogue = new Dialogue(program!, { startAt: "Start" });
  dialogue.setVariable("double", 99);
  assert.deepEqual(dialogue.tryGetSmartVariable("double"), {
    ok: true,
    value: 99,
  });
});

test("smart variables appear in the compile result's declarations", () => {
  const result = compileSource(`title: Start
---
<<declare $money = 0>>
<<declare $can_afford = $money > 10>>
===
`);
  const declarations = Object.fromEntries(
    result.declarations.map((d) => [d.name, d]),
  );
  assert.equal(declarations["can_afford"].isSmartVariable, true);
  assert.equal(declarations["can_afford"].defaultValue, undefined);
  assert.equal(declarations["money"].isSmartVariable, undefined);
});

function codesOf(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}
