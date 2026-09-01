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
| [40 syntax removals & strictness](issues/40-syntax-removals-strictness.md) | open | 23 |
| [41 enums end-to-end](issues/41-enums.md) | open | 23 |
| [42 smart variables end-to-end](issues/42-smart-variables.md) | open | 23 |
| [43 pull-based runtime API](issues/43-pull-based-runtime-api.md) | open | 23 |
| [44 instruction-stream program format](issues/44-instruction-stream-program.md) | open | 43 |
| [45 VM core](issues/45-vm-core.md) | open | 44 |
| [46 VM completion, tree IR retires](issues/46-vm-completion-tree-ir-retirement.md) | open | 45 |
| [47 saliency machinery](issues/47-saliency-machinery.md) | open | 46 |
| [48 markup runtime module](issues/48-markup-runtime-module.md) | open | 43 |
| [49 multi-file compile](issues/49-multi-file-compile.md) | open | 41, 46 |
| [50 line IDs + string table](issues/50-line-ids-string-table.md) | open | 49 |
| [51 CSV + tagLines + setLanguage](issues/51-csv-taglines-setlanguage.md) | open | 50 |
| [52 React adapter + demo](issues/52-react-adapter-demo.md) | open | 47, 48 |
| [53 rename + docs + 0.2.0](issues/53-rename-docs-release.md) | open | 52 |
| [30–33 phase buckets](issues/30-phase1-compiler-language-core.md) | superseded | — |

## Decisions so far

- Diagnostics channel landed (`src/compile/compileSource.ts` seam): collect by
  default, strict opt-in, vendored per-code registry. Node-structure validations
  live (YS0011/31/32/33, YS0012 warnings, YS0052, positioned YS0005); four
  ParseFailures allowlist entries fell. Exact-code emission for the remaining
  ~29 fixtures is owned by tickets 40–42 (phase-1 exit deletes the allowlist).

## Not yet specified

*(empty — the spec is complete; work proceeds down the ticket chain.)*
