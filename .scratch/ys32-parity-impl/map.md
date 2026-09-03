# Map: Yarn Spinner 3.2 parity — implementation effort

Label: wayfinder:map

## Destination

Implement the [spec](spec.md): full language + behavior parity with Yarn Spinner
3.2.2, shipped as one 0.2.0 breaking release. Decisions and research live in the
sibling wayfinding effort [`ys32-parity`](../ys32-parity/map.md); this effort owns
the spec and the implementation tickets.

## Notes

- **Working style**: claim a ticket (`Status: claimed`) before any work; one ticket
  per session unless trivially small. Every landed ticket cites its commit under
  `Landed in:`.
- **Acceptance harness**: the vendored upstream conformance corpus drives the
  compile → run pipeline; per-phase exit criteria live in the ticket chain below.
- **History**: implementation began before tickets existed (commits `a0fe16a`,
  `1f551e3`); the trail was backfilled as tickets 20–22. Ticket 23 (diagnostics
  channel) landed with the restructure of this effort. Tickets 30–33 were the
  original phase buckets, superseded by the vertical-slice decomposition.

## Tickets

| Ticket | Status | Blocked by |
|---|---|---|
| [20 conformance harness](issues/20-upstream-conformance-harness.md) | resolved | — |
| [21 parser/runtime conformance fixes](issues/21-parser-runtime-conformance-fixes.md) | resolved | — |
| [22 generated-variable state](issues/22-generated-variable-state.md) | resolved | — |
| [23 diagnostics channel](issues/23-diagnostics-channel.md) | resolved | — |
| [40 syntax removals & strictness](issues/40-syntax-removals-strictness.md) | resolved | 23 |
| [41 enums end-to-end](issues/41-enums.md) | resolved | 23 |
| [42 smart variables end-to-end](issues/42-smart-variables.md) | resolved | 23 |
| [43 pull-based runtime API](issues/43-pull-based-runtime-api.md) | resolved | 23 |
| [44 instruction-stream program format](issues/44-instruction-stream-program.md) | resolved | 43 |
| [45 VM core](issues/45-vm-core.md) | resolved | 44 |
| [46 VM completion, tree IR retires](issues/46-vm-completion-tree-ir-retirement.md) | resolved | 45 |
| [47 saliency machinery](issues/47-saliency-machinery.md) | resolved | 46 |
| [48 markup runtime module](issues/48-markup-runtime-module.md) | resolved | 43 |
| [49 multi-file compile](issues/49-multi-file-compile.md) | resolved | 41, 46 |
| [50 line IDs + string table](issues/50-line-ids-string-table.md) | resolved | 49 |
| [51 CSV + tagLines + setLanguage](issues/51-csv-taglines-setlanguage.md) | resolved | 50 |
| [52 React adapter + demo](issues/52-react-adapter-demo.md) | resolved | 47, 48 |
| [53 rename + docs + 0.2.0](issues/53-rename-docs-release.md) | resolved | 52 |
| [54 ParseFailures validation wave](issues/54-parse-failure-validations.md) | open | — |
| [30–33 phase buckets](issues/30-phase1-compiler-language-core.md) | superseded | — |

## Decisions so far

- Multi-stage spec-vs-impl review (2026-09-03) close-out: four spec gaps
  landed as review resolutions — pluggable variable storage (story 39),
  `<<call>>` host-function invocation (story 4, conformance assert() calls
  now real), built-in `<<wait>>` consumer-timed command pinned + documented
  (story 7), and `///` declaration comments surfacing as
  `VariableDeclaration.description` (story 47, upstream
  `Declaration.Description`). Recorded deliberate divergences (YS0041
  retry cap, tagLines abort demotions) added to compatibility.md; the 12
  remaining ParseFailures validations ticketed as 54.

- Ticket 53 (the 0.2.0 closing wave): `YarnRunner`/`useYarnRunner` renamed
  to `Dialogue`/`useDialogue` with deprecated exact aliases shipped for this
  release only (pinned by `deprecatedAliases.test.ts`); stale compatibility
  checklist replaced by `docs/compatibility.md`; the README ternary example
  deleted (a ternary parses but silently evaluates to nothing — upstream has
  none); upstream re-checked at release time — v3.2.2 still newest tag,
  recorded in the new CHANGELOG.md. Suite 461/461.

- Diagnostics channel landed (`src/compile/compileSource.ts` seam): collect by
  default, strict opt-in, vendored per-code registry. Node-structure validations
  live (YS0011/31/32/33, YS0012 warnings, YS0052, positioned YS0005); four
  ParseFailures allowlist entries fell. Exact-code emission for the remaining
  ~29 fixtures is owned by tickets 40–42 (phase-1 exit deletes the allowlist).
- Ticket 52: the React adapter needed no code migration (ticket 43 reshaped
  it); the demo (`examples/browser/`) is the acceptance harness — two tabs,
  Dialogue + a node-group storylet demo driving `Dialogue.setSaliencyStrategy`
  and the query APIs directly (no new adapter surface, per the ticket's
  migration-only rule). The story's per-strategy draw sequence is pinned in
  `src/tests/dialogue_view.test.tsx`, mirroring the demo's yarn. Hermetic-demo
  fixes: pinned empty `css.postcss` and a `browserslist` field so config
  searches never leave the repo root. 412/412.

## Not yet specified

*(empty — the spec is complete; work proceeds down the ticket chain.)*
