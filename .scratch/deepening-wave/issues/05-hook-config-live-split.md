# 05: useDialogue config/live split

**What to build:** reshape the hook's interface to
`useDialogue(program, config, live)`, killing the rebuild-on-change matrix
in `src/react/useDialogue.tsx` (~60 lines of change detection + per-option
JSDoc paragraphs — today: 8 options × 4 comparison disciplines, including
`haveFunctionsChanged`'s key-wise deep compare, `haveVariablesChanged`'s
double `JSON.stringify` per render, and `logError`/`logDebug` silently
ignored after construction).

**Decisions (binding):**
- **One rule:** config identity = dialogue identity. `config` holds
  construction-only inputs, reference-compared.
- **`variables` stays in `config`** — it seeds state; changing it means a
  new dialogue (same observable outcome as today's rebuild), not live
  re-seeding nobody asked for.
- **`live` is read through a ref** — identity ignored, always current;
  holds callbacks and logging (`onDialogueComplete`, `logError`,
  `logDebug`, and anything else per-call). Setters were considered and
  rejected: they add interface for a problem the ref already solves.
- `haveFunctionsChanged` / `haveVariablesChanged` are **deleted**, not
  hidden — with volatile inputs out of the construction path, they have no
  caller left.
- **Hard break, no alias** (0.2.0 never published — verified, no tags); the
  existing `@deprecated` alias machinery from tickets 55/56 is untouched
  and nothing here extends it.
- `adapterOptions.test.tsx`'s rebuild-matrix tests are rewritten to pin the
  one rule: config identity changes rebuild; `live` changes don't.

**Blocked by:** 04

Type: task

**Status:** resolved

- [x] `useDialogue(program, config, live)`; one comparison rule; the matrix
      helpers deleted
- [x] The frozen-`logError` trap is gone (live logging works after
      construction)
- [x] Tests pin: config identity = dialogue identity; `live` is always
      current
- [x] README/useDialogue JSDoc updated; suite green, lint clean

## Answer

Landed. `useDialogue(program, config, live)` — one comparison rule: **config
identity = dialogue identity** (`!dialogue || programRef !== program ||
configRef !== config`); `haveFunctionsChanged` (key-wise deep compare) and
`haveVariablesChanged` (double `JSON.stringify` per render) are deleted,
not hidden. `UseDialogueOptions` is the config type (construction-only:
`startAt`, `functions`, `variables`, `variableStorage`, `textProvider`,
`lineHints`) and the new `UseDialogueLive` holds the per-call inputs
(`onDialogueComplete`, `logError`, `logDebug`, deprecated `onStoryEnd`).
Naming note: the ticket's sketch implies `UseDialogueConfig`; keeping
`UseDialogueOptions` as the config type leaves the ticket-55/56 alias
machinery (`UseYarnRunnerOptions = UseDialogueOptions`, `useYarnRunner: typeof
useDialogue`, `UseYarnRunnerResult`) byte-for-byte untouched — the aliases
are exact by construction and this break adds no new deprecation cycle
(binding).

**`live` is read through a ref** synced in an effect declared ahead of the
completion effect (same-commit completions read fresh callbacks); identity
is ignored, so `DialogueView` passes a fresh literal every render while
memoizing only its config. **The frozen-`logError` trap is gone via
trampolines**: the Dialogue is constructed with closures that forward to
`liveRef.current`'s logging (defaulting to `console.error`/silent), so
hosts can swap loggers after construction — previously `logError`/`logDebug`
were frozen at construction and `onDialogueComplete` was read through an
`optionsRef` that was only updated inside the rebuild branch (stale unless
a rebuild happened; the rewrite fixes that class of bug wholesale).
`variables` stays in config — seeding, not live re-seeding (binding).

**Consumer discipline the rule imposes** (pinned by the tests): config must
be a stable object across renders — an inline literal rebuilds on every
render. `DialogueView` `useMemo`s its config for this. The old code hid the
difference (per-field compares tolerated inline literals), which is exactly
the ambiguity the ticket kills.

**Tests:** two new client-harness pins in `adapterOptions.test.tsx` (the
probe re-renders the same component type so hook state persists): config
identity is dialogue identity (same object → same dialogue; fresh object
with identical values → new dialogue) and live is always current (swapped
`logError` receives post-construction diagnostics, no rebuild, old callback
detached). The onStoryEnd/alias and logError/logDebug call sites moved the
callbacks to the live param with a shared stable `EMPTY_CONFIG`. Header
comment rewritten from the rebuild matrix to the one rule.

**Docs:** README hook entry now documents the `(program, config, live)`
signature, the config list under the one rule, and the live list as
ref-read/always-current; `DialogueView`'s entry updated likewise;
`logError`/`logDebug` prop docs dropped the "changing it is ignored"
claims; the hook's module doc states the config/live contract.

Verification: suite 544/544, lint clean, ts-check clean, browser demo
build, Next.js host build, SvelteKit host build green. Public surface:
hook signature gains the `live` param (optional, so 2-arg calls still
typecheck); `logError`/`logDebug`/`onDialogueComplete`/`onStoryEnd` move
from `UseDialogueOptions` to `UseDialogueLive` — hard break, no alias
(0.2.0 unpublished; binding). The existing alias machinery is untouched.
