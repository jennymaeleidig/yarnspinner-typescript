# Contradiction deep-eval — yarn-spinner-runner-ts (2026-09-04)

**RESOLVED 2026-09-04 (same day):** all doc/comment findings below were fixed
(H1–H6, M1–M3, L1–L23), and three upstream-parity gaps were closed with
deliberate functional changes (see "Parity fixes applied" at the bottom).
Suite: 638/638 pass, lint clean.

Read-only audit. Six parallel sweeps: docs reference pages vs src/, ADRs + CONTEXT.md vs
code, packaging docs vs build reality, compiler-side comments, runtime-side comments,
cross-document consistency. Nothing was modified. Functional behavior untouched.

## Summary

- 32 distinct contradictions (deduplicated across agents; the CHANGELOG/React finding was
  independently hit by 3 agents).
- 6 high, 3 medium, 23 low.
- Also: 2 open decision points that are code gaps (not doc-fixable), listed at the end.

## High (actively misleading)

### H1. CHANGELOG advertises the React adapter as shipped; it was deleted
- `CHANGELOG.md:19–20` — "`useYarnRunner` → `useDialogue` … same alias policy";
  `CHANGELOG.md:51–63` — "### React adapter … `useDialogue` (and `<DialogueView>`) now
  take `variableStorage`, `textProvider` …" (present tense).
- vs `CONTEXT.md:128–131` ("gone entirely", ADR 0006 amended), `docs/migration-notes.md:104–112`,
  `src/tests/index.test.ts:35` (asserts `useDialogue` NOT in package), `src/tests/deprecatedAliases.test.ts:11`.
- Right: code + CONTEXT. No `useDialogue`/`DialogueView` exists.
- Fix: delete the React-adapter section and the useYarnRunner bullet from CHANGELOG 0.2.0;
  replace with one line: "the React adapter was removed entirely in this release (ADR 0006, amended)".

### H2. `continue()` JSDoc contradicts stop() delivery semantics
- `src/runtime/dialogue.ts:123`, `src/runtime/vm.ts:264` — "Returns no events when the
  dialogue is not active."
- vs code: after `stop()`, `vm.ts:276–286` drains and returns the queued `dialogueComplete`
  on the next `continue()`. The `isComplete`/`stop()` docs (`dialogue.ts:107–158`) state this correctly.
- Fix: "…Returns no events when the dialogue is not active, except a queued
  `dialogueComplete` (stop() delivers it on this call — see `isComplete`)."

### H3. docs/saliency.md documents the wrong once-state storage key
- `docs/saliency.md:67` — "`Yarn.Internal.Once.<contentID>`" (dot).
- vs `src/runtime/generatedVariables.ts:23` — `` `${prefix}Once:${id}` `` (colon);
  confirmed `src/tests/bytecode.test.ts:333`.
- Hosts building persistence on the documented key format would fail to save/restore once-state.
- Fix: doc → `Yarn.Internal.Once:<contentID>`. Separately: the colon vs upstream's dot
  (upstream `$Yarn.Internal.Once.{id}`, `Library.cs:225`) is an unrecorded divergence —
  needs a rule-1 note (docs/compatibility.md is the natural home).

### H4. YS0027 comment claims per-character diagnostics; code and upstream are first-match
- `src/compile/compileSource.ts:373–376` — "one diagnostic per invalid character, as
  upstream's per-character validation reports."
- Code: `[...value].find(...)` → first invalid char only, one diagnostic per title/subtitle.
  Upstream `Compiler.cs AddErrorsForInvalidNodeNames` is also single-match.
