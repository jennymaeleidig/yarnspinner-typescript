# Ticket 03 — Standalone xor fallback-path parity fix

Type: task
Status: resolved

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

## Answer

Fixed in `src/runtime/evaluator.ts`: `evaluateExpression`'s dispatch now
routes `^` (and the preprocessed `xor` word) to `evaluateLogical`, whose
split now includes `^` as a third operator, applied as
`Boolean(result) !== Boolean(val)` — the same bool-xor the VM's xor op
applies (upstream `BooleanType.MethodXor`, mirroring vm.ts's
case "xor" comment). The and/or/xor evaluation stays one flat
left-associative loop, matching upstream's `ExpAndOrXor` level.

**Reachability finding (input to ticket 08's grammar diff):** the
fallback is not a dead path for xor — codegen's `WORD_OPS`
(expressionCodegen.ts:41) has no `xor` word alias, while the type
checker's table (typeCheck.ts:185) has it. So content authored with
`xor` (e.g. `when: $a xor $b`) type-checks, fails codegen, and rides the
string evaluator as its primary delivery path — the bug was live for
word-xor content, not merely hypothetical. The evaluator fix restores
correctness end-to-end; codegen's missing alias costs only the
consistency/performance gap, which ticket 08's three-grammar diff owns
(along with the checker/codegen alias tables generally).

Two regression pins in `vm-runtime.test.ts`, both through the public
compile → run seam and both verified to fail against the pre-fix
evaluator (stash-proven): the uncompilable `<<set>>` fallback
(`$x = $a xor $b` → True) and the `when:` saliency fallback (a node
group whose only eligible member is selected by `$a xor $b`, with the
`$a xor $a` member never eligible). Suite 574 (573 pass, 1 mirrored
skip), lint clean, ts-check clean.

**Glossary proposal (per the grilling round):** none — parity
restoration, no new concept.
