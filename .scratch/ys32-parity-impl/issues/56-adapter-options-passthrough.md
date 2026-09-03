# 56 — Adapter options passthrough: expose the newer DialogueOptions through useDialogue

Type: task
Status: resolved
Landed in: 319fea9
Blocked by: 55 (adapter resurfacing — same surface, follow-on scope)

## What to build

`UseDialogueOptions` still whitelists only `startAt`, `functions`,
`variables`, and `onDialogueComplete` — the hook constructs
`Dialogue(program, { startAt, library })` directly
(`src/react/useDialogue.tsx`), so React consumers cannot reach the surfaces
the 0.2.0 runtime shipped:

- `variableStorage` (spec story 39, ticket-55 review's explicit gap) — the
  persistence seam; changing identity should rebuild the dialogue (like
  `program`), and the render-phase input-comparison must account for it
  (see `haveVariablesChanged`/`haveFunctionsChanged` for the house pattern —
  reference compare, not deep, since a storage is stateful)
- `textProvider` + language switching (ticket 51) — decide the React shape:
  plain option passthrough (rebuild on identity change) vs. a documented
  escape hatch through `result.dialogue`; keep `setLanguage` on the
  Dialogue per the ticket-51 surface
- `lineHints` (opt-in `LineHintsEvent` — the hook already consumes
  `lineHints` events silently, so this is likely just forwarding the flag)
- `logError` / `logDebug` (runtime diagnostics; default behaviour must not
  change)

Rules: no new adapter abstractions (map decision — examples, not package
surface); passthrough only, with the same rebuild-on-change discipline the
existing options use; deprecated-alias pattern NOT needed (nothing is
renamed); tests through the public seam (`renderToStaticMarkup` probe per
ticket 55's harness) pinning at least variableStorage injection and
lineHints forwarding.

## Acceptance

All four option groups usable from React with SSR-correct first render;
input-change behaviour documented per option (rebuild vs. ignored);
suite + lint + demo build green.

## Answer

Landed in: 319fea9 — the four option groups pass through `useDialogue`
(and `<DialogueView>`, so the acceptance's "usable from React" holds for
component consumers too) with per-option change behaviour documented on
the option/prop types, README, and CHANGELOG: `variableStorage` and
`textProvider` rebuild on identity change (reference compare — both are
stateful); `lineHints` rebuilds on flip (truthiness compare, the
`startAt` pattern); `logError`/`logDebug` are construction-time — changing
them is ignored (pass a stable callback; defaults `console.error`/silent
unchanged, pinned). React shape for language switching (the ticket's
decision point): plain `textProvider` passthrough + the documented
escape hatch — `result.dialogue.setLanguage`, no hook-level language API,
no rebuild needed; pinned in-test by the same provider instance resolving
under the new language. `renderToStaticMarkup` hook-probe tests
(`src/tests/adapterOptions.test.tsx`, 10): persistence restore through a
pre-populated storage (declare default suppressed), lineHints forwarding
+ default-off (observed through the `dialogue` escape hatch — the hook
consumes the events silently, so the pin pulls the next node's batch
raw), provider resolution + setLanguage switching, logError forwarding +
console.error default, logDebug, DialogueView wiring. Harness notes
recorded in the test file: a captured hook's `result` is a render-time
snapshot (post-SSR `continue()` mutates refs, never re-renders), so
advancing assertions go through spies and the escape hatch. Suite
481/481 + lint + demo build green — verified in an isolated HEAD+diff
worktree because ticket 54's in-flight session had the shared tree
mid-edit at landing time. Reviewer judgement calls recorded, not acted
on: DialogueViewProps hand-declares the five options (matches the
file's pre-existing prop style; a `Pick<UseDialogueOptions, …>` is the
desync-proof alternative if the props surface grows again), and the
rebuild predicate is accumulating per-ticket compares (named comparators
if a fourth ticket touches it).
