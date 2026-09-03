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

**Status:** resolved

- [x] `DialogueViewProps` extends the hook's options type; one declaration
      per option; forwarding is one spread
- [x] Adding a runtime option costs one edit (test: a temp option compiles
      through all three layers without new declarations — or the equivalent
      type-level pin)
- [x] Headless split recorded in `future-work.md`
- [x] Suite green, lint clean

## Answer

Landed. `DialogueViewProps extends UseDialogueOptions, UseDialogueLive` —
the nine duplicated runtime-option declarations and their JSDoc variants
are gone; the view declares only what it owns (`program`, presentation,
typing flow, the deprecated typing aliases, which stay per the binding).
Forwarding: the config fields build one memoized object (config identity is
dialogue identity, so it must be stable — the memo deps enumerate the
fields); the live fields forward as the **props object itself** — the hook
ref-reads exactly its live fields off it and ignores the rest, so new live
options forward with zero view edits.

**The chain derives end to end:** `UseDialogueOptions` now extends
`Omit<DialogueOptions, "library" | "logError" | "logDebug">` (plus its
`functions` re-model of `library`), so the one-edit rule holds for the
whole chain: a runtime option declared on `DialogueOptions` appears in the
hook's config and the view's props with no further declarations. The hook's
construction spreads the config into `new Dialogue(program, { ...config,
library, logError: trampoline, logDebug: trampoline })`, so new runtime
options forward without per-field code. The type-level pin lives in
`adapterOptions.test.tsx`: `DialogueOptions` assigns to both
`UseDialogueOptions` and `DialogueViewProps` (+ `program`), and compiles
only while the derives exist.

Two additive surface changes fell out, both alignment-positive:
- **`contentSaliencyStrategy` now reaches React hosts** — the runtime
  option was never forwarded by the hook (a gap, not a decision); the
  derive + spread forwards it.
- **`$`-prefixed variable keys normalize**: the hook previously seeded
  `variables` through `dialogue.setVariable` (no `$`-normalization) while
  the VM's own `DialogueOptions.variables` path normalizes
  (`"$gold"` → `gold`, per its documented "$ prefix optional"). The manual
  seeding loop is deleted; the VM constructor is the single seeder
  (upstream-aligned: host variables apply after `<<declare>>` defaults).

**`startNode` → `startAt`:** with the view inheriting the hook's `startAt`,
keeping `startNode` as a second way to set the start node would leave the
inherited `startAt` silently ignored — a trap. The view prop is renamed to
`startAt` (hard break, 0.2.0 unpublished); the VM's
`defaultStartNodeName` covers the default, so the view needs no default of
its own.

**Headless split:** recorded in `future-work.md` per the binding —
explicitly deferred as a real interface promise deserving its own
design-it-twice pass. (Note: `future-work.md` currently carries a
concurrent session's in-progress cleanup hunks, so this commit leaves the
file unstaged — the entry rides in the working tree and lands with that
session's commit.)

Verification: suite 544/544, lint clean, ts-check clean, browser demo
build, Next.js host build, SvelteKit host build green. Public surface:
`DialogueViewProps` gains every hook option (additive); `startNode` prop
renamed `startAt` (hard break); the view's `functions` type narrows to the
hook's `Record<string, YarnFunction>` — identical structure
(`(...args: unknown[]) => unknown`), no behavioral change. Alias machinery
untouched.
