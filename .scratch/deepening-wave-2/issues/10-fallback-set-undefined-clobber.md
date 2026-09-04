# Ticket 10 — Fallback `<<set>>`: an undefined evaluation result silently clobbers storage

Type: task
Status: open

## Question

In the fallback executor's plain-set branch (`executeStateStatement` →
`setVariable(key, evaluator.evaluateExpression(expression))`), an
expression that resolves to nothing — e.g. the trailing-garbage
`<<set $m to 1 2>>` — writes `undefined` into storage unconditionally. A
prior value of `$m` is destroyed silently, and no diagnostic fires, even
though the branch's own header promises "a failing statement is a runtime
diagnostic" (collect-don't-throw, CODING_STANDARDS §3: problems are
data). Found by the final reviewer pass over the wave-end review fixes:
the "best-effort" pin passed equally under "set does nothing" — it pins
neither outcome.

## Evidence

- `src/runtime/commands.ts` plain-set branch: `const value =
  evaluator.evaluateExpression(expression); setVariable(key, value);` —
  no undefined check.
- `evaluateExpression` returns `undefined` for unresolvable text
  (resolveValue miss) — but *also* legitimately, for host functions with
  no return value (`<<set $x to someVoidFn()>>`). That collision is the
  reason the fix is not a one-liner: the set branch cannot distinguish
  "evaluation failed" from "evaluated, deliberately void".
- Upstream never executes these statements (trailing garbage is a compile
  error, YS0005); the raw-command fallback is our documented deviation,
  so the observable is ours to define — but it must be *surfaced*, not
  silent.

## Work item

Give the string evaluator a way to say "no value" distinctly from
"undefined value" — the smallest honest seam is an out-of-band failure
signal on `evaluateExpression` (a thrown sentinel the set branch catches,
or a wrapper returning `{ ok, value }` internally) — then the fallback
set branch: on evaluation failure, `logError` a diagnostic and skip the
write (collect-don't-throw); on a legitimate undefined (void function),
write as today. Void-function sets keep working. Update the
trailing-garbage pin in vm-runtime.test.ts to set `$m` first and expect
the prior value to survive plus a diagnostic — the pin then discriminates
(the reviewer's point: it currently passes under "set does nothing" too).

## Tests

- Pin: `<<set $m to 1>>` then `<<set $m to 1 2>>` → `$m` still 1, one
  diagnostic, composed text shows "1".
- Pin: a void host function in a set → `undefined` stored (unchanged
  contract).
- Existing suites unchanged otherwise (stash-prove the clobber pin
  pre-fix).

## Constraints

- No change to the compile grammars (ADR 0005 stands).
- The evaluator's public `evaluateExpression` signature may stay
  `unknown`-returning; the failure channel is internal to the fallback
  path unless a second consumer needs it.
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.