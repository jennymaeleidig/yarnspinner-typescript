# Ticket 01 — Events-shaped drain in the Transcript module

Type: task
Status: resolved

## Question

The runtime tests want raw events with options auto-selected; the Transcript
module's interface returns `Transcript` + `StoppingPoint`, so 12+ test files
each paste a private `drain` loop with a private guard cap and a private
option-selection policy — each an in-test re-derivation of "pull until
quiescent, select when options arrive", the exact contract `runUntilComplete`
was built to delete.

## Evidence

- The transcript module itself is deep and stays: `src/runtime/transcript.ts`
  (208 lines), pinned by `transcript.test.ts`.
- Pasted drain helpers, each with its own guard cap (no two agree):
  - `src/tests/dialogue.test.ts:30`, `src/tests/vm-runtime.test.ts:28` (guard 100)
  - `src/tests/once.test.ts:13` (guard 25), `src/tests/custom_functions.test.ts:19` (guard 30)
  - `src/tests/variables_flow_cmds.test.ts:20`, `src/tests/enums.test.ts:24` (guard 1000)
  - `src/tests/saliency.test.ts:65`, `src/tests/variableStorage.test.ts:55` (guard 1000)
  - `src/tests/smartVariables.test.ts:175` (guard 10_000)
  - `src/tests/invariant-formatting.test.ts:53`, `src/tests/diagnostics.test.ts:308` (guard 100)
  - `src/tests/upstream/testBase.ts:149`, `src/tests/upstreamUnitPorts.test.ts:155` — guard-loops of their own
- Variance is load-bearing: an infinite empty-pull bug trips at guard 25 in one
  suite and 10 000 in another.

## Work item

Add one function to the transcript module —
`runUntilCompleteEvents(dialogue, { selectOption? }): DialogueEvent[]`
(name proposed here; confirm at resolution) — implemented over
`runUntilStopped`, returning the merged event stream, with one guard policy
stated once and one option-selection policy. Migrate all 12+ drain sites to it.

The transcript module keeps its pure accumulator interface; this is the
events-shaped convenience its tests demand, inside the deep module rather than
beside it.

## Tests

- A dedicated pin for the new function: guard behaviour (the cap fires, named),
  option auto-selection (resolved set leaves the transcript per the at-rest
  contract), complete terminates.
- All migrated suites keep passing unchanged — the migration is mechanical and
  must not change any pinned expectation.

## Constraints

- No ADR tension (builds on the landed Transcript module).
- Per the grilling round: propose the one-line CONTEXT.md glossary edit at
  resolution (the function extends the **stopping point** contract's surface).
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.

## Answer

Landed as `runUntilCompleteEvents(dialogue, selectOption?)` in
`src/runtime/transcript.ts`, implemented over the pull API beside the reducers (the raw event stream is not the transcript shape, so it is not
built on `runUntilStopped` — the module owns both contracts). One stated
guard policy: 1 000 pulls (`MAX_DRAIN_PULLS`), past which the drain
**throws** instead of silently returning a partial stream — the pasted
drains' silent caps were the load-bearing variance, so the shared policy
surfaces a stall loudly. Terminal: complete delivered; or an option set
with no policy (the dialogue stays pending, the set is the stream's last
options event — a pull-API consumer's shape); or an empty batch (belt —
unreachable per the VM's batch contract). With a policy, a delivered set
is answered inline and the drain crosses it.

Migrated 12 pasted drain sites: `dialogue`, `custom_functions`, `once`
(alias to the function), `saliency`, `variableStorage`, `vm-runtime`
(count-adapter over the policy), `enums.drainLines`,
`variables_flow_cmds.drainTexts`, `smartVariables.nextLine`,
`invariant-formatting.runStory`, `diagnostics.test.ts`'s in-loop option
assertions (now post-drain over the found options event), and
`upstreamUnitPorts.test.ts`'s completion assertion (now post-drain).
`upstream/testBase.ts` deliberately stays: its loop is the step-locked
conformance harness (one event per plan step, lifecycle drained), an
upstream-mirrored contract this function does not replace.

Four pins added in `transcript.test.ts`: pending-stop without a policy,
policy crossing to complete, `noOptionSelected` fall-through to complete,
and the cap-throw (stall surfaced, not pinned). Suite 572 (571 pass,
1 mirrored skip), lint clean, ts-check clean.

**Glossary proposal (per the grilling round):** extend the existing
**stopping point** entry's orchestration family by one clause —
`runUntilCompleteEvents` returns the raw event stream to the terminal
stopping point — rather than adding a new term. Applied in the same
change; the function itself is implementation detail and earns no new
term.
