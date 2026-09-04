# Compatibility

This library targets **behavioral parity with Yarn Spinner 3.2.2** — the
newest upstream tag (re-checked at the 0.2.0 release: no `v3.2.3` or `v3.3.0`
exists yet; upstream has announced a future 3.3 but not shipped it).

Parity here means the observable contract upstream's own test suite pins:

- The **conformance corpus** — the `test/fixtures/upstream/YarnSpinner` git
  submodule, pinned byte-exact at upstream tag `v3.2.2` (`Tests/` subtree) —
  drives the compile → run
  pipeline (`src/tests/upstream-conformance.test.ts`). Event streams, not
  bytecode, are the contract (ADR 0001: our program format is this project's
  own versioned JSON, deliberately not upstream's protobuf).
- **Diagnostics** use upstream's stable YS-codes, keyed to the per-code
  registry in the upstream repo (authoritative — the docs errors page is
  stale on severities), plus a local `YP` range for `.yarnproject` loading,
  which upstream has no registry for.
- **Deliberate divergences** (each with a recorded decision, never silent
  drift):
  - Program/bytecode format is our own versioned JSON (ADR 0001/0003).
  - The runtime API is pull-based (`continue()` → `DialogueEvent[]`), the
    Rust port's shape, not upstream .NET's push handlers (ADR 0002).
  - On error diagnostics upstream nulls the program; this fork keeps it
    observable.
  - Line-ID collision handling: upstream throws after 1000 suffix attempts;
    this fork emits YS0041 and keeps retrying past that cap — no throw
    crosses the seam (coding standards §3).
  - `tagLines` aborts are data, not throws (upstream `TagLines` throws on
    abort), and upstream's 500 ms stopwatch becomes an attempt cap — no
    clocks in the library (coding standards §2/§3).
  - `continue()` while an option set is pending logs a diagnostic and
    returns an empty batch; upstream fails loudly (.NET throws
    `DialogueException`, `VirtualMachine.cs:537–540`; Rust returns
    `Err(ContinueOnOptionSelectionError)`, `virtual_machine.rs:214–224`) —
    no throw crosses the seam (coding standards §3; the tagLines/line-ID
    precedents). `Dialogue.isWaitingForOptionSelection` (Rust
    `is_waiting_for_option_selection`, same name) lets hosts avoid the
    call.
  - `Dialogue.isComplete` is a recorded project extension: upstream
    completion is push-only (the `DialogueComplete` handler/delegate; no
    `IsComplete`/`is_complete` exists in .NET 3.x `Dialogue.cs` or the Rust
    runtime crate). It answers "did the story finish?", not "is it done
    being used?" — `stop()` makes the dialogue inactive without completing
    it, and its complete event still delivers on the next `continue()`.
    The React adapter leans on that delivery-not-queued contract: after
    `stop()` with an option set pending, the next pull drains the queued
    complete and fires `onDialogueComplete`, where a blocking read would
    hang forever (corrected Answer).
  - The transcript-reduction module (`runUntilStopped`/`Transcript`) is
    exported non-upstream orchestration over the pull API — same standing
    as the loader and the React adapter. Upstream has no transcript
    accumulator; the stopping-point contract it packages (line stops,
    options stop and await selection, commands surface-then-skip, node
    lifecycle and line-hint events ride through, completion terminates) is
    upstream's own batch behaviour, re-delivered and pinned by
    `src/tests/transcript.test.ts` against the upstream semantics cited
    there (.NET `Dialogue.cs` handlers; Rust `Dialogue::continue_`).
  - `NodeStartEvent.scene?` and `Transcript.scene` are recorded project
    extensions: upstream's node-start event carries the node name only, and
    upstream has no transcript. The `scene:` header is an ordinary
    upstream-compatible header; its images and actors are this project's
    scene system (non-upstream, CONTEXT.md glossary), so the name rides the
    node-start event to the one seam where hosts cross-check it against
    their scene collection.
  - The `.yarnproject` loader and the React adapter are this project's own
    surface (non-upstream).
  - React component split (hard break — 0.2.0 is
    unpublished): `DialogueView` is presentational — it renders a
    `UseDialogueResult` and no longer accepts `program` or any config/live
    prop; the wired surface moved verbatim to the new `DialogueRunner`
    container, which also resolves the deprecated prop aliases
    (the aliases live on the runner, not on the clean presentational view).
    The interface promise: the view owns presentation state only — typing
    progress, the typing skip, and the one continue scheduler — all dialogue
    state and transitions arrive on the result object.

## Historical fork syntax

Fork-era extensions removed for parity (option `[if]` suffixes, inline
`{if}{else}{endif}` blocks, `&css{}`, bare `<<set>>` variables) are
documented with before/after examples in
[migration-notes.md](./migration-notes.md). The retired runtime vocabulary
(`YarnRunner`, `advance()`, `currentResult`, …) is reconciled with the
shipped API in [CONTEXT.md](../CONTEXT.md) under "Retired terms".

The old compatibility checklist this file replaces described long-fixed gaps
(`{if}` blocks, missing substitution, missing `<<declare>>`) as current and
is gone; per-feature documentation lives in the language docs under
[`docs/`](.), each citing its upstream source URL.

## Known issues

- A ternary expression (`a ? b : c`) in `<<declare>>`/`<<set>>` currently
  parses without a diagnostic but silently evaluates to nothing — the
  variable is left unset. Upstream has no ternary; the fix is a parser
  rejection with a YS0005 pointing at the `<<if>>` branch pattern, tracked
  for the next release (the language docs are already corrected). Branch
  with `<<if>>` instead.
- Conformance-harness note: the upstream testplan hashtags are parsed but
  not asserted — upstream's own assertion on them is dead code, and one
  upstream fixture's plan has a hashtag its own compiler cannot parse.
