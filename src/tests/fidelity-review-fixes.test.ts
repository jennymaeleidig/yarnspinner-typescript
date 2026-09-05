// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity-review fixes regression tests.
 *
 * Finding 1 — constant initializers that cannot be evaluated reported at
 * compile: `<<declare $a = 5 % 0>>` used to compile with zero diagnostics
 * (the initializer lowered to a smart-variable slice and failed only when
 * first read at runtime). A failed compile-time evaluation of a constant
 * initializer now reports YS0037 (InvalidLiteralValue — upstream's code for
 * a constant value that cannot be parsed or is of an unexpected type) so
 * the failure is visible at the compile seam (coding standards §3:
 * collect, don't throw). This is a recorded divergence: upstream 3.2.2
 * compiles the declare silently (ResolveInitialValues marks the non-literal
 * initializer inline-expanded) and its `NumberType.MethodModulus` throws
 * DivideByZeroException at runtime on first read; the port keeps the
 * runtime behavior (the slice still evaluates at read time) and adds the
 * compile-time report. `5 / 0` is NOT a failure: upstream's
 * `NumberType.MethodDivide` is float division (Infinity, no exception), so
 * a constant `5 / 0` initializer compiles clean and reads as Infinity.
 *
 * Seams: the compile result (diagnostics channel) and the runtime event
 * stream + variable storage.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../compile/compileSource.js";
import { Dialogue } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";

const drain = runUntilCompleteEvents;

test("a declare initializer whose constant evaluation fails reports YS0037", () => {
  // `5 % 0` is a constant expression whose evaluation fails (upstream
  // NumberType.MethodModulus throws DivideByZeroException on a zero
  // divisor). The compile must report the failure — never silence.
  const { diagnostics } = compileSource(
    "title: Start\n---\n<<declare $a = 5 % 0>>\n===",
  );
  const hits = diagnostics.filter(
    (d) => d.code === "YS0037" && d.severity === "error",
  );
  assert.equal(
    hits.length,
    1,
    `expected one YS0037 error, got ${JSON.stringify(diagnostics)}`,
  );
});

test("a valid constant declare (5 % 2) compiles clean and reads as 1", () => {
  const source = "title: Start\n---\n<<declare $a = 5 % 2>>\n{ $a }\n===";
  const { program, diagnostics } = compileSource(source);
  assert.ok(
    !diagnostics.some((d) => d.severity === "error"),
    `expected no error diagnostics, got ${JSON.stringify(diagnostics)}`,
  );
  const dialogue = new Dialogue(program!);
  const text = drain(dialogue)
    .filter((e) => e.type === "line")
    .map((e) => (e as { text: string }).text);
  assert.deepEqual(text, ["1"]);
});

test("a constant divide by zero is not a failure (upstream float division)", () => {
  // Upstream's NumberType.MethodDivide is float division — a zero divisor
  // yields Infinity, no exception (only integer modulo throws). A constant
  // `5 / 0` initializer must compile clean and read as Infinity.
  const source = "title: Start\n---\n<<declare $a = 5 / 0>>\n{ $a }\n===";
  const { program, diagnostics } = compileSource(source);
  assert.ok(
    !diagnostics.some((d) => d.severity === "error"),
    `expected no error diagnostics, got ${JSON.stringify(diagnostics)}`,
  );
  const dialogue = new Dialogue(program!);
  const text = drain(dialogue)
    .filter((e) => e.type === "line")
    .map((e) => (e as { text: string }).text);
  assert.deepEqual(text, ["Infinity"]);
});

test("the failing initializer still lowers to a smart-variable slice (program shape unchanged)", () => {
  // The diagnostic adds visibility; the program shape is unchanged — the
  // initializer remains a smart variable evaluated at read time (upstream
  // IsInlineExpansion), so the runtime still surfaces its failure through
  // the collect-don't-throw channel rather than a throw.
  const { program } = compileSource(
    "title: Start\n---\n<<declare $a = 5 % 0>>\n===",
  );
  assert.ok(
    program,
    "the program must stay observable (recorded keep-it-observable divergence)",
  );
  assert.ok(
    program.smartVariables.a,
    "the initializer still lowers to a smart-variable slice",
  );
});
