# One finalize above compile()'s mode ladder

Type: task
Status: open

## Problem

`compile()`'s four mode exits in src/compile/compileSource.ts (empty
~236–239, stringsOnly ~283–286, typeCheckOnly ~298–301, full ~326–332) each
hand-copy `applySeverityOverrides(diagnostics, opts.diagnosticsSeverity)` →
strict-throw → shape. The "overrides apply on every exit, before the strict
decision" contract lives in a comment; the direct-import effort's ticket 03
shipped a real bug of exactly this class (the no-parse early return skipped
the override pass). Three of the four exits spread `emptyCompileResult` with
overlapping field subsets; the fourth repeats the same fields as a fresh
literal.

## Decision

One local `finalize(extra: Partial<CompileResult>): CompileResult` above the
mode ladder: applies overrides, throws in strict mode, returns
`{...empty, ...extra}`. Each exit becomes `return finalize({...})`. Pure
refactor — interface unchanged, no new tests (the public seam is already
pinned end-to-end).

## Constraints

- `emptyCompileResult` stays the shared empty shape (deepening-wave-3
  ticket 05); `yarnProject.ts` `failedResult` keeps spreading it.
- No behavior change: overrides and strict-throw ordering per exit are
  exactly as today.

## Tests

- Suite green unchanged; lint, ts-check green.

## Answer

(when resolved)