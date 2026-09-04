# Ticket 04 — The transcript family's missing member: the stateless pull

Type: task
Status: resolved

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

## Answer

Landed as designed, with one interface refinement recorded: the transcript family's interface grows by **two** members, not one — `pullUntilStopped(dialogue) → { events, stopped }` plus `mergeEvents(events, prior?)`, the reduction half. The hook's reshape needs a `Transcript`, and without the exported merge it would have to keep pulling through the accumulating interface (reproducing the contract problem) or re-derive the reduction. `mergeEvents` is the old private `mergeBatch` promoted, with `runUntilStopped` its first consumer and the hook its second — a real seam, not a hypothetical one.

- **`pullUntilStopped`**: guards first (pending selection / complete → `{ events: [], stopped }`, no pull); the pull loop accumulates lifecycle-only batches into `events` (a scene header can ride its own batch) and returns at the first stopping point.
- **Accumulators rebuilt over it**: `runUntilStopped` = one `pullUntilStopped` + one `mergeEvents` (the at-rest path returns `prior` unchanged — the empty-events shape, so a pending pull never clears a resolved set off `prior`); `runUntilCompleteEvents` = the drain loop over the primitive, same cap policy, same terminal/pending-policy semantics. `runUntilComplete` unchanged (built over `runUntilStopped`). Both new members are package surface via the root's `export *` — no index.ts edit needed (the file was concurrently held by another agent's work; the seam made the question moot).
- **Hook migration**: `applyPull` calls `pullUntilStopped` + `mergeEvents`; the hand-copied pending-selection guard and the module-docstring concession are deleted — "nothing new" is now read off `events.length`, the contract consumed instead of pre-empted.
- CONTEXT.md's stopping-point entry extended with the stateless member + `mergeEvents`.

New pins in `transcript.test.ts`: one pull's events (lifecycle riding in delivery order), both at-rest states as data, lifecycle-only-batch accumulation, and the `mergeEvents` reduction. Suite 630 (629 pass, 1 mirrored skip), lint clean, ts-check clean, demo build green.

## Tests

- New stateless-pull pins in `transcript.test.ts` without React: pending-selection → `{events: [], stopped: "options"}`; complete-once → `{events: [], stopped: "complete"}`; a normal pull returns the batch's events with its stopping point.
- Accumulator pins unchanged (the family's behavior is identical by construction).
- Hook tests: the React pins stop covering contract logic the module owns.

## Comments

**Two-axis review note (2026-09-04)**: the spec axis flagged the "Hook tests" work item as unactioned. That item was an expectation about the *existing* React pins, not new work: after the migration the React suite passes unchanged and no longer covers any stopping-point contract logic — the stateless-pull contract is pinned in `transcript.test.ts` (module tier, no React), which is the item's intent delivered. Also fixed from the standards axis: `runUntilCompleteEvents`'s total-`find` guard was a silent `break` on a broken invariant; it now throws (a stalled runtime is a bug to surface, matching the module's stated cap policy).
