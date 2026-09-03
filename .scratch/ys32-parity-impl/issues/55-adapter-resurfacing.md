# 55 — Adapter resurfacing: retire `advance`/`onStoryEnd` vocabulary

Type: task
Status: resolved
Landed in: ee13b19
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

## Answer

Landed in: ee13b19 — exactly the scope above. `advance` is the same
function value as `continue` (identity pinned via an SSR hook-probe test);
`onStoryEnd` keeps its original payload and fires only when
`onDialogueComplete` is absent; the three typing-flow props rename with
aliases folding into the new names. Docs: README options/exports/example,
typing-animation.md, migration-notes §6, CONTEXT.md retired-terms note —
plus the stale `onAdvance`/`result`-prop DialogueView snippets in README,
scenes.md, typing-animation.md, and actor-transition.md corrected to the
real component API (§7: those props never existed). Suite 476/476, lint
clean, demo/host/sveltekit builds green. Out-of-scope note stands:
DialogueOptions passthrough (variableStorage/textProvider/lineHints/
logError) needs its own ticket if wanted.

### 2026-09-03 — final review wave

The acceptance's "identity + behaviour" pin is now complete: ee13b19 only
pinned the `advance === continue` identity; the behaviour half landed in
6452978 — four jsdom client-render tests in `deprecatedAliases.test.ts`:
onStoryEnd fires only when onDialogueComplete is absent (original payload
`{storyEnd: true, variables}`), onDialogueComplete wins when both are
given, autoAdvanceAfterTyping + autoAdvanceDelay drive the auto-continue
(5ms alias delay proven against the 500ms default), and pauseBeforeAdvance
defers a click. Harness fact: the SSR renderToStaticMarkup probe can't fire
post-commit effects, so behaviour pins use a jsdom client render (jsdom +
@types/jsdom added as devDependencies). Reviewer follow-up ac7e2e3 widened
the pauseBeforeAdvance margin (50ms pause / 10ms probe) so a stalled event
loop can't reorder the probe past the deferred continue.
