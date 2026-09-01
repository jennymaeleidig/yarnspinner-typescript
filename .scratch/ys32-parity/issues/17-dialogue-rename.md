# 17 — Rename exported runtime `YarnRunner` → `Dialogue`

**Status**: open (deferred API change)

## Problem

`docs/coding-standards.md` §5 and `CONTEXT.md` are explicit: "Runner", "engine",
"machine" are not synonyms for the runtime — the upstream concept is
**`Dialogue`**, and `YarnRunner` is listed under CONTEXT.md "Retired terms".
The exported class predates the glossary and keeps being extended under the
retired name (e.g. `setNode()` was just added to it).

## Why deferred

A rename touches every consumer: `src/index.ts` re-exports `YarnRunner`, the
React adapter (`useYarnRunner`), all test files, `examples/`, and any external
importers of the published package. Doing it inside the conformance-harness
commit would have buried a breaking API change in unrelated work.

## Scope

- Rename `YarnRunner` → `Dialogue` (file `src/runtime/runner.ts` →
  `dialogue.ts`), keeping `YarnRunner` as a deprecated alias for one minor
  release.
- Reconcile `useYarnRunner` → `useDialogue` similarly.
- Update CONTEXT.md "Retired terms" to point at the shipped name.

## Acceptance

Exports renamed with deprecation aliases; docs and glossary agree; no
behavior change.
