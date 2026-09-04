# Ticket 02 — One bytecode-slice runner inside the VM; op classes move beside their emitter

Type: task
Status: resolved

## Question

`src/runtime/vm.ts` hides a second bytecode interpreter: two private methods
(`evaluateConditionExpression` ~869–910, `evaluateInitializer` ~1133–1160)
hand-copy the same saved-stack bytecode loop with two different failure
policies, and the op sets they gate on (`LITERAL_OPS`, `INITIALIZER_OPS`,
`STACK_PRODUCERS`, ~99–136) re-declare a compile-side invariant — "exactly
the expression subset the front end emits" — inside the runtime, where it can
silently lag `expressionCodegen.ts`.

## Settled design (grilling round, 2026-09-04)

- **`runBytecode(code, env) → unknown`** in `src/runtime/` (next to `operands.ts`, the tier wave-2 ticket 04 created): owns the stack save/restore, the op gating, and the balanced-stack contract behind one small interface. Throws a **typed, distinguishable error on a foreign op** (and propagates execution errors) — no options knob; the string evaluator stays out of the runner's interface.
- **Both failure policies stay at their call sites** (where the fallback's evaluator/logging context lives): the condition path catches the typed error → string-evaluator fallback; the initializer path lets it propagate.
- **Op classes move beside `expressionCodegen.ts`**: the emitter declares what it may emit; `vm.ts` imports (it already imports `compileExpression` — no new dependency direction). `STACK_PRODUCERS` moves with them (same "what an expression slice does to the stack" knowledge).
- **Export tier**: module-tier export with its own test file (the walk.ts/stateStatement.ts/operands.ts precedent), NOT in index's `export *` — the VM stays the only package-surface driver.

## Work item

1. Move the three op sets to `src/compile/expressionCodegen.ts` (or a sibling), exported; rewire `vm.ts`.
2. Add `runBytecode` in `src/runtime/`; collapse `evaluateConditionExpression` and `evaluateInitializer` to one call each over it.
3. Bytecode and semantics identical — ADR 0001 untouched; goldens and conformance corpus must stay green with zero behavioral pins changed.

## Tests

- New `runBytecode` test table (module-tier): every initializer-subset op executes; a foreign op throws the typed error; unbalanced stack throws; errors propagate with the saved stack restored.
- Existing pins unchanged: condition fallback (uncompilable `when:` → string evaluator → false), initializer failure surfacing, stack balance on caught main-loop failures.

## Answer

Landed as designed, with two refinements recorded:

- **Module**: `src/runtime/bytecode.ts` — `runBytecode(code, env) → unknown` over `BytecodeEnv = { stack, executeOp }`; typed errors `ForeignOpError` (names the op) and `UnbalancedStackError`; the caller's stack is restored on every exit path (finally). No options knob — the string evaluator stays out of the runner's interface.
- **Op classes**: `LITERAL_OPS` and the subset moved beside the emitter and renamed `EXPRESSION_OPS` (the old `INITIALIZER_OPS` name was condition-slice-wrong anyway); `vm.ts` imports both. **Refinement on STACK_PRODUCERS**: it stays derived *in* `vm.ts`, not beside the emitter — its `selectSaliencyCandidate` member is a main-loop op the emitter never emits, so the set is main-loop rebalancing policy ("which ops get the null rebalance"), derived from the imported expression subset plus that one op. The grilled recommendation moved it wholesale; reading the code showed its home is the driver.
- **Call sites**: `evaluateConditionExpression` catches `ForeignOpError` → string-evaluator fallback (exactly the old behavior, stack restore now owned by the runner); other failures → `logError` + false. `evaluateInitializer` catches the typed errors and rethrows with the initializer's name context (the exact historical messages — no pins, but the constructor/reporting contract is preserved) and lets them propagate.
- **Two pathological-path tightenings, recorded**: the condition slice now also runs the balanced-stack guard (old code popped blindly). Both paths' code comes from `compileExpression`, which always leaves exactly one value, so the guard is unreachable today; if it ever fired, the condition path logs a diagnostic instead of silently `Boolean`-popping — an improvement on an unreachable path, not a behavior change on a reachable one.

New `runBytecode.test.ts` (6 pins: emitter-gate structural pin, end-to-end arithmetic with stack restore, foreign op naming + restore, unbalanced/empty + restore, propagating failure + restore). Suite 612 (611 pass, 1 mirrored skip), lint clean, ts-check clean, demo build green.

## Comments

**Two-axis review fix (2026-09-04)**: both axes flagged that the "emitter-gate structural pin" could never fail (it iterated the set asserting `typeof op === "string"`), which also diluted the spec's "every initializer-subset op executes" item. Replaced with a real gate-agreement pin: a battery of expressions covering the codegen's operator classes (arithmetic, unary-fold, pushVariable, comparisons, logical, literals) compiles and every emitted op must pass `EXPRESSION_OPS` — a codegen op outside the declared subset now fails at the pin instead of at runtime as `ForeignOpError`. (xor has no codegen source spelling — the recorded ADR 0005 gap — so the gate includes it for the VM's op support but the battery cannot exercise it from source.)
