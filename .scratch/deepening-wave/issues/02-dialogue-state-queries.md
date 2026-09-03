# 02: Dialogue state queries + mirror collapse

**What to build:** add two readonly getters to `Dialogue`
(`src/runtime/dialogue.ts`, forwarding to the VM's private
`pendingOptions`/`completed`):

- `isWaitingForOptionSelection: boolean` — an option set is pending;
  `continue()` would log-and-return-empty. **Name mirrors the Rust
  reference's** `is_waiting_for_option_selection()`
  (rust `crates/runtime/src/dialogue.rs:511`), whose own doc states the
  exact use case: "If this is `true`, calling `continue_` will error."
  (.NET 3.x has no equivalent — only `IsActive`.)
- `isComplete: boolean` — a `DialogueComplete` event has been delivered.
  **No upstream precedent in either implementation** (verified absence:
  nothing like `IsComplete`/`is_complete` in .NET `Dialogue.cs` or the
  Rust runtime crate; completion is push-only upstream) — this ships as a
  **recorded project extension**. It remains derivable in spirit: upstream
  reaches `Stopped` after `DialogueComplete` making `IsActive` false; we
  keep the explicit flag because `stop()` must not conflate with complete.
  **Edge semantics (decided):** `isComplete` answers "did the story
  finish?", not "is it done being used?" — `stop()` makes the dialogue
  inactive but does NOT set `isComplete`; `isWaitingForOptionSelection`
  is `false` before the first `continue()`.

Then collapse the four consumer mirrors **in this ticket** (one adapter =
hypothetical seam): the hook's `awaitingSelectionRef`
(`src/react/useDialogue.tsx`), and both hosts' `options !== null` /
transcript-scan `ended` derivations (`examples/nextjs-host/app/DialogueHost.tsx`,
`examples/sveltekit-host/src/lib/DialogueHost.svelte`) read the getters
instead.

**`continue()`-while-pending error mode (research-corrected):** both
upstreams fail LOUDLY — .NET throws `DialogueException`
(`VirtualMachine.cs:537–540`), Rust returns
`Err(ContinueOnOptionSelectionError)` (`virtual_machine.rs:214–224`). This
fork's log-and-empty-batch is therefore a *divergence*, not upstream
behaviour. **Keep it** — coding-standards §3 (no throw crosses the seam)
is the same recorded principle that made tagLines aborts data (ticket 51)
and line-ID collisions YS0041 (ticket 50) — and **record it** in
`docs/compatibility.md`'s deliberate-divergences list, citing the upstream
throw/Err behaviour.

**Upstream alignment (binding, resolved by research):** Rust naming wins
where the Rust reference answers; `isComplete` and the `continue()` error
mode are recorded divergences/extensions in `compatibility.md`. Extends
ADR-0002 (the pull API); does not reverse it.

**Blocked by:** None (can start immediately; naming gated on the upstream
research in map.md Fog — resolve that before writing the public names)

Type: task

**Status:** open

- [ ] `isWaitingForOptionSelection` (Rust-mirrored) + `isComplete` on
      `Dialogue`, semantics per above, pinned by unit tests including the
      `stop()` and before-first-`continue()` edges
- [ ] Hook and both hosts consume the getters; `awaitingSelectionRef` and
      both `ended`-scan derivations deleted
- [ ] `compatibility.md` entries: `isComplete` as recorded project
      extension; `continue()`-while-pending logged-not-thrown divergence
      (citing .NET `DialogueException` / Rust `Err`)
- [ ] Suite green, lint clean

## Comments

### Upstream research findings (2026-09-03)

Agent-researched against upstream sources (see map.md Fog for the summary):
Rust `is_waiting_for_option_selection()` exists (dialogue.rs:511) and
documents itself as "if true, `continue_` will error"; `can_continue()`
also exists (dialogue.rs:290). .NET exposes only `IsActive` (Dialogue.cs:600);
the VM's richer `ExecutionState` enum (`Stopped | WaitingOnOptionSelection |
WaitingForContinue | DeliveringContent | Running`, VirtualMachine.cs:280–311)
is assembly-internal in .NET and `pub(crate)` in Rust — neither upstream
considers it user surface, which supports keeping our getters as the
consumer-facing projection rather than exposing raw state. Completion is
push-only in both (handler/delegate). No name collisions in this repo's
`src/` (verified).
