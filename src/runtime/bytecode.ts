// SPDX-License-Identifier: CC0-1.0
/**
 * One bytecode-slice runner: executes a compiled expression slice against a
 * caller-supplied operand stack, owning the stack save/restore, the op
 * gating, and the balanced-stack contract stated once.
 *
 * This is the deepening of the two hand-copied loops that lived inside the
 * VM (`evaluateConditionExpression`, `evaluateInitializer` — the same
 * saved-stack dance with two different failure policies). The runner is
 * policy-free: it throws typed errors and each
 * call site keeps its own failure policy (the condition path falls back to
 * the string evaluator; the initializer path propagates with its name
 * context). The op gate is the emitter's own declared subset —
 * `EXPRESSION_OPS` beside `expressionCodegen.ts` — imported, not
 * re-declared, so a codegen change cannot silently lag the runtime's
 * classification.
 *
 * Module tier (like `operands.ts`): the VM stays the only package-surface
 * driver; tests drive this interface directly.
 */

import { EXPRESSION_OPS } from "../compile/expressionCodegen.js";
import type { Instruction } from "../compile/program.js";

/** Thrown when a slice contains an op outside the emitter's declared
 * expression subset (`EXPRESSION_OPS`). Either a compile/runtime contract
 * break, or — for the condition path — the cue to fall back to the string
 * evaluator (an expression that outlived its compiled form). */
export class ForeignOpError extends Error {
  constructor(readonly op: Instruction["op"]) {
    super(`Instruction "${op}" is not valid in an expression slice`);
    this.name = "ForeignOpError";
  }
}

/** Thrown when a slice leaves the operand stack unbalanced — not exactly
 * one value over the restored depth, or no value at all. Well-formed
 * codegen output leaves exactly one; this guards the contract. */
export class UnbalancedStackError extends Error {
  constructor() {
    super("Expression slice left the operand stack unbalanced");
    this.name = "UnbalancedStackError";
  }
}

/** What a slice runner needs from its driver: the operand stack (saved and
 * restored around the run) and the one-op executor. */
export interface BytecodeEnv {
  stack: unknown[];
  executeOp(ins: Instruction): void;
}

/**
 * Run a compiled expression slice and return the value it leaves. The
 * caller's stack contents are saved before and restored after — success,
 * `ForeignOpError`, `UnbalancedStackError`, or a propagating execution
 * error all leave the stack exactly as the runner found it.
 */
export function runBytecode(code: Instruction[], env: BytecodeEnv): unknown {
  const saved = env.stack.splice(0, env.stack.length);
  try {
    for (const ins of code) {
      if (!EXPRESSION_OPS.has(ins.op)) throw new ForeignOpError(ins.op);
      env.executeOp(ins);
    }
    const value = env.stack.pop();
    if (env.stack.length > 0 || value === undefined)
      throw new UnbalancedStackError();
    return value;
  } finally {
    env.stack.length = 0;
    env.stack.push(...saved);
  }
}
