# Wayfinder map: two-axis review follow-ups

Labels: wayfinder:map

## Destination

Every actionable finding from the 2026-09-04 three-effort two-axis review is resolved: the un-ticketed severity-consolidation cluster working in the tree has an owner and a record; the plugin's compile functions are importable from its published surface (the generic-loader contract becomes reachable); `client.d.ts` tells the truth about pinned `.yarn` imports; the thrice-deferred frame-source polish is implemented or explicitly closed; and the review's cheap judgement-call smells are fixed. Findings judged already-sanctioned (demo line-rendering triplication under the "just a demo" ruling; sanctioned narrow `diagnosticsSeverity` passthrough; historical planning-record citation drift) are recorded as declined, not worked.

## Notes

- Domain: yarn-spinner-runner-ts + its companion yarn-spinner-vite-plugin. Vocabulary from `CONTEXT.md` binding. Standards: `CODING_STANDARDS.md`.
- Source of findings: six reviewer reports (Standards/Spec × framework-agnostic-consumption, direct-import-implementation, drop-react-adapter), aggregated 2026-09-04 in session.
- The severity cluster (`applySeverityOverrides` in `src/compile/diagnostics.ts`, its use by `compileSource.ts` and `packages/vite-plugin/src/*`, removed `baseLanguage` default, async `asBuildError` with loc, new pins, `pluginHarness.lineTexts`) predates and is independent of drop-react-adapter — it appeared in the working tree before that effort started. It is code, not an accident: two reviewers independently found it fixes direct-import's duplication smell and serves the severity contract. Ticket 01 owns it.
- The drop-react-adapter effort's two hard §7 findings (ADR wording, `saliency.test.ts:575`) were fixed inline in-session before this map opened; recorded here for completeness only.
- One ticket resolved per session; research tickets exempt.
- Skills every session should consult: `grilling` (ticket 03's type-shape tradeoff if the union DX proves bad).

## Decisions so far

- [Human decision, pre-map]: "fix all" — every actionable review finding gets fixed, not just ticketed. Sanctioned declinations recorded per ticket.
- Ticket 01 — [Own the severity-consolidation cluster](issues/01-own-severity-cluster.md): the un-ticketed working-tree cluster is accepted as intentional work, recorded, and pinned by its existing tests. Status: resolved.
- Ticket 02 — [Reachable loader seam](issues/02-reachable-loader-seam.md): the compile functions are re-exported from the plugin package's main entry, so the documented webpack-loader contract can be consumed. Status: resolved.
- Ticket 03 — [Truthful pinned-import types](issues/03-truthful-pinned-import-types.md): `client.d.ts` no longer claims every `*.yarn` default is a bare `Program`. Status: resolved.
- Ticket 04 — [Frame-source polish](issues/04-frame-source-polish.md): pinned-import build errors quote the source their loc points into. Status: resolved.
- Ticket 05 — [Cheap smell sweep](issues/05-cheap-smell-sweep.md): the one-liner judgement calls across the review are fixed. Status: resolved.

## Not yet specified

(None — fog exhausted at assembly; every finding was already triaged by the review.)

## Out of scope

- The duplicated glob matcher consolidation (`packages/vite-plugin/src/index.ts` vs core `matchGlob`) — a real refactor with pattern-semantics risk, deliberately deferred; recorded as the one declined finding with a pointer.
- Demo line-rendering triplication — sanctioned by the "just a demo" ruling (demos are deliberately independent).
- Historical planning-record citation drift (framework-agnostic map → CONTEXT.md at `ead0d32`) — the citation is true of the current tree; history stays history.
