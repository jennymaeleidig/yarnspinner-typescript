# Two glob matchers, one concept — recorded deferred

Type: task
Status: resolved

## Question

`src/compile/yarnProject.ts:172–221` (matchGlob, root-anchored, hand-rolled
backtracker) and `packages/vite-plugin/src/index.ts:61–99` (matchesFilter,
unanchored, regex-per-segment) each re-derive the `**`-spans-segments /
`*`-`?`-within-one concept (~50 lines each, divergent engines). a0d82d8's
follow-ups map declined consolidation — correctly: the semantics genuinely
differ (anchoring, RegExp passthrough, array OR-ing).

## Answer (recorded deferred, 2026-09-04)

The decline stands for a naive merge; this wave defers rather than re-litigates.
A deep module could encode the difference — one pure matcher in core
(no I/O, coding standards §2), `matchPath(path, pattern, { anchored })` with
anchoring as the single semantic option, the plugin's RegExp passthrough and
array OR-ing staying at its call site as filter policy.

**Reopening condition** (the ADR 0005 pattern): a third consumer appears —
the `.ysls` include/exclude surface, or a CLI `list-sources` filter. Until
then the cost of one more matcher copy does not cross the line.

No code changed. Suite green.