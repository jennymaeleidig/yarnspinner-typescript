# Research: Upstream conformance fixtures (.NET YarnSpinner + YarnSpinner-Rust)

> Ticket: [issues/01-upstream-conformance-fixtures.md](../issues/01-upstream-conformance-fixtures.md)
> Method: both repos inspected directly (full checkouts, not summaries). Sources:
> - **YarnSpinner (.NET)** @ `main` = `ec1a680` (2026-08-11, the 3.2.2 release-era tip), `Tests/` and `YarnSpinner.Tests/`
> - **YarnSpinner-Rust** @ `main` = `10a052c` (2026-08-11), `crates/yarnspinner/tests/`
> - Rust submodule pin verified against raw.githubusercontent at the pinned SHA.
> Takeover re-verification (post-kill spot-check against main via GitHub API): Tests/ layout + 32 TestCases pairs + DuplicateLineTags.yarn confirmed from the git tree; current `YarnSpinnerTestPlan.g4` (backticked TEXT, `---` runs, `saliency:`, hashtags, `node:`) confirmed; Rust `.gitmodules` + hand-rolled `step/reader.rs` (adapted from old .NET TestPlan.cs @ `da39c71`, no grammar) confirmed; `TestBase.RunStandardTestcase` semantics (strict event alternation, composed text, hashtags, select -1, saliency map `first|best|best_least_recently_seen`, `set:` vs `Program.InitialValues`) confirmed against `YarnSpinner.Tests/TestBase.cs@main`. All claims below checked out as written.

## 1. TL;DR

The .NET repo's `Tests/TestCases/` directory (~32 `.yarn`+`.testplan` pairs, 33 `ParseFailures/` files, 3 `Duplicates/` files) is the golden conformance corpus, and the Rust port consumes **the same files** via a git submodule — which is exactly the precedent a TS harness should follow. Assertions live in sidecar `.testplan` files (a small ANTLR-grammar DSL of expected lines/options/commands/selects), **not** in expected-output files. Two caveats: (a) the testplan format changed upstream (backticked text, `---` runs, `saliency:` steps, hashtags) and the Rust submodule is pinned to a commit with the **old unquoted format**, so the Rust reader is *not* a faithful guide to the current format — port the current ANTLR grammar instead; (b) a handful of fixtures depend on harness-registered C# functions and .NET saliency strategy classes, which the TS harness must supply equivalents of.

## 2. Inventory of the .NET corpus (`YarnSpinner@main:Tests/`)

### 2.1 Layout

| Path | Contents | Consumed by |
|---|---|---|
| `Tests/*.yarn` (13 loose files) | AnalysisTest, Basic, Compiler, Example (+`.testplan`), Headers, InvalidNodeTitle, Options, RandomOptions, SkippedOptions, Strings, TaggedLines | individually written tests (`DialogueTests`, `LanguageTests`), **not** the generic loop |
| `Tests/TestCases/*.yarn` + `*.testplan` | 32 feature pairs (table below) | generic data-driven loop |
| `Tests/TestCases/DuplicateLineTags.yarn` (no plan) | must fail to compile (YS0018) | generic loop |
| `Tests/TestCases/Duplicates/` | lipsum1/2/3.yarn — multi-file compile, node-merge error | `ProjectTests` (both repos) |
| `Tests/TestCases/ParseFailures/` | 33 files, one per compile-error rule, no plans | generic loop ("no plan ⇒ must error") |
| `Tests/Projects/Basic/` | Test.yarn + Test.json (projectFileVersion) | `ProjectFileTests` |
| `Tests/Projects/Space/` | Sally.yarn, Ship.yarn, Space.yarnproject, Commands.ysls.json | multi-file + `.ysls` definitions tests |
| `YarnSpinner.Diagnostics/Definitions/YS00xx-*.md` | **53** diagnostic definitions, each with YAML frontmatter + inline `examples[].script` Yarn sources (`-=-` placeholder for `---`) | generated tests assert the exact YSxxxx code fires |

Note: `LanguageTests` also references a `Tests/Issues/` directory that **does not exist** on main (the loop handles the missing dir as empty; Rust comments this out too).

