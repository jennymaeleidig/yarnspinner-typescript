# Delete RuntimeDriver — Dialogue holds the Virtual machine directly

Type: task
Status: resolved

## Problem

`RuntimeDriver` (src/runtime/events.ts:145–178) is a 22-member interface with
exactly one implementation (`VirtualMachine`) and one consumer (`Dialogue`,
23 `this.engine` references, 16 one-line pass-through stubs). No test binds
the type; it is not package surface (src/index.ts never re-exports
`runtime/events.js`). One adapter is a hypothetical seam.

## Decision

Delete the interface; `Dialogue.engine` is typed `VirtualMachine`. If a
second execution driver ever becomes real, the interface is re-cut then,
against two known implementations.

Folded (review candidate 6): the Virtual machine owns `textProvider` /
`logError` defaults and gains `setLanguage` (the null-provider guard moves
with it); `Dialogue` drops its private `textProvider`/`logError` copies and
forwards `setLanguage` through the engine. Field ownership of
`DialogueOptions` becomes one decision.

## Constraints

- Public surface unchanged: `Dialogue` keeps every member, ADR 0002 holds.
- `src/index.ts` does not export `runtime/events.js`, so no consumer-facing
  surface moves; the deprecated `YarnRunner` alias rides `Dialogue` as before.

## Tests

- No new tests: the public surface is already pinned end-to-end; the deleted
  interface had zero test bindings.
- Suite, lint, ts-check stay green.

## Answer

Landed. `RuntimeDriver` deleted from src/runtime/events.ts (with its now-unused
`LineParser`/`ContentSaliencyOption` imports); `Dialogue.engine` typed
`VirtualMachine`; the Dialogue-side `textProvider`/`logError` copies deleted and
`setLanguage` forwarded to the engine, whose new `setLanguage` owns the
null-provider guard and the message verbatim (vm.ts, Localisation section);
vm.ts's section comment no longer cites the driver. No second driver exists,
so no seam was re-cut — the glossary's "consumers never drive the machine
directly" is enforced by Dialogue being the only exported facade.

Suite 632 pass / 0 fail / 1 skip, lint and ts-check clean.