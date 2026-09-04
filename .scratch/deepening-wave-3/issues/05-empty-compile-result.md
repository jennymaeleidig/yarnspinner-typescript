# Ticket 05 — One empty `CompileResult` across the loader seam

Type: task
Status: resolved

## Question

Two hand-written empty-`CompileResult` literals in two modules that share the
type: `src/compile/compileSource.ts` ~203 (`const empty` — 7 fields) and
`src/compile/yarnProject.ts` ~82 (`failedResult()` — the same 7 fields plus
`project`/`sources`). `CompileResult` gains a field → two edits, and the
second module already documents its literal as "one literal, so the error
paths cannot drift apart (code-review finding)" — the same treatment applied
at seam level.

## Work item

One `emptyCompileResult()` in `compileSource.ts`; `failedResult` spreads it.
No behavior change.

## Tests

Compile-time drift protection only — no new pins; suite stays green.

## Answer

Landed: `emptyCompileResult(diagnostics)` in `compileSource.ts` (exported at module tier beside the type it builds; carries the given diagnostics, since the compile seam's no-program paths return collected diagnostics, not an empty list); `yarnProject.failedResult` spreads it and adds `project`/`sources`. A new `CompileResult` field is now a one-place edit. Suite 615 (614 pass, 1 mirrored skip), lint clean, ts-check clean.
