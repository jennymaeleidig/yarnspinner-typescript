# Ticket 06 — Drive `typeCheck()` directly: the checker gets its own test surface

Type: task
Status: resolved

## Question

`typeCheck()` is exported from `index.ts` yet no test drives it directly —
the checker's semantics (YS0029 smart-variable solver, type inference, YS0045
self/cyclic references, enum shorthand resolution) are pinned only through
`compile()`. The interface already exists; the seam has no traffic from
tests. No module change required — this is the review's free win.

## Work item

A new `src/tests/typeCheck.test.ts` driving `typeCheck()` directly through
its public seam, porting the checker-specific pins that today only ride the
compile end-to-end: the YS0029 solver, inference, YS0045 loops, enum
shorthand (`.Case` rewrite + YS0028 ambiguity), YS0050 cross-enum
restrictions. Pins through the public seam only (CODING_STANDARDS §6) —
no checker-internals poking.

## Tests

This ticket is tests. Suite grows; no source change.

## Answer

Landed: `src/tests/typeCheck.test.ts` — 11 pins driving `typeCheck()` through the package-root export (parseYarn → typeCheck → collected diagnostics + result + the mutated-in-place document): the YS0029 solver (inline use undetermined; the global-solver resolution of an earlier inline use by a later declaration), YS0003 set targets and their suppression by external declarations, YS0045 loops (per-member diagnostics, declarations still smart), the `.Case` in-place rewrite pinned through the exported AST model (statement text carries `Season.Spring`) plus the declaration's raw-value default, YS0028 ambiguity reported once, YS0050 same-type violation (`not A and B`), YS0040 redeclaration, host enums through `declarations.enums`, and YS0014 arity through host signatures.

Two facts the direct-drive surface exposed (recorded, no source change made): `TypeCheckResult` carries **no** `userDefinedTypes` — that field is assembled by `compileSource`, so the host-enum pin observes the checking verdict through the declaration's type + raw-value default instead; and the external-variables map is keyed **`$`-less** (`gold`), a `$`-prefixed key silently declaring a variable literally named `$gold` — the multiFileCompile fixtures had it right, the type-level contract just wasn't visible from the end-to-end seam. Suite 626 (625 pass, 1 mirrored skip), lint clean, ts-check clean.
