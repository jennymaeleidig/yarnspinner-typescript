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

**Status:** resolved

- [x] `isDialogueEnd` and its four branches deleted; end-ness derived
- [x] One `scheduleContinue(delay)`; three causes; one cleanup site
- [x] Timing tests rewritten against the scheduler, no widened-margin
      workarounds left
- [x] Suite green (incl. the jsdom client-render harness), lint clean

## Answer

Landed. **Dead state out:** `isDialogueEnd` is deleted from
`DialogueViewResult` — the field, the always-`false` write in `reshapeView`,
the four `DialogueView` branches (`yd-text-box-end` class,
`shouldShowContinue` guard, `handleClick` early-return, auto-continue
guard), and the now-unreachable `.yd-dialogue-box.yd-text-box-end` CSS
rule. End-ness is exactly `result === null`, which the view already renders
as the `yd-empty` fallback.

**One continue scheduler:** `DialogueView` owns a single timer.
`scheduleContinue(cause)` takes a named cause — `"command"` (hardcoded
`COMMAND_CONTINUE_DELAY_MS = 50`), `"typing-done"` (`continueDelay`),
`"click"` (`clickPause`) — with the delay policy in one switch inside the
scheduler (the ticket's `scheduleContinue(delay)` sketch, refined so the
delay lives with the scheduler rather than at the call sites). Scheduling
replaces any pending timer — there is never more than one;
`cancelScheduledContinue()` is the one clear. The one invalidation site is
a single effect keyed on the view state:
`useEffect(() => cancelScheduledContinue, [result])` — React runs cleanups
before setups in a commit, so the previous state's timer is always gone
before the next state's effects may schedule anew; the same effect covers
unmount and the dialogue-rebuild path. The three `setTimeout` sites and the
two clear sites (reset-effect cleanup + `handleClick`) are gone.

**Load-bearing detail:** the typing-done guard is now the *result identity*
the typing finished for (`typingDoneFor` state, set by TypingText's
`onComplete` and by the skip-typing click) instead of a boolean. With a
boolean, the post-continue commit reads a stale "typing complete" and the
typing-done effect schedules a spurious skip for the new line — the old
per-effect cleanups absorbed that by luck of their deps; the identity guard
kills the stale read at the source, which is what makes the single
invalidation site sound. Zero-pause clicks remain synchronous (continue
inside the click handler), preserved from the old code.

**Tests:** the two timing-budget alias tests are rewritten on the fake
clock (`t.mock.timers`), with the jsdom harness extracted to shared
`clientDomHarness.ts` and a `tickClock` helper that ticks 1ms steps —
node's `tick()` does not run timers scheduled during the same tick, and
`TypingText` chains one `setTimeout` per character. Exact timelines, zero
margins: ac7e2e3's widened `pauseBeforeAdvance` probe and the 400ms polling
budget are gone. Typing pins drive `typingSpeed > 0` (the setTimeout chain,
mockable) instead of the rAF path. Four new pins in
`continueScheduler.test.tsx`: the command flash (50ms, hardcoded), the
zero-pause synchronous click, replace-on-reclick for a paused click, and
the click superseding a pending typing-done continue (the cancel that used
to live in `handleClick`).

Verification: suite 542/542 (timing files green on 5 consecutive runs),
lint clean, ts-check clean, browser demo build, Next.js host build, and
SvelteKit host build all green. Public surface: `isDialogueEnd` removed
from the `text` variant of `DialogueViewResult` — hard break, no alias
(0.2.0 unpublished; binding Q4/Q5). No doc updates needed: the field was
never documented in CHANGELOG, CONTEXT.md, or compatibility.md.
