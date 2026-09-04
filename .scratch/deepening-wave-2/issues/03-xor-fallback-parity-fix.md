# Ticket 03 — Standalone xor fallback-path parity fix

Type: task
Status: open

## Question

Xor is broken in the string-evaluator fallback path — a live parity divergence,
verified against the built dist on 2026-09-03:

```
true xor false = false   (should be true)
1 xor 0       = false    (should be true)
```

Commit 850d579 added xor "end to end" — but "end to end" meant VM + codegen +
typeCheck. The fourth consumer (the string evaluator, which serves the
compile-fallback paths for `when:` conditions and uncompilable `<<set>>`) was
missed precisely because operator semantics live in N places, not one.

## Evidence

- `src/runtime/evaluator.ts` — `preprocess` maps `xor` → `^` (:113), but
  `evaluateLogical` splits only on `&&`/`||` and never handles `^`; `^` matches
  none of the comparison/arithmetic dispatchers, so it falls through to
  `resolveValue` and returns false-ish.
- The correct semantics already exist in `src/runtime/vm.ts` `executeStackOp`
  (bool-xor per `BooleanType.MethodXor`, mirroring upstream's flat
  `ExpAndOrXor` precedence fix from 850d579).

## Work item

Standalone commit (grilling Q3: a parity correction and the operand-semantics
refactor do not share a commit): teach `evaluateLogical` (or the evaluator's
dispatch) the xor rule, mirroring the VM's `MethodXor` semantics exactly.

## Tests

- A fallback-path xor regression test: `when:` conditions and uncompilable
  `<<set>>` expressions exercising `true xor false → true`, `1 xor 0 → true`,
  `true xor true → false` — the path no existing test evaluates.
- Suite green (568/568 + new pins), lint clean, ts-check clean.

## Constraints

- No ADR tension (restores the recorded 850d579 semantics in the fourth
  consumer).
- Ticket 04 (blocked by this one) then deletes the duplication that caused the
  miss.
