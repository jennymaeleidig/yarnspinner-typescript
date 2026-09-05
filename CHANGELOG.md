# Changelog

## Unreleased

- Renamed the project from `yarn-spinner-runner-ts` to `yarnspinner-typescript`.
  The package is no longer positioned as a fork of
  [oleksii-chekhovskyi/yarn-spinner-runner-ts](https://github.com/oleksii-chekhovskyi/yarn-spinner-runner-ts)
  — the original is now cited as inspiration in [`CITATION.cff`](./CITATION.cff).
  All import specifiers (`"yarnspinner-typescript"`, `"yarnspinner-typescript/node"`)
  and the repo-root `yarnspinner-typescript.yarnproject` carry the new name.

## 0.2.0 — Yarn Spinner 3.2 parity

The 3.2 parity release: full language + behavior parity with **Yarn Spinner
3.2.2**, shipped as one breaking wave — all breaking changes land together in
this release, with no staged breaking-change windows (the one rename carries
a one-release deprecated alias, below).

**Targeted upstream version: 3.2.2** — re-checked at release time against the
upstream tag list (`YarnSpinnerTool/YarnSpinner`): `v3.2.2` is the newest tag;
no `v3.2.3` or `v3.3.0` exists yet (a future 3.3 has been announced upstream
but not shipped). The vendored conformance corpus is pinned at `v3.2.2`.

### Breaking: rename with one-release deprecated alias

- **`YarnRunner` → `Dialogue`**: the glossary concept is
  upstream's `Dialogue`; "runner" is retired vocabulary. The old name remains
  as an exact, deprecated alias in 0.2.0 only.

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
- The ParseFailures validation wave: every vendored upstream
  must-fail fixture now fails compilation with its exact upstream YS-code
  (verified against the upstream v3.2.2 compiler) — newline-in-command and
  missing `<<declare>>`/`<<set>>` values (YS0006/YS0005), indented
  whitespace-only lines after options (YS0005), expression-less `when:`
  headers (YS0005), jump-target string typing, `+`-operand and assignment
  type conflicts (YS0050), and function/variable type inference
  (YS0029/YS0014). `MUST_FAIL_ALLOWLIST` is gone. Implicit functions infer
  return type and arity from their first typed use (upstream's solver);
  concrete operands pin unknown variables through operators.

### React adapter

The React adapter (`useYarnRunner`/`useDialogue`, view components) was removed
entirely before this release shipped (ADR 0006, amended); see
[docs/migration-notes.md](docs/migration-notes.md).

### Docs

- The stale compatibility checklist is replaced by
  [docs/compatibility.md](docs/compatibility.md) (parity statement +
  recorded divergences).
- The nonexistent-ternary example is deleted from the README — upstream Yarn
  Spinner has no ternary operator, and this library never evaluates one
  (branch with `<<if>>`).
- Removed extensions are documented as migration notes with before/after
  examples; retired terms are reconciled with shipped names in CONTEXT.md.