- Fix: "— one diagnostic per title/subtitle, for the first invalid character
  (upstream's first-match validation)."

### H5. Lowering `#lastline` scan claims "behavioral parity"; rule contradicts the string-table pass
- `src/compile/compiler.ts:558–570` — backward scan skips `runCommand`s
  (`if (ins.op !== "runCommand") break` — i.e. commands are skipped over).
- vs `stringTable.ts` `flagLastLines`: only the *immediately* preceding statement flags,
  matching upstream `LastLineBeforeOptionsVisitor`. Two passes, contradictory adjacency
  rules; the lowering's "parity" comment is false either way.
- Fix (comment-level): rewrite the lowering comment to state its actual rule honestly
  ("scans back over intervening commands; deliberately looser than the string table's
  immediately-preceding rule"). If the *behavior* should match the string table instead,
  that's a functional change — needs a decision first.

### H6. `parseCommand` bare-throws on the public API with no documented contract
- `src/runtime/commands.ts:70–77,127` — `throw new Error("Empty command")` / "No command
  name found"; exported via `src/index.ts:23`. Every other throwing export documents its
  throw; CODING_STANDARDS §3 says no bare throw crosses the public API unacknowledged.
- Fix (comment-level): JSDoc — "Throws on an empty/malformed command — internal parsing
  utility; the VM converts this to a runtime diagnostic (`logError`)."

## Medium

### M1. docs/scenes-actors-setup.md documents the removed built-in renderer as current behavior
- `docs/scenes-actors-setup.md:109–118,189` — actor placement ("top center"), speaking-only
  appearance, built-in case-insensitive matching.
- vs `docs/scenes.md:21–24` and CONTEXT.md: package ships no scene parser; hosts own all
  rendering and matching.
- Fix: recast the Actor Display section as a suggested host convention (or delete, as scenes.md does).

### M2. Ephemeral tracker-ticket citations — banned by rule 7, all dangling (.scratch/ is empty)
- `CHANGELOG.md:16,40` (tickets 17, 54); `docs/adr/0005-…md:3,20,31,55,76,86–88` (tickets 08,
  03, 09, `09-evaluator-mixed-precedence.md`); `src/runtime/interpolate.ts:173` (07);
  `src/runtime/evaluator.ts:128,32` (09, "standards review"); `src/runtime/operands.ts:9` (03–04);
  `src/model/walk.ts:10` (06); `src/parse/stateStatement.ts:10` (05).
- Fix: strip ticket numbers; where provenance matters, cite ADR 0005 (which records
  tickets 03/08/09's substance) or fold the one-line record in. Ticket 07 (span scanner)
  is recorded nowhere living — either add a line to ADR 0005 or drop the citation.

### M3. CHANGELOG self-tension: "no staged deprecation windows" vs the one-release alias two lines later
- `CHANGELOG.md:7` vs `CHANGELOG.md:12–13`.
- Fix: "no staged *breaking-change* windows (the renames carry a one-release deprecated
  alias, below)."

## Low

### Docs / packaging
- L1. `docs/adr/0006-…md:12` — "All published exports carry dual ESM/CJS conditions" is
  false for the companion plugin (ESM-only by design; `packages/vite-plugin/dist` has no CJS).
  Scope the sentence to the root package, or record the plugin exception.
- L2. `docs/adr/0006-…md:21–22` — react is "the examples' own tooling"'s dev dep; actually
  root `package.json` devDependencies (examples have no package.json).
- L3. `docs/adr/0002-…md:7` — "the React hook migrates to the event stream": superseded by
  ADR 0006's amendment (hook deleted). Add a superseded-note like 0005's style.
- L4. `docs/adr/0004-…md:14` — `onStoryEnd` cited in present tense (retired term) →
  "the `DialogueComplete` event payload".
- L5. `README.md:387` — tree lists nonexistent `examples/scenes/`; omits `examples/content/`
  (where the demo content lives). Also tree root label says `yarn-spinner/`.
- L6. `README.md:200` — `.vscode/extensions.json` called "git-ignored"; it's whitelisted
  in `.gitignore:27–29` and tracked.
- L7. `README.md:152–153,175–176` — "the app's own authored content" for the Next.js and
  SvelteKit hosts; actually the shared `examples/content/` Wayside project (host READMEs
  and code agree).
- L8. `docs/agents/issue-tracker.md:10` — references `triage-labels.md`, which doesn't exist.
  Inline the role strings or add the file.
- L9. `docs/once.md:3` — citation URL 404s (`…fundamentalsendonce`); should be
  `…/scripting-fundamentals/once`.
- L10. `docs/lines-nodes-and-options.md:9` — "titles start with a letter" is NOT enforced
  (YS0027 checks `[A-Za-z0-9_]` only; upstream's lexer enforces `IDENTIFIER_HEAD`). See
  decision point D1.
- L11. `docs/markup.md:17–18` — "child attribute" implies a children field;
  `MarkupAttribute` (`src/markup/types.ts:57–72`) has none — hierarchy is range-nesting only.
- L12. `docs/logic-and-variables.md:44–46` — unset-variable defaults labeled "a deliberate
  adaptation"; `src/runtime/operands.ts:58–80` comments the same behavior as upstream-matching.
  Same behavior, contradicting provenance labels — verify upstream once, align both.

### Code comments
- L13. `src/runtime/dialogue.ts:213–215` — `setSaliencyStrategy` mode list: wrong vocabulary
  (harness spellings presented as `<<set_saliency>>` modes) and omits the default
  `random_best_least_recent` (plus `random`, `best_least_recent`).
- L14. `src/runtime/events.ts:70–74` — `NodeStartEvent.scene` "Absent when the node has no
  header" → should be "no `scene:` header" (CONTEXT.md states it correctly).
- L15. `src/runtime/vm.ts:34–36` — header says `operands.ts` is "also home to the string
  evaluator's copies"; post-refactor there are no copies (shared `applyBinaryOp`/`applyUnaryOp`).
- L16. `src/runtime/transcript.ts:8,122,190` — cites the retired React adapter/hook as a
  standing consumer (3 sites).
- L17. `src/runtime/interpolate.ts:224–233` — orphaned duplicate `expandSubstitutions`
  JSDoc attached to `unescapeBraces`, with a stale tail.
- L18. `packages/vite-plugin/src/index.ts:6` — dangling sentence: "Content edits … full-reload
  in dev:" (colon, no continuation).
- L19. `src/runtime/events.ts:73` — "adapter-side" → "host-side" (retired vocabulary).
- L20. `src/compile/expressionCodegen.ts:8–9` — header lists `or` → `and` as separate
  layers; `parseOr` implements or/and/xor as one upstream level (`ExpAndOrXor`).
- L21. `src/compile/tagLines.ts:15` — "upstream `RandomLineTagger`" → `RandomLineTagGenerator`.
- L22. `src/parse/parser.ts:864` — open design question ("skip or break?") in shipped code;
  the code answers (break). State the rule.
- L23. `src/compile/compiler.ts:14`, `src/compile/program.ts:15` — "(upstream's compiler/runtime
  split)" mislabels the deferred inline-expression design, which is a recorded divergence
  (upstream's compiler DOES emit inline-expression bytecode; ADR 0005 records the deferral).

## Open decision points (code gaps — not doc-fixable)

- D1. Leading title character (letter/underscore) is not enforced — upstream's lexer uses
  `IDENTIFIER_HEAD`. Doc currently describes upstream behavior the port lacks. Either add
  the YS0027 leading-character check (functional change) or note the gap in the docs page.
- D2. Colon-vs-dot once-state key divergence from upstream (H3) — currently unrecorded.
  Record it (docs/compatibility.md) as a deliberate divergence, or change the key format
  (functional change with persistence-migration implications).

## Positively verified clean (highlights)

- CONTEXT.md glossary: every API name, behavior claim, and retired-term claim checked out —
  no self-contradictions. `YarnRunner` alias exactly matches the documented 0.2.0 window.
- All sampled YS#### codes match the vendored 3.2.2 registry 1:1; `DIAGNOSTIC_REGISTRY`
  matches file names.
- Exports maps ↔ dist output layout verified byte-for-byte (root and plugin).
- Severity-override merge order identical in all four documents that state it.
- Direct-import import shapes, option names, and error shapes match plugin code exactly.
- No I/O in the library; no module-level mutable state; all other throw sites documented;
  tests only through public seams.
- CITATION.cff / LICENSE / submodule pin (`v3.2.2` @ `5b3a4ff2`) all consistent.
- 16 of 17 docs reference pages fully consistent apart from the findings above.

## Observation (not a contradiction)

- README's Installation section covers clone-and-build only; never shows
  `npm install yarn-spinner-runner-ts` although the package is published.
- `docs/shadow-lines.md` is notably thinner than sibling pages (no implementation-notes section).

## Parity fixes applied (2026-09-04, by user direction: "match upstream")

Three divergences turned out to be unintentional drift (no recorded decision,
no ADR, commit history shows no rationale) and were closed functionally:

1. **Once-state key separator (was D2/H3):** `onceVariableKey` emitted
   `Yarn.Internal.Once:<id>` where upstream generates
   `$Yarn.Internal.Once.{id}` (Library.cs:225) — and where this file's own
   JSDoc and the sibling `Content.ViewCount.` key already used dots.
   Fixed to `Yarn.Internal.Once.<id>`; `visitCountVariableKey` colon → dot
   for internal consistency (upstream's nearest analog
   `$Yarn.Internal.Visiting.{node}` is an unused helper; visit tracking is
   our recorded extension). The `$` sigil stays normalized away — the
   storage seam strips `$` from every variable (vm.ts/evaluator.ts), now
   documented in docs/compatibility.md.
2. **Title leading character (was D1):** upstream's grammar lexes titles as
   ID (`IDENTIFIER_HEAD`: letter/underscore); a digit-leading title fails at
   upstream's lexer. Our YS0027 pass accepted any [A-Za-z0-9_] body. Fixed:
   titles must start with [A-Za-z_], subtitles reject a leading digit
   (upstream's invalidTitleCharacters `^[0-9]` arm). Upstream's extended
   Unicode ID ranges remain a recorded simplification
   (docs/compatibility.md).
3. **Lowering #lastline adjacency (was H5):** the lowering's backward scan
   skipped intervening `runCommand`s (and would tag a line inside a
   preceding `<<once>>` block), where upstream's
   LastLineBeforeOptionsVisitor requires the statement IMMEDIATELY before
   the options block to be a line and never descends into once blocks.
   Rewrote the scan as statement-level adjacency tracking, including the
   once-block non-descent — now agreeing with the string-table pass
   (stringTable.ts flagLastLines), which already implemented upstream's
   rule. Two golden tests pin the corrected lowering; two diagnostics tests
   pin the title rule.

Recorded (deliberate) divergences were NOT touched: pull-based API,
option-pending diagnostic instead of throw, stop() complete-event delivery,
program observable on error, deferred inline expressions (ADR 0005),
`Title.Subtitle` member IDs, ASCII-only identifier set, `$` normalization,
unset-variable implicit defaults (now recorded in docs/compatibility.md).

## Two-axis review record (2026-09-04, post-fix)

Standards: 0 hard violations; judgement calls 1/2/3/4/7 actioned — head-first
offender ordering in YS0027 (matches upstream's lexer-before-regex failure
order), `assertNoLastline` test helper, operands.ts inline comment folded into
its JSDoc, `Dialogue.continue()` now the sole statement of the continue
contract (vm.ts points at it), CHANGELOG singular rename wording. Declined:
#5 flag argument (`tagLastLine` — one boolean mirroring a documented upstream
visitor scope; an options object adds ceremony, not clarity), #6 structural
slice for `lastLine` (named alias would be public-surface noise for a
single-site internal binding).

Spec: all findings + 3 parity fixes verified against upstream sources
(Library.cs:225, LastLineBeforeOptionsVisitor.cs, YarnSpinnerLexer.g4:30,
Compiler.cs:887, VirtualMachine.cs PushVariable); L8 closed (role-string
pointer replaced with the actual claimed/resolved convention, recovered from
ticket history); the once-block golden test reshaped so it discriminates (a
regression to the backward scan fails it). `visitCountVariableKey` dot change
stands as a recorded internal-consistency choice (no upstream analog),
revertable pre-release.
