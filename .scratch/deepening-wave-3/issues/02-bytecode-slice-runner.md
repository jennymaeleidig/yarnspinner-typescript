# Ticket 02 — One bytecode-slice runner inside the VM; op classes move beside their emitter

Type: task
Status: open

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
