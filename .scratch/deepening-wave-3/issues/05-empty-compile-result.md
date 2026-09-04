# Ticket 05 — One empty `CompileResult` across the loader seam

Type: task
Status: open

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
