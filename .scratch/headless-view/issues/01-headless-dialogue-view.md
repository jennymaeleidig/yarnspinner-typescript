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

(appended at resolution)
