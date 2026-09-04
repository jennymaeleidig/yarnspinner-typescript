# Ticket 06 — Drive `typeCheck()` directly: the checker gets its own test surface

Type: task
Status: open

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
