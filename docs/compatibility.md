# Compatibility

This library targets **behavioral parity with Yarn Spinner 3.2.2** — the
newest upstream tag (re-checked at the 0.2.0 release: no `v3.2.3` or `v3.3.0`
exists yet; upstream has announced a future 3.3 but not shipped it).

Parity here means the observable contract upstream's own test suite pins:

- The **conformance corpus** — `test/fixtures/upstream/YarnSpinner/Tests`,
  vendored byte-exact at upstream tag `v3.2.2` — drives the compile → run
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
    observable (ticket 49 notes).
  - The `.yarnproject` loader and the React adapter are this project's own
    surface (non-upstream).

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
