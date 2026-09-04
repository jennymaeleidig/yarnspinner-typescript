# Ticket 04 — One operand-semantics module

Type: task
Status: open
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
