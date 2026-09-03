# 55 — Adapter resurfacing: retire `advance`/`onStoryEnd` vocabulary

Type: task
Status: claimed
Blocked by: 53 (the rename wave — this is the adapter slice ticket 53 deferred)

## What to build

Ticket 53's review kept the React adapter on fork-era prop names because
renaming them "needs its own adapter-resurfacing ticket with a glossary
pass". This is that ticket, scoped to NAMES only (no adapter feature work —
the tickets 43/52 rule stands):

- `UseDialogueResult.advance` → **`continue`** (glossary "Continue"; matches
  `Dialogue.continue()` one-to-one)
- `UseDialogueOptions.onStoryEnd` / `DialogueViewProps.onStoryEnd` →
  **`onDialogueComplete`**, payload `{ variables, storyEnd: true }` →
  `{ variables, dialogueComplete: true }` (glossary: retired `onStoryEnd`
  maps to the `DialogueComplete` event)
- `DialogueViewProps.autoAdvanceAfterTyping` → `autoContinueAfterTyping`,
  `autoAdvanceDelay` → `autoContinueDelay`, `pauseBeforeAdvance` →
  `pauseBeforeContinue` (same retired verb; aliases keep one-release
  parity with the ticket-53 pattern)
- Deprecated exact aliases for all of the old names (one release, pinned by
  `deprecatedAliases.test.ts`), `@deprecated` JSDoc so tooling strikes them
- Glossary pass: CONTEXT.md retired-terms note, migration-notes §5, README
  examples (including the stale `onAdvance`/`result`-prop DialogueView
  snippets in README/scenes.md/typing-animation.md/actor-transition.md —
  those props never existed on the component; §7)
- Internal `storyEnd*` refs and "advance" comments migrated; the browser
  demo (`DialogueExample.tsx`) moved to the new names

Out of scope (recorded, not built): passing the newer `DialogueOptions`
(`variableStorage`, `textProvider`, `lineHints`, `logError`) through
`UseDialogueOptions` — that is adapter surface growth, still governed by
the no-adapter-feature-work rule; its own ticket if wanted.

## Acceptance

New names everywhere in src/react, docs, README; deprecated aliases
`@deprecated`-tagged and pinned (identity + behaviour) in
deprecatedAliases.test.ts; suite + lint green; demo build green.
