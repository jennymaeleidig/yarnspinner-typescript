// SPDX-License-Identifier: CC0-1.0
/**
 * Pins for the bytecode-slice runner (src/runtime/bytecode.ts) — module
 * tier, like the operands/stateStatement/walk tables. The runner's
 * interface is the test surface: stack save/restore, the emitter-owned op
 * gate, the balanced-stack contract, and error propagation. The VM's
 * failure policies (condition fallback, initializer context) stay pinned
 * end-to-end in vm-runtime.test.ts; coding standards §6 pins behavior
 * through seams, and this module tier is one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPRESSION_OPS,
  LITERAL_OPS,
  compileExpression,
} from "../compile/expressionCodegen.js";
import {
  ForeignOpError,
  UnbalancedStackError,
  runBytecode,
} from "../runtime/bytecode.js";
import { applyBinaryOp } from "../runtime/operands.js";
import type { Instruction } from "../compile/program.js";

/** A minimal driver: literal pushes and one binary op — enough to exercise
 * the runner's contract without standing up a VM. */
function makeEnv(stack: unknown[]): {
  stack: unknown[];
  executeOp(ins: Instruction): void;
} {
  return {
    stack,
    executeOp(ins: Instruction): void {
      switch (ins.op) {
        case "pushString":
        case "pushNumber":
        case "pushBool":
          stack.push(ins.value);
          return;
        case "pushNull":
          stack.push(null);
          return;
        case "add":
        case "subtract":
        case "multiply": {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(applyBinaryOp(ins.op, a, b));
          return;
        }
        default:
          throw new Error(`driver does not implement "${ins.op}"`);
      }
    },
  };
}

const ins = (op: Instruction["op"], value?: unknown): Instruction =>
  ({ op, ...(value !== undefined ? { value } : {}) }) as Instruction;

// ── The emitter's declared subset is the runner's gate ───────────────────

test("every op compileExpression emits is inside the runner's gate — the emitter and the gate agree", () => {
  // The gate is the emitter's own declared subset (imported, not a
  // hand-copy); this pin executes the agreement: a battery of expressions
  // covering the emitter's operator classes compiles, and every emitted op
  // passes the gate (a codegen op missing from EXPRESSION_OPS fails here —
  // ForeignOpError at run time).
  const battery = [
    "1 + 2",
    "5 - 3",
    "4 * 2",
    "6 / 2",
    "7 % 3", // arithmetic → add..modulo
    "-1", // unary minus folds to a literal (pushNumber)
    "$gold + 1", // pushVariable
    "1 == 1",
    "1 != 2",
    "1 < 2",
    "1 <= 1",
    "2 > 1",
    "2 >= 2", // comparisons
    "true && false",
    "true || false",
    "not false", // logical (xor: the VM supports the op but codegen has no xor source spelling — the recorded ADR 0005 gap)
    "true",
    '"text"', // literal pushes
  ];
  for (const expr of battery) {
    const code = compileExpression(expr);
    for (const ins of code) {
      assert.ok(
        EXPRESSION_OPS.has(ins.op),
        `codegen emitted "${ins.op}" for "${expr}" — outside the declared expression subset`,
      );
    }
  }
  // Literals are in the subset but are not stack producers (main-loop
  // rebalancing excludes them) — the derivation the VM performs.
  for (const literal of LITERAL_OPS) {
    assert.ok(EXPRESSION_OPS.has(literal));
  }
});

test("compiled slices run end to end: arithmetic leaves one value", () => {
  const code = compileExpression("1 + 2");
  const stack: unknown[] = ["saved-kept"];
  const value = runBytecode(code, makeEnv(stack));
  assert.equal(value, 3);
  assert.deepEqual(
    stack,
    ["saved-kept"],
    "the caller's stack is restored after a successful run",
  );
});

// ── Failure modes ────────────────────────────────────────────────────────

test("a foreign op throws ForeignOpError naming the op", () => {
  const stack: unknown[] = ["saved-kept"];
  assert.throws(
    () =>
      runBytecode(
        [ins("pushNumber", 1), ins("runLine" as Instruction["op"], "x")],
        makeEnv(stack),
      ),
    (e: unknown) =>
      e instanceof ForeignOpError && e.message.includes("runLine"),
  );
  assert.deepEqual(
    stack,
    ["saved-kept"],
    "the caller's stack is restored even on a foreign op",
  );
});

test("an unbalanced slice throws UnbalancedStackError and restores the stack", () => {
  const stack: unknown[] = ["saved-kept"];
  // Two values left over.
  assert.throws(
    () =>
      runBytecode([ins("pushNumber", 1), ins("pushNumber", 2)], makeEnv(stack)),
    (e: unknown) => e instanceof UnbalancedStackError,
  );
  // No value at all.
  assert.throws(
    () => runBytecode([], makeEnv(stack)),
    (e: unknown) => e instanceof UnbalancedStackError,
  );
  assert.deepEqual(stack, ["saved-kept"]);
});

test("a failing op propagates its error; the stack is restored in the finally", () => {
  const stack: unknown[] = ["saved-kept"];
  // 1 * "not-a-number" — the operand-semantics module throws on the
  // non-numeric operand (add would string-concat; multiply is purely numeric).
  assert.throws(
    () =>
      runBytecode(
        [
          ins("pushNumber", 1),
          ins("pushString", "not-a-number"),
          ins("multiply"),
        ],
        makeEnv(stack),
      ),
    /Cannot convert/,
  );
  assert.deepEqual(stack, ["saved-kept"]);
});