Note: `Tests/RandomOptions.yarn` uses an unregistered `<<shuffleNextOptions>>` command and is referenced by no current test — dead fixture, skip it.

### 2.2 `TestCases/` fixture → feature-area map (vs census gap areas)

| Fixture pair | Feature area (census §) |
|---|---|
| Commands | custom commands, `{expr}` interpolation in commands, command hashtags |
| DecimalNumbers | decimal literals (locale-independence adjacent) |
| Detours | `<<detour>>`/`<<return>>`, return-stack semantics |
| Enums, Enums-FunctionsAcceptingStringMayAcceptAnyStringEnum, Enums-FunctionsReturningStringMayBeComparedToAnyStringEnum | enums, raw values, `.Case` shorthand, enum↔string function typing |
| Escaping | `\:` escaping (3.2.0), `\[`, `\\`, markup escapes |
| Expressions, InlineExpressions | operators, precedence, `{expr}` in lines |
| FormatFunctions | `format`, `format_invariant`, replacement markers `[plural]`/`[ordinal]`/`[select]` via composed text |
| Functions | function calls, `add_three_operands` (harness fn) |
| IfStatements | `if/elseif/else/endif` |
| Indentation | INDENT/DEDENT blocks, option bodies |
| Inference-FunctionsAndVarsInheritType, Inference-FunctionsCalledWithConvertibleParameters | type inference, `dummy_*` fns |
| Jumps | `[[jump]]`, `<<jump>>` |
| LineGroups | `=>` groups, saliency (`saliency:` steps), once-in-groups |
| Lines | character names, hashtags (`#line:` metadata assertions) |
| NodeGroupVisitTracking, NodeGroups, NodeGroupsContentQuerying, NodeGroupsWithImplicitDeclarations | node groups, `when:`, `visited_count`, `has_any_content`, `node:` mid-run jumps |
| Once | `<<once>>` statements + `<<once if>>` line conditions, generated viewed-variables, saliency |
| ShadowLines | `#shadow:` re-use, metadata assertions |
| ShortcutOptions | shortcut options, nesting, conditions, availability, **NoOptionSelected fall-through** (`select: 0` plans) |
| SmartVariables | smart declares, `TryGetSmartVariable`-style recomputation |
| Smileys | emoji/unicode line handling (also used directly by `DialogueTests`) |
| Types | declarations with explicit types |
| VariableStorage | variable get/set across runs, initial values |
| VisitCount, VisitTracking, Visited | `visited()` / `visited_count()` (VM-tracked on node return) |

**Census gap areas with thin/no direct fixture coverage** (TS must lean on the .NET test *source code* instead, e.g. inline `CreateTestNode` cases in `MarkupTests.cs`, `DialogueTests.cs`, `LanguageTests.cs`): markup attribute/property parsing (`MarkupTests` is inline-source based), `PrepareForLines` lookahead, string-table/localisation CSV generation, line-tag generation (`TaggedLines.yarn` covers only the basics via `DialogueTests`), error-code *specifics* (ParseFailures asserts "some error", not the code — only the `YarnSpinner.Diagnostics` definition examples assert exact YSxxxx codes).

## 3. How the .NET suite asserts (`YarnSpinner.Tests/`)

**The generic loop** (`LanguageTests.TestSources`, xUnit `[Theory]` over `FileSources("TestCases")`, `FileSources("TestCases/ParseFailures")`, `FileSources("Issues")`):

- If a sibling `.testplan` exists ⇒ must compile **without error diagnostics**; then run the plan against the compiled program starting at node `Start` (if it exists).
- If no `.testplan` ⇒ must produce **≥1 error diagnostic** (ParseFailures convention). It asserts only "has errors", not codes.
- Two more loops over the same corpus: culture-independence (compiles the file under 14 cultures, compares parse trees/programs/string tables) and basic-block extraction (`ValidFileSources`).

**The `.testplan` DSL** (grammar: `YarnSpinner.Tests/TestPlan/YarnSpinnerTestPlan.g4`, parsed by generated ANTLR parser):

