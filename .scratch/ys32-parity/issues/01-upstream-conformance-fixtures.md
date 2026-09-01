# Inventory upstream conformance fixtures

Type: research
Status: resolved
Blocked by: —

## Question

Which upstream test fixtures from **both** official implementations — [YarnSpinnerTool/YarnSpinner](https://github.com/YarnSpinnerTool/YarnSpinner) (the .NET reference, esp. `YarnSpinner.Tests` and its `.yarn` fixture files) and [YarnSpinnerTool/YarnSpinner-Rust](https://github.com/YarnSpinnerTool/YarnSpinner-Rust) (the Rust port and its test suite) — can serve as **golden conformance tests** for a third-party TypeScript reimplementation? Inventory: which `.yarn` fixtures exist, what feature areas they cover (map them to the gap areas in [the census](../research/ys322-census.md)), how tests assert behavior (expected output files? inline expectations?), how YarnSpinner-Rust consumes the same fixtures, and what a TS test harness would need to adopt them (file copying? expected-output format translation?). Flag fixtures that depend on C#/Unity-specific behavior.

## Answer

Full findings (verified against both repos at the 3.2.2-era tips): [research/upstream-fixtures.md](../research/upstream-fixtures.md).

**Verdict: adopt the .NET corpus as the sole golden set; the Rust port contributes zero additional fixtures.** YarnSpinner-Rust consumes the *same* `.yarn`/`.testplan` files via a git submodule (`third-party/YarnSpinner`), proving the vendor-upstream-fixtures + ported-TestBase pattern — but its submodule is pinned to a commit with the **old testplan format**, so its reader is not a guide to the current format.

**The corpus** (YarnSpinner .NET @ main = 3.2.2-era, `Tests/`):

- `Tests/TestCases/` — **32 `.yarn`+`.testplan` pairs** (Commands, DecimalNumbers, Detours, Enums ×3, Escaping, Expressions, InlineExpressions, FormatFunctions, Functions, IfStatements, Indentation, Inference ×2, Jumps, LineGroups, Lines, NodeGroups ×4, Once, ShadowLines, ShortcutOptions, SmartVariables, Smileys, Types, VariableStorage, VisitCount/VisitTracking/Visited) + `DuplicateLineTags.yarn` (must fail, YS0018) + `Duplicates/` (3 lipsum files, multi-file compile) + `ParseFailures/` (33 one-per-error-rule files, no plans).
- 13 loose `Tests/*.yarn` files used by individually-written tests (DialogueTests, LanguageTests, etc.), not the generic loop; `RandomOptions.yarn` is dead (unregistered `<<shuffleNextOptions>>`, no test) — skip it.
- `Tests/Projects/Basic` + `Tests/Projects/Space` (multi-file + `.ysls` definitions).
- `YarnSpinner.Diagnostics/Definitions/YS00xx-*.md` — 53 diagnostic definitions with inline `examples[].script` Yarn sources (`-=-` placeholder for `---`); the **only** place exact YSxxxx codes are asserted.

**Feature-area coverage vs census gaps**: TestCases directly covers saliency/line-groups, node groups + `when:`, `once`, smart variables, enums, detour/return, shadow lines, `#line:` metadata, `visited()`/`visited_count()`, NoOptionSelected fall-through (3.1), escaping, indentation, and expressions. **Thin/no direct fixture coverage** (TS must port inline-source tests instead): markup attribute/property parsing (`MarkupTests.cs` is inline-source), `PrepareForLines` lookahead, string-table/CSV localisation, line-tag generation, and exact diagnostic codes (ParseFailures asserts only "some error", not the code).

**How assertions work**: no expected-output files. A `.testplan` is a small ANTLR-grammar DSL (`YarnSpinner.Tests/TestPlan/YarnSpinnerTestPlan.g4`): `line:`/`option:`/`command:`/`select:`/`stop`/`set:`/`node:`/`saliency:` steps, `---`-separated runs, backticked text, hashtags, `[disabled]`. `TestBase.RunStandardTestcase` step-locks the event stream (each expectation installs handlers that *fail* on any other event type), compares **composed** text (string table → `ExpandSubstitutions` → `LineParser.ParseString` with select/plural/ordinal `BuiltInMarkupReplacer`), asserts hashtags against string-table metadata, and maps `select: 0` → -1 = `NoOptionSelected`. Plan present ⇒ must compile clean; no plan ⇒ must error (ParseFailures convention). Harness-registered functions the fixtures call: `assert`, `dummy_bool/number/string`, `add_three_operands`, plus quest stubs in LanguageTests.

**TS harness requirements**: (1) vendor `YarnSpinner@v3.2.2:Tests/` (~40 KB text; copy pinned by tag, simpler than the Rust submodule route); (2) a hand-written TestPlan parser implementing the **current** grammar (~150 lines, no ANTLR needed — do not copy the Rust reader's old-format subset); (3) a runner porting `RunStandardTestcase` (event strictness, composed text, hashtags, availability, `set:` typed via program initial values, saliency switching); (4) runtime prerequisites that are themselves parity gaps: saliency strategies (First/Best/BLRV), `LineParser` with replacement markers, string-table metadata exposure, `Program.InitialValues`; (5) a must-fail loop for ParseFailures (cheap, adoptable immediately) + optional diagnostic-example harness over `Definitions/*.md` for exact YSxxxx codes.

**C#/Unity-specific flags**: harness-registered C# functions (port as TS Library functions); .NET saliency strategy classes (`saliency:` steps in Once/LineGroups/NodeGroups plans); `MemoryVariableStore`/`Program.InitialValues` semantics for `set:`; culture-independence loop (14 cultures — port as an invariant-number-formatting check); upgrader tests (out of scope, 3.x only); `RandomOptions.yarn` dead fixture. Nothing in the corpus itself requires Unity.

**Recommended phasing**: (1) vendor Tests/ + ParseFailures must-fail loop; (2) TestPlan parser + runner for the 32 pairs; (3) diagnostic-definition examples for exact YSxxxx codes. Yields ~68 compilation units + 32 executable end-to-end dialogues.

---

## Comments

### 2026-09-01 — Phase 0 (conformance foundation) implemented

Adopted the recommended phasing from the Answer. Landed:

- **Vendored corpus**: `test/fixtures/upstream/YarnSpinner/` at tag `v3.2.2`
  (commit `5b3a4ff`), with `PROVENANCE.md` (provenance, refresh instructions,
  MIT citation). Excludes `TestCases/Duplicates/` (~6 MB lipsum, needs the
  phase-3 multi-file compile surface) and the generated ANTLR sources; the
  normative `.g4` grammar is vendored instead.
- **TestPlan parser**: `src/tests/upstream/testPlan.ts` — full current grammar
  (backticked TEXT, `---` runs, hashtags, `[disabled]`, 1-indexed `select:`
  → 0-based with 0 ⇒ -1, `set:`, `node:`, `saliency:`). Note: upstream's
  ANTLR COMMENT token swallows trailing hashtags (maximal munch), so its
  hashtag assertions are dead-by-quirk; we parse per grammar intent.
- **TestBase port**: `src/tests/upstream/testBase.ts` — step-locked
  event-stream runner over `parseYarn → compile → YarnRunner`, composed-text
  comparison (speaker-prefixed), hashtag assertions, option-count/availability
  adaptation, shared runtime across runs. Documented adaptations: state
  commands (`set`/`declare`/`call`) filtered from the event stream; `[disabled]`
  options cannot be presented (runtime drops them) so `select: 0` is only
  verifiable via natural fall-through; `saliency:` steps validated but ignored.
- **Driver**: `src/tests/upstream-conformance.test.ts` — ParseFailures
  must-fail loop (33 files + DuplicateLineTags), compile-clean loop (32 pairs),
  plan-run loop (32 pairs), Example.yarn smoke. Self-cleaning allowlists: every
  entry must still be failing (stale entries fail the suite).

Conformance-driven fixes that landed as part of making the corpus runnable
(each traces to a spec story or recorded decision):

- Parser: infinite loop on INDENT inside `<<enum>>` blocks; INDENT/DEDENT
  transparency in statement loops (upstream fixtures mix indent levels);
  `//` comments (full-line and inline) no longer become dialogue; trailing
  whitespace trimmed; hashtags may contain `:` (`#line:` now propagates);
  blank line separates option groups (upstream groups are consecutive lines).
- Runner: additive `setNode()`; `<<stop>>` halts and fires DialogueComplete
  (story 8); `<<return>>` ends a detour / acts as stop (story 5); jump unwinds
  detour return stack recording visits per exited node (stories 5, 23);
  braced jump/detour destinations (`{"Node3"}`, `{$var}`) evaluate as
  expressions; `tracking:` header honored, `tracking: never` suppresses visit
  recording (story 22); `{expr}` expansion in delivered command text;
  booleans interpolate as upstream's `True`/`False` (C# ToString contract).
- Evaluator/commands: compound assignment `+= -= *= /= %=` (story 3); string
  `+` concatenation with upstream bool rendering; unset-variable comparisons
  use implicit type defaults (bool→false, number→0, string→"").

**Status**: 21 of 32 plan pairs green; 11 allowlisted against spec stories
(2: line-level `<<if>>`/`<<once else>>`, 11-12 enums, 17-19 saliency/line
groups, 20 has_any_content, 24 subtitles, 25 option conditions, 26/9 escaping,
27 replacement markers). Must-fail loop: 1 of 33 ParseFailures fixtures fails
to compile naturally (the compiler lacks the phase-1 diagnostics channel, so
the other 32 are expected via `MUST_FAIL_ALLOWLIST` until it lands — the loop
verifies compilation *outcomes*, not diagnostic codes yet); all 32 pairs
compile clean (no allowlist entries). Full suite: 135 passing.

**Review-driven follow-ups (commit 2, same ticket)**: culture-independence
ported as an invariant-formatting check (`src/tests/invariant-formatting.test.ts`
— culture-sensitive APIs patched to throw while numeric stories run);
`set:` steps validated against `Program.InitialValues` and declared variables
seeded into storage at start-up (upstream `Dialogue.SetProgram` semantics);
`package.json` `files` narrowed to library output only (test code excluded);
testplan `NUMBER` restricted to the grammar-exact `[0-9]+`; option-group
blank-line split confirmed against the upstream grammar
(`shortcut_option* (shortcut_option BLANK_LINE_FOLLOWING_OPTION?)`,
YarnSpinnerParser.g4:147-149); once-state and visit counts moved into variable
storage as generated variables (standards §4); `YarnRunner` → `Dialogue`
rename deferred to issue 17. Phase-3 (diagnostic-definition examples) not
started — needs the diagnostics channel (phase 1).
