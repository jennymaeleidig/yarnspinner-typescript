# 22 — Generated-variable state + InitialValues seam + invariant formatting

Status: resolved (retroactive)
Landed in: 1f551e3
Retroactive: code-review follow-up to ticket 21, implemented without a ticket.

## Scope (as implemented)

Spec Implementation Decisions — state model slice:

- Once-state and visit counts moved into variable storage as generated variables
  under the reserved `Yarn.Internal.` namespace (spec story 50); module-global
  sets removed; observable variable snapshots exclude generated keys.
- `YarnProgram.initialValues` collected at compile time from `<<declare>>`s and
  seeded into storage at start-up (upstream `Dialogue.SetProgram` /
  `Program.InitialValues`); `set:` steps validated against it.
- `<<declare>>` handler strips the grammar's `as TYPE` postfix.
- Culture-independence loop ported as invariant-formatting check
  (`src/tests/invariant-formatting.test.ts`): culture-sensitive APIs patched to
  throw while numeric stories run (spec Testing Decisions).
- testplan NUMBER restricted to grammar-exact `[0-9]+`.
- full_featured second-run test fixed to same-runtime re-entry per story 50
  (new runner = fresh state).

## Acceptance

Full suite 135/135; lint clean at 1f551e3.
