# Ticket 04 — The transcript family's missing member: the stateless pull

Type: task
Status: open

## Question

`runUntilStopped`'s at-rest contract ("the pending set is already on `prior`",
`src/runtime/transcript.ts` ~104–122) doesn't hold for `useDialogue`'s
stateless pull (`src/react/useDialogue.tsx` `applyPull` ~232–265): the hook
pulls with `EMPTY_TRANSCRIPT` and must stop *before* the module, hand-copying
one of its guards — otherwise `reshapeView` would reshape the empty
transcript to `null` and blank the live option set. When a consumer must
pre-empt a module's own guard, the interface is missing a mode the concept
clearly has.

## Settled design (grilling round, 2026-09-04)

- **`pullUntilStopped(dialogue) → { events: DialogueEvent[], stopped: StoppingPoint }`** in `src/runtime/transcript.ts`: it always owns the guards; a pending selection returns `{ events: [], stopped: "options" }`, a complete dialogue `{ events: [], stopped: "complete" }`. The hook reshapes when there are events and fires completion on `stopped` — "nothing new happened" as data, not a pre-flight check.
- The accumulators (`runUntilStopped`, `runUntilComplete`, `runUntilCompleteEvents`) rebuild **over** `pullUntilStopped` in the same ticket — that is what makes this a real seam (two consumers), not a hypothetical one.
- `applyPull` deletes its hand-copied guard.
- **Public** package surface (the family's other members are; scripts and other-framework hosts are the stated leverage case). CONTEXT.md's stopping-point entry gains one clause.

## Work item

1. Add `pullUntilStopped` to `src/runtime/transcript.ts` (extract the pull loop; guards at the top).
2. Rebuild the three accumulators over it; export from index alongside the family.
3. Migrate `applyPull` in `src/react/useDialogue.tsx`; delete the guard and the module-docstring concession.
4. Update CONTEXT.md's stopping-point entry.

## Tests

- New stateless-pull pins in `transcript.test.ts` without React: pending-selection → `{events: [], stopped: "options"}`; complete-once → `{events: [], stopped: "complete"}`; a normal pull returns the batch's events with its stopping point.
- Accumulator pins unchanged (the family's behavior is identical by construction).
- Hook tests: the React pins stop covering contract logic the module owns.
