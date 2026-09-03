# Map: Deepening wave — architecture-review candidates

Label: wayfinder:map

## Destination

Land the eight deepening candidates from the 2026-09-03 architecture review
(report: `/tmp/claude/architecture-review-2026-09-03.html`) as an ordered
ticket wave: collapse the continue-loop duplication, let `Dialogue` answer
its own state, delete dead adapter state, reshape the hook's interface,
single-source the adapter prop surface, re-home the scene system, fold
localisation into `loadProject`, and retire `compileDocument` from the
public surface.

**Guiding criterion (user decision):** upstream alignment in a clear,
repeatable way — behavioural parity with Yarn Spinner 3.2.2 is the contract;
anything added beyond it is either a *recorded* deliberate divergence
(`docs/compatibility.md`) or marked adapter-side/non-upstream
(CONTEXT.md glossary), never silent drift.

Independent of any release train; 0.2.0 was never tagged or published
(verified: no git tags), so hard breaking changes are acceptable without
deprecation aliases — the one-release alias machinery from tickets 55/56
stays as-is and nothing here extends it.

## Tickets

| Ticket | Status | Blocked by |
|---|---|---|
| [01 demo compiles through the public seam](issues/01-demo-public-compile.md) | resolved | — |
| [02 Dialogue state queries + mirror collapse](issues/02-dialogue-state-queries.md) | open | — |
| [03 event-reduction module (Transcript)](issues/03-event-reduction.md) | open | 02 |
| [04 dead state out, one continue scheduler](issues/04-continue-scheduler.md) | open | 03 |
| [05 useDialogue config/live split](issues/05-hook-config-live-split.md) | open | 04 |
| [06 single-source the view props](issues/06-view-props-extends.md) | open | 05 |
| [07 scene on NodeStartEvent; js-yaml leaves](issues/07-scene-node-start.md) | open | 04 |
| [08 localisation folded into loadProject](issues/08-loader-localisations.md) | open | — |
| [09 compileDocument demoted to internal](issues/09-compile-document-internal.md) | open | 01 |

## Decisions so far

From the grilling session (2026-09-03), binding on every ticket:

- **Wave order over parallelism**: tickets share files (`useDialogue.tsx` is
  in four of them); the blocking chain encodes the order. 08 is the only
  freely parallel lane.
- **Divergence policy**: runtime-surface additions upstream lacks are *added
  and recorded* in `docs/compatibility.md`'s deliberate-divergences list —
  the parity contract is event-stream behaviour, not class surface (ADR-0002
  precedent: API shape may follow the Rust port). Preference: mirror the
  Rust reference's naming where it has an answer.
- **Q10 semantics**: `isComplete` = a `DialogueComplete` event has been
  delivered; `stop()` makes the dialogue inactive but NOT complete;
  `awaitingSelection` is `false` before the first `continue()`.
- **Q11**: the four consumer state-mirrors collapse in ticket 02's own
  ticket, not deferred — one adapter = hypothetical seam.
- **Q12**: hosts adopt the shared `Transcript` type as component state; no
  per-host reshape layers.
- **Q13**: the reduction module stays a pure pull→transcript function; the
  SSR "create + first pull during render" idiom stays per-framework — two
  different seams, don't fuse.
- **Q14**: `useDialogue(program, config, live)`; config identity = dialogue
  identity; `variables` stays in `config` (identity-compared; it seeds —
  changing it means a new dialogue, same as today); `live` is read through a
  ref, identity ignored.
- **Q4**: `isDialogueEnd` is deleted outright, no deprecation cycle — the
  alias policy covered renames, not unimplementable state (it was only ever
  `false`).
- **Q8**: localisation is always-on in `loadProject` when the project
  declares locales — no opt-in flag, no union return, no sibling function;
  `ProjectLocalisation` stays exported as the custom-provider hatch.
- **Q5**: hard breaks, no aliases (0.2.0 unpublished — verified).
- Ticket 01 (demo port) deliberately lands first: one-line-scale change that
  deletes the package's own anti-pattern today.
- [01 demo compiles through the public seam](issues/01-demo-public-compile.md):
  ported; the seam's type-check pass (which `compileDocument` skips) makes
  runtime-seeded variables YS0029 errors unless declared via
  `declarations.variables` — the demo now teaches that host pattern.

## Notes

Adjacent state captured for background — none of this is wave scope;
recorded here so future explorers don't re-derive or re-suggest it:

- **Ternary operator**: silently mis-compiles instead of diagnosing —
  `<<declare $x = true ? "A" : "B">>` parses clean (no YS0005) but
  evaluates to nothing (variable unset). Found during ticket 53's docs
  pass; behavior changes were out of scope for a release-prep ticket.
  Fix = parser rejection with a YS0005 pointing at the `<<if>>` branch
  pattern (docs already corrected; upstream has no ternary).
  Also in `docs/compatibility.md` Known issues.
- **~~ParseFailures validation wave~~**: landed 2026-09-03
  (ys32-parity-impl ticket 54) — every vendored must-fail fixture fails
  with its upstream code and `MUST_FAIL_ALLOWLIST` is empty;
  newline-in-command (YS0006), declare/set value checks (YS0006/YS0005),
  indentation, `when:` header expression, jump-target string typing,
  operator/assignment typing (YS0050), and function/variable type
  inference (YS0029/YS0014/YS0050); codes verified against the upstream
  v3.2.2 compiler itself. The two parity-completeness items (bare
  `<<call>>`, trailing `///` after a declaration) landed in the same
  wave. Listed here only to close the loop.
- **Pluggable variable storage + `<<call>>` + `<<wait>>` + `///`
  declaration comments**: landed 2026-09-03 as spec-vs-impl review
  resolutions (stories 39/4/7/47) — listed here only to close the loop;
  see `docs/compatibility.md` and the ys32-parity-impl tracker map entry
  for the wave.

## Fog

- **RESOLVED — Upstream Dialogue state-query surface** (researched
  2026-09-03, findings appended to ticket 02): the Rust reference exposes
  `is_waiting_for_option_selection()` (rust `crates/runtime/src/dialogue.rs:511`)
  and `can_continue()`; .NET 3.x exposes only `IsActive` — both are
  explicit absences for completion (no `IsComplete`/`is_complete` anywhere
  in .NET `Dialogue.cs` or the Rust runtime crate; completion is
  push-only upstream). `Continue()`-while-pending fails loudly in BOTH
  upstreams (.NET throws `DialogueException`, VirtualMachine.cs:537–540;
  Rust returns `Err(ContinueOnOptionSelectionError)`, virtual_machine.rs:214–224)
  — this fork's log-and-empty-batch is therefore a *divergence*, not
  upstream behaviour as assumed in the earlier grilling round.
  Consequences, all landing in ticket 02: getter names mirror Rust
  (`isWaitingForOptionSelection`); `isComplete` ships as a recorded
  project extension; the `continue()` error mode stays per coding
  standards §3 (no throw crosses the seam) and is recorded in
  `compatibility.md` alongside the tagLines/line-ID precedents.
