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
| [02 Dialogue state queries + mirror collapse](issues/02-dialogue-state-queries.md) | resolved | — |
| [03 event-reduction module (Transcript)](issues/03-event-reduction.md) | resolved | 02 |
| [04 dead state out, one continue scheduler](issues/04-continue-scheduler.md) | resolved | 03 |
| [05 useDialogue config/live split](issues/05-hook-config-live-split.md) | resolved | 04 |
| [06 single-source the view props](issues/06-view-props-extends.md) | resolved | 05 |
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
- [02 Dialogue state queries + mirror collapse](issues/02-dialogue-state-queries.md):
  `isWaitingForOptionSelection` + `isComplete` landed on `Dialogue`;
  `isComplete` tracks *delivery*, not the VM's completed flag (stop() must
  not complete) and resets on `setNode`; hook's `awaitingSelectionRef` and
  both hosts' `ended`-scans deleted for getter reads; both
  compatibility.md entries recorded.
- [03 event-reduction module (Transcript)](issues/03-event-reduction.md):
  `runUntilStopped(dialogue, prior)` → `{ transcript, stopped }` landed in
  `src/runtime/transcript.ts` — one home for the stopping-point contract;
  hook/hosts/demo/test-helpers are thin adapters (the StoryletsDemo
  empty-batch-≠-over bug died with its copy); new edge recorded: a resolved
  option set leaves the transcript on the next pull; module recorded in
  compatibility.md as non-upstream orchestration; glossary gained
  Transcript + stopping point.
- [04 dead state out, one continue scheduler](issues/04-continue-scheduler.md):
  `isDialogueEnd` deleted outright (field, always-`false` write, four view
  branches, dead CSS rule) — end-ness is `result === null`; DialogueView's
  three `setTimeout` paths folded into one `scheduleContinue(cause)`
  (command 50ms / typing-done / click-pause), scheduling replacing any
  pending timer, with a single view-state-keyed invalidation effect; the
  typing-done guard became the result identity (`typingDoneFor`) to kill a
  stale-completion spurious skip the old per-effect cleanups had absorbed;
  timing tests rewritten on a fake clock (`t.mock.timers` + shared
  `clientDomHarness.ts`) — all widened margins gone.
- [05 useDialogue config/live split](issues/05-hook-config-live-split.md):
  `useDialogue(program, config, live)` — one rule, config identity =
  dialogue identity; the rebuild matrix (incl. `haveFunctionsChanged`'s
  deep compare and `haveVariablesChanged`'s double stringify) deleted;
  new `UseDialogueLive` holds callbacks/logging, read through a ref with
  construction-time trampolines (the frozen-`logError` trap — and the
  stale-`optionsRef` callback read — gone); `DialogueView` memoizes its
  config and passes a fresh live literal; alias machinery untouched by
  keeping `UseDialogueOptions` as the config type; new pins: config
  identity rebuilds (identical values included), live is always current.
- [06 single-source the view props](issues/06-view-props-extends.md):
  `DialogueViewProps extends UseDialogueOptions, UseDialogueLive` and
  `UseDialogueOptions extends Omit<DialogueOptions, ...>` — one declaration
  per runtime option across all three layers, pinned by type-level
  assignments; hook construction spreads the config (new runtime options
  forward without per-field code); `contentSaliencyStrategy` reaches React
  hosts for the first time; the hook's manual variables loop deleted (the
  VM constructor seeds — `$`-prefixed keys now normalize); view prop
  `startNode` renamed to the inherited `startAt` (hard break); headless
  split deferred to `future-work.md` per the binding.

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
- **`tmp-react-vars.mjs`** (repo root, tracked in git): pre-parity scratch
  already importing retired API (`dist/runtime/runner.js`,
  `currentResult`, `advance()`, `res.isDialogueEnd`) — cannot run against
  any recent build. Delete or gitignore in a housekeeping pass (surfaced
  by ticket 04's `isDialogueEnd` sweep; left untouched as out of scope).

## Fog

None — the upstream state-query research graduated into [02 Dialogue state
queries + mirror collapse](issues/02-dialogue-state-queries.md) and landed
with it (2026-09-03); its findings live in that ticket's Comments.