```
testplan   : run ('---' run)*          // each run re-SetNode("Start")
step       : 'line:' TEXT hashtag*     // TEXT = `backticked`; hashtags asserted against string-table metadata
           | 'line:' '*' hashtag*      // any-text line
           | 'option:' TEXT hashtag* ('[disabled]')?
           | 'command:' TEXT
           | 'select:' NUMBER          // 1-indexed; converted to 0-based
           | 'stop'
           | 'set:' $var = BOOL|NUMBER // typed by program initial values
           | 'node:' IDENTIFIER        // mid-run jump to another node
           | 'saliency:' first|best|best_least_recently_seen
```

**Assertion semantics** (`TestBase.RunStandardTestcase`):

- Strict event alternation: while expecting a line, installing an option/command/complete handler that throws if a different event arrives (and vice versa). Not "compare transcripts" but "step-lock the event stream".
- Expected line text is compared against the **composed** text: string-table text → `ExpandSubstitutions` → `LineParser.ParseString` with `select`/`plural`/`ordinal` `BuiltInMarkupReplacer` processors registered. So FormatFunctions fixtures exercise replacement markers end-to-end.
- Hashtag expectations are checked against `StringInfo.metadata` (e.g. `#line:` ids, `#lastline`).
- Option expectations check text, hashtags, and `IsAvailable`; if no option is available the plan must `select: 0` (mapped to -1 = `Dialogue.NoOptionSelected`) — this is how the 3.1 fall-through is tested.
- Default state per test: `BestLeastRecentlyViewedSaliencyStrategy` over the test's `VariableStorage`; `assert()` library function that fails the test when the Yarn-side call returns false.
- Harness-registered functions the fixtures call: `assert`, `dummy_bool`/`dummy_number`/`dummy_string`, `add_three_operands` (LanguageTests ctor also registers `set_objective_complete`, `is_objective_active`, `get_quest_status` — used by loose fixtures/tests, not the TestCases loop).

**Diagnostic example tests** (`GeneratedDialogueTests`): for each `YarnSpinner.Diagnostics/Definitions/YSxxxx.md`, each `examples[].script` (with `-=-`→`---`) is compiled and must (or must not, for negative examples) produce that exact diagnostic code. This is the **only** place exact YSxxxx codes are asserted — 53 definition files spanning YS0001–YS0061 on main.

## 4. How YarnSpinner-Rust consumes the same fixtures

