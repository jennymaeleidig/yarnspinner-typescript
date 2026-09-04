# Ticket 01 — Fallback `<<set>>`: an undefined evaluation result silently clobbers storage

Type: task
Status: resolved

## Question

In the fallback executor's plain-set branch (`executeStateStatement` →
`setVariable(key, evaluator.evaluateExpression(expression))`), an
expression that resolves to nothing — e.g. the trailing-garbage
`<<set $m to 1 2>>` — writes `undefined` into storage unconditionally. A
prior value of `$m` is destroyed silently, and no diagnostic fires, even
though the branch's own header promises "a failing statement is a runtime
diagnostic" (collect-don't-throw, CODING_STANDARDS §3: problems are data).

## Evidence

- `src/runtime/commands.ts` plain-set branch: `const value = evaluator.evaluateExpression(expression); setVariable(key, value);` — no undefined check.
- `evaluateExpression` returns `undefined` for unresolvable text (resolveValue miss) — but *also* legitimately, for host functions with no return value (`<<set $x to someVoidFn()>>`). That collision is why the fix is not a one-liner.
- Upstream never executes these statements (trailing garbage is a compile error, YS0005); the raw-command fallback is our documented deviation, so the observable is ours to define — but it must be *surfaced*, not silent.

## Settled design (grilling round, 2026-09-04)

A **result wrapper** in `evaluator.ts` beside `evaluateExpression` — an
out-of-band failure signal, NOT a contract change on `evaluateExpression`
itself:

- The wrapper returns `{ ok: true, value }` on success, `{ ok: false }` on evaluation failure. Existing `evaluateExpression` callers are untouched.
- The fallback plain-set branch migrates to the wrapper: on `{ ok: false }`, `logError` a diagnostic and skip the write (collect-don't-throw); on `{ ok: true, value: undefined }` (a legitimate void host function), write as today. Void-function sets keep working.
- `<<call>>`'s catch→logError may opportunistically use the same wrapper (same ambiguity, same fix) — record the choice either way.
- Inline `{expr}` composition (`interpolate.ts:92`, `evaluateExpression` → `stringifyValue`) keeps today's soft failure — verified out of scope.

## Work item

1. Add the wrapper to `src/runtime/evaluator.ts` (module-tier; not package surface unless the evaluator's existing export pattern requires it — check `index.ts export *`).
2. Migrate the plain-set branch in `src/runtime/commands.ts`.
3. Re-write the trailing-garbage pin in `src/tests/vm-runtime.test.ts` to set `$m` first and expect the prior value to survive plus one diagnostic — the pin then discriminates (it currently passes equally under "set does nothing").

## Tests

- Pin: `<<set $m to 1>>` then `<<set $m to 1 2>>` → `$m` still 1, one diagnostic, composed text shows "1".
- Pin: `<<set $x to someVoidFn()>>` → `$x` is undefined, no diagnostic (void set unchanged).
- Pin: ordinary `<<set $n to 2>>` → 2, no diagnostic (success path unchanged).

## Answer

Landed as designed, with two scope extensions recorded:

- **The wrapper** is `ExpressionEvaluator.tryEvaluateExpression(expr) → { ok: true, value } | { ok: false }` (the `tryGetSmartVariable` shape, same file). Implementation: the evaluation dispatch moved to a private `evaluateOrThrow`; the value level's unresolvable-value miss (the old silent `return this.variables.get(key)` fall-through) now throws a module-internal `EvaluationFailure`. `evaluateExpression` softens `EvaluationFailure` → `undefined` — the historical contract, caller by caller unchanged (real evaluation errors still propagate). `tryEvaluateExpression` surfaces any failure out-of-band.
- **Consumers**: the fallback plain-set branch (the pinned one — diagnostic + skip write), the compound-assignment branch (previously surfaced only via `applyBinaryOp` throwing; now the same signal, same observable), and `<<call>>` (a garbage payload resolved to no value without throwing, so the old try/catch stayed silent — now diagnostic).
- **Declares never reach the runtime** (ticket 05's own record; verified: `collectInitialValues` degrades an uncompilable declare's initializer to `pushNull`). The declare branch's migration to the wrapper is defensive consistency only, and the planned declare pin **cannot exist through the public seam** — dropped, not faked.
- Inline `{expr}` composition untouched (verified: `interpolate.ts` catches and composes empty strings, soft path preserved).

Pins in `vm-runtime.test.ts`: trailing-garbage set now discriminates ($m survives + one diagnostic), void-function set writes undefined with no diagnostic, garbage `<<call>>` logs. Suite 606 pass / 1 mirrored skip, lint clean, ts-check clean, demo build green.

## Comments

**Two-axis review fix (2026-09-04)**: the spec axis flagged that `<<call>>`'s migrated branch degraded the diagnostic — the wrapper's blanket catch swallowed the cause, so an unknown function logged a generic message instead of the historical `Function not found: x`. Fix: the failure shape now carries the error (`{ ok: false, error: unknown }` — mirroring upstream `TryGet` shapes that report cause) and the `<<call>>` branch logs `<<call>> failed: <cause>` for both failure kinds. The state-statement branches keep the helper's statement-naming message. Standards axis also had the executor's three hand-copied failure blocks extracted into `evaluateStatementValue` (one failure-policy statement) and an orphaned duplicated docstring in `evaluator.ts` removed.
