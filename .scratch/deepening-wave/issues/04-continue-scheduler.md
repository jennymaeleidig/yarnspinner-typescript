# 04: Dead state out, one continue scheduler

**What to build:** two cleanups in the adapter's timing/state layer
(`src/react/useDialogue.tsx`, `src/react/DialogueView.tsx`):

1. **Delete `isDialogueEnd` outright** — the field in `DialogueViewResult`
   (declared at useDialogue.tsx:59) is only ever written `false`
   (useDialogue.tsx:209) because `reduceView` returns `null` on
   `dialogueComplete`. Four live branches in DialogueView (the
   `yd-text-box-end` class, `shouldShowContinue` guard, `handleClick`
   early-return, auto-continue guard) are dead code. End-ness derives from
   `result === null` (the existing "Dialogue ended or not started"
   fallback).
2. **Fold the three `setTimeout` continue paths into one**
   `scheduleContinue(delay)` fed by named causes — command auto-continue
   (hardcoded 50 ms), typing-done (`continueDelay`), click (`clickPause`).
   One timer, one cleanup site (today the skip-typing path clears pending
   timeouts in two places).

**Decision (binding):** no deprecation cycle — the one-release alias policy
covered renames, not unimplementable state; no consumer can be working by
depending on a field that is never `true`. Timing-budget tests
(see commit ac7e2e3's margin-widening) get rewritten against the single
scheduler so they stop flaking.

**Blocked by:** 03 (same files as the hook reshape; land after the
reduction module settles the view-state shape)

Type: task

**Status:** open

- [ ] `isDialogueEnd` and its four branches deleted; end-ness derived
- [ ] One `scheduleContinue(delay)`; three causes; one cleanup site
- [ ] Timing tests rewritten against the scheduler, no widened-margin
      workarounds left
- [ ] Suite green (incl. the jsdom client-render harness), lint clean
