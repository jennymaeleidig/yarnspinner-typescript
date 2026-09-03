# Changelog

## 0.2.0 — Yarn Spinner 3.2 parity

The 3.2 parity release: full language + behavior parity with **Yarn Spinner
3.2.2**, shipped as one breaking wave — all breaking changes land together in
this release, with no staged deprecation windows.

**Targeted upstream version: 3.2.2** — re-checked at release time against the
upstream tag list (`YarnSpinnerTool/YarnSpinner`): `v3.2.2` is the newest tag;
no `v3.2.3` or `v3.3.0` exists yet (a future 3.3 has been announced upstream
but not shipped). The vendored conformance corpus is pinned at `v3.2.2`.

### Breaking: renames with one-release deprecated aliases

- **`YarnRunner` → `Dialogue`** (ticket 17): the glossary concept is
  upstream's `Dialogue`; "runner" is retired vocabulary. The old name remains
  as an exact, deprecated alias in 0.2.0 only.
- **`useYarnRunner` → `useDialogue`** (and the `UseYarnRunnerOptions` /
  `UseYarnRunnerResult` types): same alias policy.

See [docs/migration-notes.md](docs/migration-notes.md) — which now also
covers these renames — and CONTEXT.md "Retired terms".

### Breaking: language alignment (already landed across the parity wave)

- Removed fork syntax: option `[if expr]` suffixes, inline
  `{if}{else}{endif}` text blocks, `&css{...}`, and bare (non-`$`-prefixed)
  variables in `<<set>>`/`<<declare>>` — each now a `YS0005` diagnostic with
  a message pointing at the migration notes.
- The compiler emits an instruction-stream program (this project's own
  versioned JSON, ADR 0001/0003); the tree IR is retired. Not bytecode- or
  artifact-compatible with upstream's protobuf — behavior is the contract.
- Runtime API is pull-based (`continue()` → `DialogueEvent[]`,
  `selectOption()`, `setNode()`, `stop()`); the mutate-and-read surface
  (`advance()`, `currentResult`, `TextResult`, …) was removed.
- Enums, smart variables, markup-at-runtime, multi-file `compile()`,
  implicit/explicit line IDs + the upstream 8-column strings CSV, saliency
  machinery, and the `.yarnproject` loader all landed per the parity spec.

### React adapter

- The newer `DialogueOptions` reach React consumers: `useDialogue` (and
  `<DialogueView>`) now take `variableStorage` (the persistence seam),
  `textProvider` (localisation), the opt-in `lineHints` flag, and
  `logError`/`logDebug` diagnostics. Passthrough only, with per-option
  rebuild-on-change behaviour documented on the option types: storage and
  provider identity rebuild the dialogue; `lineHints` rebuilds on flip;
  the diagnostics callbacks are construction-time (changing them is
  ignored). Language switching stays on `Dialogue.setLanguage`, reached
  through the hook result's `dialogue` escape hatch (no rebuild needed).

### Docs

- The stale compatibility checklist is replaced by
  [docs/compatibility.md](docs/compatibility.md) (parity statement +
  recorded divergences).
- The nonexistent-ternary example is deleted from the README — upstream Yarn
  Spinner has no ternary operator, and this library never evaluates one
  (branch with `<<if>>`).
- Removed extensions are documented as migration notes with before/after
  examples; retired terms are reconciled with shipped names in CONTEXT.md.
