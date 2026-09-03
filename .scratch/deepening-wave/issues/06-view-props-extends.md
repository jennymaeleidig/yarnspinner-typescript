# 06: Single-source the view props

**What to build:** stop declaring every runtime option three times.
Today each runtime option costs three synchronized declarations + three
JSDoc variants + tests at two adapter layers — the observed 55/56 diff
shape: `DialogueOptions` (`src/runtime/events.ts`) → `UseDialogueOptions`
(`src/react/useDialogue.tsx`) → `DialogueViewProps`
(`src/react/DialogueView.tsx`, forwarded one-by-one with `startNode`
renamed `startAt` on the way).

**Decision (binding):** variant (a) only —
`DialogueViewProps extends UseDialogueOptions` (post-ticket-05 shape), the
forwarding becomes one spread, JSDoc is single-sourced. The **headless
split** (DialogueView presentational over `UseDialogueResult`) was
explicitly **deferred**: it's a real interface promise that deserves its
own design-it-twice pass, not a rider on a maintenance ticket — record it
in `.scratch/future-work.md`.

Note for the implementation: ticket 05 splits the hook options into
`config`/`live`; the view extends whichever type(s) make forwarding honest
— the view may pass `live` fields straight through, since the hook reads
them via ref. The three `??` fold chains for the deprecated typing-flow
aliases stay (they retire one release after 0.2.0 per the existing policy).

Deletion-test framing: the forwarding layer is a pass-through — what
justifies it is only the built-in visuals; this ticket removes the
declaration cost while keeping the visuals.

**Blocked by:** 05

Type: task

**Status:** open

- [ ] `DialogueViewProps` extends the hook's options type; one declaration
      per option; forwarding is one spread
- [ ] Adding a runtime option costs one edit (test: a temp option compiles
      through all three layers without new declarations — or the equivalent
      type-level pin)
- [ ] Headless split recorded in `future-work.md`
- [ ] Suite green, lint clean
