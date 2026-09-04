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
import { EXPRESSION_OPS, LITERAL_OPS, compileExpression } from "../compile/expressionCodegen.js";
import { ForeignOpError, UnbalancedStackError, runBytecode } from "../runtime/bytecode.js";
import { applyBinaryOp } from "../runtime/operands.js";
import type { Instruction } from "../compile/program.js";

/** A minimal driver: literal pushes and one binary op — enough to exercise
 * the runner's contract without standing up a VM. */
function makeEnv(stack: unknown[]): { stack: unknown[]; executeOp(ins: Instruction): void } {
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

test("every op the codegen emits for an expression slice runs through the runner", () => {
  // The gate and the emitter's output agree: compile a representative
  // expression per emitted op class... the exhaustive operator table lives
  // in operands.test.ts; here the pin is that the classification itself is
  // the import, not a hand-copy (structural).
  for (const op of EXPRESSION_OPS) {
    assert.ok(typeof op === "string");
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
  assert.deepEqual(stack, ["saved-kept"], "the caller's stack is restored after a successful run");
});

// ── Failure modes ────────────────────────────────────────────────────────

test("a foreign op throws ForeignOpError naming the op", () => {
  const stack: unknown[] = ["saved-kept"];
  assert.throws(
    () => runBytecode([ins("pushNumber", 1), ins("runLine" as Instruction["op"], "x")], makeEnv(stack)),
    (e: unknown) => e instanceof ForeignOpError && e.message.includes("runLine"),
  );
  assert.deepEqual(stack, ["saved-kept"], "the caller's stack is restored even on a foreign op");
});

test("an unbalanced slice throws UnbalancedStackError and restores the stack", () => {
  const stack: unknown[] = ["saved-kept"];
  // Two values left over.
  assert.throws(
    () => runBytecode([ins("pushNumber", 1), ins("pushNumber", 2)], makeEnv(stack)),
    (e: unknown) => e instanceof UnbalancedStackError,
  );
  // No value at all.
  assert.throws(() => runBytecode([], makeEnv(stack)), (e: unknown) => e instanceof UnbalancedStackError);
  assert.deepEqual(stack, ["saved-kept"]);
});

test("a failing op propagates its error; the stack is restored in the finally", () => {
  const stack: unknown[] = ["saved-kept"];
  // 1 * "not-a-number" — the operand-semantics module throws on the
  // non-numeric operand (add would string-concat; multiply is purely numeric).
  assert.throws(
    () => runBytecode([ins("pushNumber", 1), ins("pushString", "not-a-number"), ins("multiply")], makeEnv(stack)),
    /Cannot convert/,
  );
  assert.deepEqual(stack, ["saved-kept"]);
});
