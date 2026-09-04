# Deepening wave 4

Architecture-review outcomes (2026-09-04 review, working tree at `a0d82d8`).
All tickets are refactor/deepening work surfaced by the architecture review;
ticket 02 and ticket 04 carry small behavior changes, each standalone with its
own pin per the repo's standalone-fixes rule (ADR 0005 ticket-03 precedent).

## Notes

- `RuntimeDriver` (src/runtime/events.ts) is a 22-member interface with one
  implementation (`VirtualMachine`) and one consumer (`Dialogue`), zero test
  uses, and is not package surface (src/index.ts never re-exports
  `runtime/events.js`). The deletion test: deleting it makes zero complexity
  reappear.
- Severity precedence has two implementations: `loadProject`
  (src/compile/yarnProject.ts) composes `??` (replace-wholesale) while
  `compileYarnProjectModule` (packages/vite-plugin/src) merges per-code and
  re-applies a compensating final pass. The plugin's pass exists only because
  `loadProject`'s `??` cannot express the documented merge.
- `compile()`'s four mode exits each hand-copy `applySeverityOverrides` →
  strict-throw → shape (ticket 03 of the direct-import effort already shipped
  one bug of exactly this class: an exit path skipping the override pass).
- The plugin's `load` hook: `fileReadError` shaping holds only on the project
  branch; an unreadable standalone `.yarn` escapes as a raw ENOENT.
- Two glob matchers (core root-anchored backtracker, plugin unanchored
  regex-per-segment) share the `**`/`*`/`?` concept. a0d82d8's follow-ups map
  declined consolidation; this wave records it deferred with a reopening
  condition instead of re-litigating.

## Decisions so far

- 2026-09-04: delete `RuntimeDriver` outright; `Dialogue.engine` is typed
  `VirtualMachine`. Folded candidate 6: the Virtual machine owns
  `textProvider`/`logError` defaults and the `setLanguage` null-provider
  guard; `Dialogue` forwards. Public surface unchanged (ADR 0002 holds).
- 2026-09-04: severity precedence gets one implementation — `loadProject`
  composes `{...projectMap, ...opts.diagnosticsSeverity}` (per-code, host
  wins) and applies once; the plugin passes opts through and deletes its
  merge + final re-pass. Behavior change to `loadProject` host options;
  standalone ticket with its own precedence pin.
- 2026-09-04: one `finalize(extra)` above `compile()`'s mode ladder — pure
  refactor, interface unchanged.
- 2026-09-04: plugin read-error shaping is a behavior change (ticket 04) and
  the `loadAndCompile` plumbing collapse is a separate refactor (ticket 05);
  the bundler-neutral compile steps stay untouched (ADR 0006).
- 2026-09-04: glob-matcher consolidation recorded deferred (ticket 06) —
  reopening when a third consumer appears (the `.ysls` include/exclude
  surface, or a CLI `list-sources` filter).

## Fog

Two-axis review (2026-09-04, a0d82d8...HEAD): Standards axis 0 hard
violations / 7 met — judgement calls only, of which the Middle Man flag on
Dialogue's facade stubs is sanctioned by the glossary + ADR 0002, the
project-text double read predates the wave, and the setLanguage message nit
is verbatim-by-design. Spec axis 12 met / 2 partial (both ticket 05, cosmetic
and recorded on the ticket) / 0 missing / 0 creep — both promised pins
verified to discriminate against pre-wave code. The one actionable finding
(the duplicated warn/emit tail) fixed in the review-fixes commit.