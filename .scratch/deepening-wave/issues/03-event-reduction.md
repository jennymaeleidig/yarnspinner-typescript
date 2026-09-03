# 03: Event-reduction module (Transcript)

**What to build:** one deep module in `src/runtime/` owning the
stopping-point contract — today re-derived at six sites in three shapes:

- `useDialogue.tsx` `reduceView` (queue+refs reducer)
- Next.js host `pull()`, SvelteKit host `pull()` (transcript merges)
- `StoryletsDemo.tsx` `for(;;)` drain (with the latent empty-batch-≠-over bug)
- `sveltekitHost.test.ts` `runUntilComplete`, `nextjsHost.test.tsx` mirrored
  pull (test copies — the tests currently cannot exercise the shipped host
  logic and say so in their headers)

Interface sketch (from the review; final shape is the ticket's to refine):
`runUntilStopped(dialogue, prior)` → `{ transcript, stopped: "line" |
"options" | "command" | "complete" }`. The contract it encodes: line stops;
options stop and await selection; commands surface-then-skip;
nodeStart/nodeComplete/lineHints ride through; dialogueComplete terminates.
Uses ticket 02's getters for the pending/over checks.

**Decisions (binding):**
- Hosts **adopt the shared `Transcript` type** as component state — no
  per-host reshape layers (their render-code changes are mechanical field
  renames).
- The module stays a **pure pull→transcript function**: the SSR
  "create dialogue + first pull during render" idiom stays per-framework —
  two different seams, don't fuse.
- The hook's `reduceView` becomes a thin reshaper over the module;
  `DialogueView` is unchanged.
- **Upstream alignment:** the contract itself is upstream behaviour (it
  re-delivers the existing event stream — the conformance suite pins it);
  the module's tests cite upstream `Continue()` semantics. The module is
  exported, documented non-upstream orchestration surface (same status as
  the loader), recorded in `compatibility.md`.
- **Domain-modeling side effect:** CONTEXT.md glossary gains **Transcript**
  and **stopping point** (adapter-side section).

Wins: locality (one home for the contract), leverage (one interface, six
call sites), tests exercise shipped logic, ~100 duplicated lines deleted.

**Blocked by:** 02

Type: task

**Status:** resolved

- [ ] `runUntilStopped` + `Transcript` in `src/runtime/`, contract pinned by
      a dedicated test file citing upstream semantics
- [ ] Hook, both hosts, StoryletsDemo, and both host-test helpers are thin
      adapters; the per-site copies (incl. the StoryletsDemo drain bug) are
      gone
- [ ] `compatibility.md` + CONTEXT.md glossary entries
- [ ] Suite green, lint clean, demo/host builds green

## Answer

Landed. The module is `src/runtime/transcript.ts`:
`runUntilStopped(dialogue, prior = EMPTY_TRANSCRIPT)` →
`{ transcript, stopped }`, with `Transcript` (`lines: TranscriptLine[]`,
`options: DialogueOption[] | null`, `commands: string[]`), `StoppingPoint`
(`"line" | "options" | "command" | "complete"`), and `EMPTY_TRANSCRIPT` —
exported from the main entry (same non-upstream orchestration standing as
the loader, recorded in `compatibility.md`).

**The contract, one home:** line stops · options stop and await selection ·
commands surface-then-skip · nodeStart/nodeComplete/lineHints ride through ·
dialogueComplete terminates. Two at-rest guards absorb what every call site
pre-handed-rolled: pending selection → return `prior` unchanged with
`"options"` (the VM's log-and-empty divergence is never triggered —
verified by a logError spy in the contract tests); complete → return `prior`
with `"complete"` (the complete event delivers exactly once). One new edge
decision recorded here: **a resolved option set leaves the transcript on the
next pull** — `options` on a `Transcript` means "the live set, render it",
so both hosts deleted their manual `{ ...prior, options: null }` clears.
The internal loop over lifecycle-only batches cannot run away: the VM's
batch contract delivers one stopping point per `continue()`, and with both
at-rest guards an empty batch is unreachable — no fifth `"stalled"` state
was needed (VM-verified: node end fires `dialogueComplete` in-batch;
`stop()`'s complete delivers queued).

**Adapters:** the hook's queue+refs `reduceView` is gone — `applyPull` runs
the module and `reshapeView` maps the stopping point to the unchanged
`DialogueViewResult`; the hook's pending guards stay as UI-level idempotence
(clicks while pending are no-ops, they never reach the module). Both hosts
adopt the shared `Transcript` as component state (their local interfaces and
`pull()` deleted); the SSR first-pull-during-render idiom stays per-framework
as decided. StoryletsDemo drains by looping the module across line/command
stops — the latent empty-batch-≠-over bug died with the copy. Both host test
helpers are loop-adapters over the module, so the host suites now exercise
the shipped pull logic; their "mirrored here" header disclosures are
rewritten to say so.

**One test changed trigger, same intent:** `adapterOptions.test.tsx`'s
logDebug test used a second hook `continue()` on the completed dialogue to
fire the VM's inactive-dialogue debug diagnostic — the module's guards mean
the hook never makes that call (the old hook logged debug noise on every
post-completion click; strictly better). The test now triggers the
diagnostic through the documented `result.dialogue` escape hatch, still
proving the logDebug wiring.

**Left for ticket 06 (view-props surgery):** the view's `isDialogueEnd`
field is still hardcoded `false` — `DialogueView` (unchanged by this
ticket, per the binding) consumes it in four places; Q4's outright deletion
needs those four edits and belongs to the prop-surface ticket.

**compatibility.md** gained the deliberate-divergences entry (exported
non-upstream orchestration; the contract itself is upstream batch
behaviour, pinned by the new tests). **CONTEXT.md** glossary gained
**Transcript** and **stopping point** in the adapter-side section.

Verification: suite 537/537 (12 new pins in `src/tests/transcript.test.ts`,
each citing its upstream counterpart — .NET `Dialogue.cs` handlers /
`VirtualMachine.cs:537–540`, Rust `Dialogue::continue_` /
`virtual_machine.rs:214–224`), lint clean, ts-check clean, browser demo
build, Next.js host build, and SvelteKit host build all green. Public
surface: `runUntilStopped`, `Transcript`, `TranscriptLine`, `StoppingPoint`,
`EMPTY_TRANSCRIPT` — additive; hard breaks acceptable (0.2.0 unpublished).
