# 45: VM core

**What to build:** a stack VM executes the instruction-stream program end-to-end for linear flow — Line/Options/Command/NodeStart/NodeComplete events, linear execution, jumps — and a first tranche of testplan pairs runs green against it, behind the same public runtime API.

**Blocked by:** 44 (program format).

**Status:** resolved

- [x] First tranche of testplan pairs green on the VM
- [x] Tree-IR runtime still green for the remainder (both drivers coexist)
- [x] Full suite green

Landed in: a3eb68e

## Comments

**Resolution (ticket 45).** The stack VM executes the instruction-stream program end-to-end behind the public runtime API:

- `src/runtime/vm.ts` — the `VirtualMachine`: a per-node pc over the compiled instruction streams, an operand stack, and a detour/return call stack. `runLine`/`runCommand` deliver through the shared line parser; `addOption` pops the option's availability (upstream AddOption), `showOptions` delivers the FULL set with per-option `isAvailable` and awaits selection (selection resumes at the option's inline body; `noOptionSelected` falls through, the pc is already past `showOptions`); `runNode` mirrors the tree driver's jump semantics (NodeComplete + visit of the exited node, detoured nodes record theirs, return stack cleared); `stop`/`return` are dedicated ops. Stack-op semantics mirror the runtime evaluator (string-concat `add` with upstream rendering, `deepEqualsOperands` equality with unset-variable defaults, `Number()` relational coercion, boolean-coerced `and`/`or`), and node entry/group `when` selection, visits, `tracking:`, line hints, and the variable surface are exact mirrors. Collect-don't-throw: a failing instruction is a `logError` diagnostic, the operand stack is restored to its pre-instruction depth and re-balanced with a null.
- **`Dialogue` is now a facade** dispatching by program format (`isInstructionStreamProgram`) to the VM or to the tree-IR runtime (now the internal `TreeIrRuntime` driver behind the same surface, `RuntimeDriver` in `src/runtime/events.ts`). Shared machinery was extracted so both drivers run one implementation: `runtime/builtins.ts` (the StandardLibrary table), `runtime/interpolate.ts` (line/command composition), `executeStateStatement` in `runtime/commands.ts`, `deepEqualsOperands`/`toNumberOperand` in `runtime/evaluator.ts`, `lineIdFromTags` in `runtime/events.ts`. Smart variables now register as recompute thunks (the tree driver evaluates its stored string; the VM runs its bytecode).
- **Deliberate lowering change (recorded per §1):** option conditions no longer guard `addOption` with `jumpIfFalse` — the compiler emits the condition bytecode (or `pushBool true`) and `addOption` pops it as `isAvailable`, mirroring upstream's AddOption, so the delivered set carries unavailable options. The old guard shape could never reproduce the full-set delivery contract the conformance corpus pins. Golden bytecode tests updated to the new shape.
- **First tranche (19 pairs + Example.yarn) runs on the VM** through `runTestPlan` (now accepting either artifact): Commands, DecimalNumbers, Enums (×3), Expressions, Functions, IfStatements, Indentation, Inference (×2), InlineExpressions, Jumps, NodeGroupsWithImplicitDeclarations, ShadowLines, SmartVariables, Smileys, Types, VariableStorage. The remaining 13 pairs (detours, visits/once, saliency/line-groups, and the still-unbuilt runtime features) stay on the tree driver for ticket 46.
- `src/tests/vm-runtime.test.ts` — 12 public-seam tests over the bytecode driver: linear flow + batching, full-set option delivery, fall-through, uncompilable-condition fallback, per-instance generated-variable state, smart-variable recompute, setNode/stop, opt-in line hints, and a both-drivers stream-equivalence sweep (the VM and the tree driver must agree — the guard the coexistence window needs).

Code review follow-ups landed in the same change: `and`/`or` coerce to booleans (raw `a && b` would leak operand values into `<<set>>` and diverge from the evaluator), the failure path restores the operand stack depth exactly, `lineIdFromTags`/op-set duplication folded, group-member resolution gathered into `currentMember()`, and the internal driver interface named `RuntimeDriver` (§5: not "engine"); CONTEXT.md gains the Virtual machine entry.

Full suite: 251/251 green (12 new VM tests over the 239 baseline; the 19-pair tranche + Example.yarn additionally run on the VM inside the conformance suite).
