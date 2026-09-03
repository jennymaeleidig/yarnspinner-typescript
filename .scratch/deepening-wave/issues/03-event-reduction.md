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

**Status:** open

- [ ] `runUntilStopped` + `Transcript` in `src/runtime/`, contract pinned by
      a dedicated test file citing upstream semantics
- [ ] Hook, both hosts, StoryletsDemo, and both host-test helpers are thin
      adapters; the per-site copies (incl. the StoryletsDemo drain bug) are
      gone
- [ ] `compatibility.md` + CONTEXT.md glossary entries
- [ ] Suite green, lint clean, demo/host builds green
