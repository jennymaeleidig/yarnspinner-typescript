# Ticket 04 — One operand-semantics module

Type: task
Status: resolved
Blocked by: 03

## Question

The operator contract (string-`add` rendering, `toNumberOperand` coercion,
`deepEqualsOperands` for equality, `Number()` for relationals, bool-xor per
`MethodXor`) is implemented twice — once over the bytecode stack (VM) and once
over parsed string fragments (evaluator) — with a third copy of the compound
ops in commands.ts. The lockstep is coordinated by prose and has already
snapped once (ticket 03's xor divergence).

## Evidence

- `src/runtime/vm.ts` (1277) — `executeStackOp` (:509–660); lockstep prose at :48
  ("the drivers' event streams must stay identical for non-bool operands too")
- `src/runtime/evaluator.ts` (546) — `evaluateArithmetic`, `evaluateComparison`,
  `evaluateLogical`; plus a private `toNumber` (:222–231) that is a line-for-line
  duplicate of the module's own exported `toNumberOperand` (:25–36)
- `src/runtime/commands.ts` — compound-assignment application, a third copy of
  the "+= on strings" rule

## Work item

One operand-semantics module: `applyBinaryOp(op, a, b)` / `applyUnaryOp(op, a)`
over the existing exported primitives (`stringifyOperand`, `toNumberOperand`,
`deepEqualsOperands` — which already function as the shared seam, used by both
sides). `executeStackOp` becomes dispatch + `applyBinaryOp`; the evaluator's
arithmetic/comparison/logical loops call the same functions; commands.ts's
compound-assignment application joins.

Delete the private `toNumber`, the duplicated add/equality/relational bodies,
and the duplicated compound-op application.

## Tests

- One operator-semantics table test: every op × operand-type pair, once — the
  same pins now protect both drivers.
- The ticket-03 fallback xor regression test keeps passing through the shared
  module.
- Bytecode golden tests and the conformance corpus unchanged — the op set and
  bytecode do not move.

## Constraints

- **ADR 0001 holds**: no change to the instruction-stream VM or its ops — only
  where their semantics live; the golden corpus still pins the bytecode.
- No ADR tension otherwise.
- Per the grilling round: propose the CONTEXT.md glossary wording at resolution
  (operand-semantics module under Runtime, if the name earns a term).
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.

## Answer

`src/runtime/operands.ts` is the one operand-semantics module:
`applyBinaryOp(op, a, b)` / `applyUnaryOp(op, a)` over the moved
primitives (`stringifyOperand`, `toNumberOperand`, `deepEqualsOperands`,
with `defaultValueFor` private). The rules' single statements live on the
module (add-concat with upstream rendering, numeric coercion, deep
equality, plain-`Number()` relationals, bool and/or/xor per
`BooleanType.MethodXor`).

- **VM**: `executeStackOp`'s fourteen binary cases collapsed to one
  dispatch (`applyBinaryOp(ins.op, a, b)`), `negate`/`not` to
  `applyUnaryOp`; the push/pop/callFunction cases stay. The lockstep prose
  comment (vm.ts:48) is deleted — the coordination is structural now; the
  header docstring points at the module.
- **String evaluator**: `evaluateArithmetic`'s parsers apply
  `applyBinaryOp`/`applyUnaryOp`; the private `toNumber` (a line-for-line
  duplicate of the module's own export) is deleted;
  `evaluateComparison`'s switch applies the equalTo/relational ops;
  `evaluateLogical` applies and/or/xor. The unused private `deepEquals`
  wrapper is deleted (deletion test).
- **commands.ts**: the third copy of the compound-assignment application
  is replaced by `applyBinaryOp` over the mapped base op. One deliberate
  alignment recorded: the old copy coerced through `Number(current ?? 0)`,
  silently producing NaN for non-numeric strings; `toNumberOperand`
  throws, which the statement executor surfaces as a runtime diagnostic —
  the documented upstream contract ("a non-numeric result is an error,
  which callers surface as a runtime diagnostic"). No test pinned the
  NaN path; the contract now matches the rest of the arithmetic.
- **Public surface**: evaluator.ts re-exports the three primitives, so
  index.ts's `export *` and the historical import path are unchanged;
  internal importers (builtins, commands, vm) point at the home module.

New `src/tests/operands.test.ts`: the operator × operand-type table
(add-concat incl. bool rendering, coercion incl. the throw,
equality-with-defaults, relationals incl. NaN-false, and/or/xor incl.
`1 xor 0 → true`, unary) — one statement protecting both drivers. The
ticket-03 xor fallback pins now flow through `applyBinaryOp`. Suite 581
(580 pass, 1 mirrored skip), lint clean, ts-check clean.

**Glossary proposal (per the grilling round):** none — the module is
implementation (its rules were already observable only through the
event-stream contract); CONTEXT.md's implementation-details rule applies.
