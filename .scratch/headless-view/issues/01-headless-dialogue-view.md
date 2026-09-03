# Headless `DialogueView`: presentational over the result

**Status:** resolved

Deferred from [deepening-wave ticket 06](../../deepening-wave/issues/06-view-props-extends.md)
with these binding criteria:

- [x] A presentational `DialogueView` rendering a `UseDialogueResult` —
      **no `program` prop, no hook call**
- [x] A design-it-twice pass on the interface promise: what does a headless
      view own — state, scheduling, typing?
- [x] Suite green, lint clean, docs and glossary in sync

## Context

Ticket 06 single-sourced the view props (`DialogueViewProps extends
UseDialogueOptions, UseDialogueLive`), which fused the container (hook call,
config memo) and the presentation (typing, scheduling, markup) into one
component. Ticket 04 put the continue scheduler and typing state in that
component. The deferral promised the separation would get its own pass.

## Design-it-twice

**The interface question.** What does a headless view own: state,
scheduling, typing?

**Candidate A — the view owns presentation state; the container owns the
wiring.** `DialogueView` takes a `UseDialogueResult` (one prop, the whole
result object: view state, `continue`, `selectOption`, `sceneName`) plus
presentation options. It keeps the typing state and the one continue
scheduler (ticket 04's machinery moves with it verbatim) and calls
`result.continue` / `result.selectOption`. A new container — `DialogueRunner`,
named for the package itself — takes `program` + config + live + the
deprecated alias names, calls `useDialogue`, and forwards. Hosts that want
control skip the runner: `useDialogue(program, config)` + `<DialogueView
result={result} />` is the whole story.

**Candidate B — a purely stateless view; the container owns everything
stateful.** `DialogueView` renders `(viewState, callbacks)` with zero
internal state; typing flags and the scheduler move to the container.
Rejected: it hoists presentation concerns (timers, typing/skip flags) into
the container, making the container a second view-state machine — the split
would separate the runtime from the *markup* but not from the *presentation
logic*. Every host using `useDialogue` + `DialogueView` directly would have
to reimplement typing-skip and scheduling, duplicating ticket 04's
one-scheduler shape at every use site.

*(Folded: a flat-props variant — `viewState`/`onContinue`/`onSelectOption`/
`sceneName` as separate props instead of the result object — is more
plumbing for no extra capability; the single-result-object promise from the
deferral stands.)*

**Decision (binding): candidate A.** The interface promise, stated:
**the headless view owns presentation state only** — typing progress, the
typing skip, and the one continue scheduler (causes: command flash,
typing-done, click) — and owns **zero dialogue state**; the result object
carries all dialogue state and transitions. Hard breaks are available
(0.2.0 unpublished): `DialogueView` loses `program` and every config/live
prop; the current prop surface moves to `DialogueRunner` intact, including
the ticket-55 deprecated alias names resolved there (new name wins).

Derivation stays single-sourced in the ticket-06 spirit:
`DialogueRunnerProps extends Omit<DialogueViewProps, "result">,
UseDialogueOptions, UseDialogueLive` — presentation options are declared
once, on the view; the runner derives them.

## Answer

Landed as **candidate A** (the decision above was made before
implementation; both candidates written out first, per the binding). The
interface promise, as shipped: **the headless view owns presentation state
only** — typing progress, the typing skip, and the one continue scheduler
(ticket 04's causes: command flash, typing-done, click) — and owns **zero
dialogue state**; the result object carries every dialogue state and
transition.

- `DialogueView` now takes `{ result: UseDialogueResult }` + presentation
  options; it destructures the view state, `continue`, `selectOption`, and
  `sceneName` off the result object. No `program`, no hook call, no
  config/live props — pinned by `@ts-expect-error` type pins (no `program`,
  no deprecated aliases) and hand-built-result tests (text + options/empty,
  SSR) that construct the result with no program and no hook in sight.
- `DialogueRunner` (new, named for the package itself) is the wired
  container: the pre-split `DialogueView` surface moves to it verbatim —
  program + config + live, the config memo, the whole-props-as-live
  forwarding, and the ticket-55 deprecated alias names resolved there
  (new name wins; the aliases live on the runner, not on the clean view).
- Derivation stays single-sourced in the ticket-06 spirit:
  `DialogueRunnerProps extends Omit<DialogueViewProps, "result">,
  UseDialogueOptions, UseDialogueLive` — presentation options declared
  once, on the view; runtime options flow from `DialogueOptions` without a
  second declaration. Both derivation directions pinned type-level in
  `adapterOptions.test.tsx`.
- The scheduler/typing machinery moved with the view unchanged — the
  continueScheduler pins now run through `DialogueRunner`, plus a new pin
  that a host pairing `useDialogue` + `DialogueView` directly (no runner)
  gets the identical command-flash timeline. That test's first draft
  failed by violating the config-identity rule in its own host (fresh `{}`
  literal every render rebuilt the dialogue) — fixed with a stable config,
  exactly what the documented rule demands of real hosts.
- Hard break (0.2.0 unpublished, allowed): `DialogueView` no longer accepts
  `program` or any config/live prop. `DialogueExample`, the README, and
  the five React docs pages migrated; compatibility.md records the break;
  CONTEXT.md gains the **DialogueRunner / DialogueView (the split)**
  glossary entry. `examples/react/` gains the one-line `DialogueRunner`
  re-export for symmetry.

Candidate B (a purely stateless view, typing/scheduling hoisted into the
container) was rejected in the design pass: it would make the container a
second view-state machine and force every `useDialogue` + `DialogueView`
host to reimplement typing-skip and scheduling, duplicating ticket 04's
one-scheduler shape at every use site.

Verification: suite 551/551 (547 + 3 hand-built pins + the no-runner
scheduler pin + the exports pin), lint clean, ts-check clean (including
the negative `program` pin), browser demo build, Next.js and SvelteKit
hosts green.

Review follow-up (two-axis review vs `5a0460a`): the spec reviewer caught
that this Answer never landed — the resolution edit appending it failed on
a mismatched anchor and the retry fixed only the status line. Appended
now (this paragraph marks the repair). The same review produced two hard
fixes, landed with it: `docs/scenes.md`'s second import still named the
nonexistent `"yarn-spinner-ts"` package (coding standards Std 7 — stale
docs fixed in the same change; my sed fixed the value import and missed
the type import), and the view-rejects-aliases claim gained its negative
pin in `adapterOptions.test.tsx`.
