# Deepening wave 3 — VM/runtime locality, one-level-up grammar, the transcript family's missing member

Architecture review 2026-09-04 (HTML report in session temp
`/tmp/claude/architecture-review-20260904-103919.html`), grilling round settled
the design tree in-session. Four review candidates + the re-filed wave-2
ticket 10 + one test-only free win. All standalone tickets; no ADR conflicts;
no public-surface breaks.

## Tickets

| # | Ticket | Candidate | Status |
|---|--------|-----------|--------|
| 01 | [01-fallback-set-failure-signal.md](issues/01-fallback-set-failure-signal.md) | Ticket 10 re-filed: fallback `<<set>>` undefined-evaluation clobbers storage (result wrapper) | resolved |
| 02 | [02-bytecode-slice-runner.md](issues/02-bytecode-slice-runner.md) | One bytecode-slice runner inside the VM; op classes move beside their emitter | resolved |
| 03 | [03-command-kind-classification.md](issues/03-command-kind-classification.md) | One classification of internal `<<command>>` kinds (ticket 05's move, one level up) | resolved |
| 04 | [04-stateless-pull.md](issues/04-stateless-pull.md) | The transcript family's missing member: the stateless pull (`pullUntilStopped`) | resolved |
| 05 | [05-empty-compile-result.md](issues/05-empty-compile-result.md) | One empty `CompileResult` across the loader seam | resolved |
| 06 | [06-typecheck-direct-drive.md](issues/06-typecheck-direct-drive.md) | Drive `typeCheck()` directly — the checker gets its own test surface | resolved |

Frontier order = ticket number.

## Decisions-so-far

- **Grilling round (2026-09-04, all recommendations accepted)**:
  - Scope: candidates 1–4 + re-filed ticket 10 + the typeCheck() test ticket; nothing else re-opened (the Dialogue/VM/RuntimeDriver triple and the expression-scanner residue stay recorded-deliberate / ADR 0005-deferred).
  - Ticket 10's failure signal: a `{ok, value}` result wrapper in `evaluator.ts` beside `evaluateExpression` — NOT a throw contract change on `evaluateExpression` itself. Inline `{expr}` composition (`interpolate.ts:92`) verified to keep today's soft failure; wrapper consumers are the fallback set branch (pinned) and opportunistically `<<call>>`.
  - `runBytecode`: throws a typed error on foreign op (no options knob — the string evaluator stays out of the runner's interface); `LITERAL_OPS`/`INITIALIZER_OPS`/`STACK_PRODUCERS` move beside `expressionCodegen.ts` (the emitter declares what it may emit); module-tier export with its own test table, not package surface.
  - `commandKind`: one union `set | declare | call | setSaliency | stop | return | host` in `commands.ts`; `lowerCommand` and `runCommand` dispatch on it; per-kind policy tables stated in the module header; the compiler-treats-call-as-raw vs VM-treats-call-as-internal asymmetry becomes explicit.
  - `pullUntilStopped(dialogue) → { events, stopped }`: events-shaped, guards owned by the module (pending selection → `{events: [], stopped: "options"}`); accumulators rebuilt over it in the same ticket; `applyPull` deletes its hand-copied guard; public package surface; CONTEXT.md's stopping-point entry gains one clause.
  - Order: 10-first (behavior fix before the refactors it neighbours), then 02–06.

## Notes

- The wave-2 tracker was cleared in its own commit immediately before this map was created; ticket 10 (the wave-2 final reviewer pass's open file) is re-filed here as 01 with the same evidence and work item, updated for the settled design.