- **Same files via submodule**: `.gitmodules` → `third-party/YarnSpinner` → the YarnSpinner repo, pinned at `838761a`. Test paths resolve to `third-party/YarnSpinner/Tests` (`test_base/paths.rs`).
- **Same loop, same convention**: `crates/yarnspinner/tests/language_tests.rs::test_sources` iterates `TestCases` + `TestCases/ParseFailures` ("Issues" commented out as nonexistent); plan present ⇒ compile+run; absent ⇒ compile must fail. Same start-at-`Start`, same "run plan only if Start exists" rule.
- **Hand-rolled plan reader, not a grammar port**: `test_base/step.rs` + `step/reader.rs` parse the plan line-by-line with an ad-hoc reader. It supports `line:`/`option:` (raw-to-end-of-line text, ` [disabled]` suffix stripping, `*`), `select:`, `command:`, `stop`, `set:` (string-typed, converted by inspecting the variable's current type), and `run:` (old syntax).
- **It does NOT support the current format**: no backtick handling (compares raw text incl. backticks), no `---` runs, no `saliency:` steps, no hashtags on expectations, `run:` instead of `node:`. Verified: at the submodule pin `838761a`, `Tests/Example.testplan` is the **old unquoted format** (`line: A: Hey, I'm a character in a script!`), so the Rust suite is green against the *old* format; the current main format (backticks etc.) would not parse.
- **Ported-aside tests**: culture-independence omitted (no global culture in Rust); `TestNumberPlurals` moved to a runtime-crate unit test; upgrader tests and parse-tree formatting omitted.
- Other Rust integration tests mirror .NET ones 1:1 (dialogue_tests incl. Smileys, project_tests incl. Duplicates lipsum, project_file_tests, tag_tests, type_tests, error_handling_tests with inline sources).
- Rust's own new fixtures (`crates/bevy_plugin/assets/*.yarn`, `examples/**/dialogue/*.yarn`) are engine-demo files, not conformance material.

**Consequence for us**: there are **two** testplan formats in the wild. Since the parity target is 3.2.2, the TS harness should implement the **current ANTLR grammar format** (`YarnSpinnerTestPlan.g4` on main) and vendor the 3.2.2 `Tests/` directory — do not copy the Rust reader's subset or its old-format assumptions.

## 5. What a TS test harness needs

1. **Vendor the fixtures**: copy (or submodule) `YarnSpinner@v3.2.2:Tests/` into the repo (e.g. `test/fixtures/upstream/`). The whole dir is ~40 KB of text; copying is simpler than submodules and matches the repo's existing self-contained test style. Pin by tag so it can be refreshed.
2. **A `TestPlan` parser** implementing the full `YarnSpinnerTestPlan.g4` (backticks, hashtags, `[disabled]`, `set:`, `node:`, `saliency:`, `---` runs, 1-indexed select). Small enough to hand-write (~150 lines) — no ANTLR runtime needed.
3. **A runner** porting `TestBase.RunStandardTestcase`: event-type strictness (each expectation installs handlers that fail on any other event type), composed-text comparison, hashtag metadata assertions, option availability, `select: 0` ⇒ `NoOptionSelected` fall-through, `set:` typed via program initial values, `saliency:` switching, `assert()` library function, `dummy_*` + `add_three_operands` + quest stubs registration.
4. **Runtime prerequisites that are themselves parity gaps**: content-saliency strategies (First/Best/BLRV) as swappable objects; `LineParser` with substitutions + markup + built-in replacement markers (`select`/`plural`/`ordinal`) for composed-text comparison; string-table metadata (hashtags) exposure; program initial values; node-group `node:` jumps.
5. **Compile-error loop**: ParseFailures fixtures only assert "compilation fails with ≥1 error + valid ranges" — cheap to adopt immediately; exact-code assertions come from the `Definitions/YSxxxx.md` examples if we also adopt the diagnostic-example harness (needs a tiny YAML-frontmatter reader and the `-=-` substitution).
6. **Locale caution**: expected text in plans is composed under the test locale `en`; number formatting in composed text must not be locale-dependent (the .NET suite has a dedicated culture-independence loop — worth a cheap TS analogue via forced `Intl`/`NumberFormat` invariants).

## 6. C#/Unity-specific dependencies to flag

| Dependency | Where | TS mitigation |
|---|---|---|
| Harness-registered C# functions (`assert`, `dummy_*`, `add_three_operands`, quest stubs, `variadic_add`) | TestBase/LanguageTests | register TS equivalents in the harness Library |
| `<<shuffleNextOptions>>` command | `Tests/RandomOptions.yarn` only | fixture is dead on main; skip |
| .NET saliency strategy classes | `Once`, `LineGroups`, `NodeGroups*` plans via `saliency:` steps | implement strategies (already a census gap) |
| `MemoryVariableStore` / `Program.InitialValues` semantics for `set:` steps | TestBase | TS variable store must expose initial values |
| Culture-sensitive number formatting (culture-independence loop) | LanguageTests | optional; port as an invariant-formatting check |
| xUnit/FluentAssertions, ANTLR runtime | test infra | irrelevant to fixtures themselves; replaced by TS runner |
| Upgrader tests (`Tests/Upgrader/...` referenced by `UpgraderTests`) | V1→V2 upgrade fixtures | out of scope (we target 3.x only) |

## 7. Recommendation

Adopt the **.NET corpus as the sole golden set** (the Rust port adds zero additional fixtures — it only re-consumes the .NET ones, against an older format pin). Phase it: (1) vendor `Tests/` + ParseFailures "must-fail" loop; (2) TestPlan parser + runner for the 32 plan pairs; (3) diagnostic-definition examples for exact YSxxxx codes. This yields roughly 68 compilation units and 32 executable end-to-end dialogues, directly covering the census's saliency, node-group, once, smart-variable, enum, detour, shadow-line, and NoOptionSelected areas, with markup/localisation/PrepareForLines remaining on inline-source tests to be ported separately.
