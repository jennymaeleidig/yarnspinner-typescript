# 56 — Adapter options passthrough: expose the newer DialogueOptions through useDialogue

Type: task
Status: open
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
