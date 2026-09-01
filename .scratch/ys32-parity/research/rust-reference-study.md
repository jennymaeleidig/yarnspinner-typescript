# Research: YarnSpinnerTool/YarnSpinner-Rust reference study

> Ticket [02](../issues/02-rust-reference-study.md) · gathered from the repo cloned at commit `10a052c` (2026-08-11, "Merge pull request #286"), crates.io metadata, docs.yarnspinner.dev Bevy section, and GitHub issues. All file claims verified against source in the clone.

## 1. What it is (and the headline caveat)

**Yarn Spinner for Rust** (crates `yarnspinner`, `bevy_yarnspinner`) is the official Rust port, led by Jan Hohenheim, MIT/Apache-2.0, README-marked "work-in-progress, no official support". Latest release line is **0.9** (crates `yarnspinner_core`/`yarnspinner_compiler`/`yarnspinner_runtime` all 0.9.0), repo last touched 2026-08-11 — actively maintained.

**Headline: it is a Yarn 2.x implementation, not a 3.x one.** The README version table maps Rust 0.9 ↔ Yarn Spinner **2.5.0** (.NET). Repo-wide source search finds **zero** occurrences of: saliency (any strategy), smart variables, `<<enum>>`/enum-typed declarations, `detour`/`return`, node groups (`when:`), `<<once>>`/`<<endonce>>`, `NoOptionSelected`, or YS00xx codes. Open issue #9 ("Clarify yarn spinner compiler compatibility", open since 2023) is resolved by the README version table. The docs.yarnspinner.dev Bevy page carries a site-wide "documentation for Yarn Spinner 3 is being updated" banner, but the code itself has no 3.x work. **Verdict for our purposes: a strategy reference for porting Yarn Spinner to a new language, and a 2.x-era architecture reference — not a 3.2.2 feature reference.**

## 2. Source layout

Cargo workspace (paths under `crates/`):

| Crate | Role |
|---|---|
| `yarnspinner_core` | Shared types: `Program`/`Node`/`Instruction`/`Operand` (prost-generated from the same `.yarn.proto` as .NET — `src/generated/yarn.rs`), `YarnValue`, `Library`/`YarnFn`, type system (any/boolean/number/string/function), `LineId`, `Operator`, newtype-heavy (`Position`, `Language`). |
| `yarnspinner_compiler` | ANTLR-based compiler. `parser/generated/` = antlr-rust output of the **same `YarnSpinner.g4` grammar** as .NET (antlr-rust pinned `=0.3.0-beta`), plus `indent_aware_lexer.rs`. Pipeline: `compilation_steps/` (15 ordered steps: `parse_files` → `get_declarations` → `register_initial_variables` → `check_types` → `generate_code` → `register_strings` → `validate_unique_node_names` → `add_error_for_empty_nodes` → `find_tracking_nodes` → `add_tracking_declarations` → `early_breaks` → `clean_up_diagnostics` …). Tree-walk `visitors/` (`code_generation`, `type_check`, `declaration`, `string_table_generator`, `constant_value`, `last_line_before_options`, `node_tracking`) + `listeners/` (`compiler_listener`, `error_listener`, `untagged_line_listener`). Output in `output/` (`Compilation`, `StringInfo`, `Declaration`, `DebugInfo`), `string_table_manager.rs`, `project.rs`, `compiler/add_tags_to_lines.rs`. |
| `yarnspinner_runtime` | `#![no_std]` runtime. `dialogue.rs`, `virtual_machine.rs` (+`virtual_machine/{state,execution_state}.rs`), `line.rs`, `markup/` (`LineParser`, `MarkupParseResult`), `variable_storage.rs`, `text_provider.rs`, `command.rs`, `dialogue_option.rs`, `events.rs`, `analyser.rs`, `pluralization.rs`, `language.rs`. |
| `yarnspinner` | **Facade crate** for engine-adapter authors ("working without Bevy"): re-exports compiler+core+runtime with a curated `prelude` (aliased as `YarnCompiler`, `YarnProgram`, `YarnLine`, …). |
| `bevy_plugin` (`bevy_yarnspinner`) | Engine integration: `YarnProject`, `DialogueRunner` (builder + `continue_in_next_update`, `select_option`, `run_selected_options_as_lines`, `set_language`/`set_text_language`), events, `LocalizedLine`, `YarnFileSource`, line providers (strings-file CSV, shared text), asset providers (localized audio), `command_registry` (built-in blocking `wait` command), localisation (`line_id_generation`, strings-file asset + auto-updating, `development_file_generation`). |
| `codegen` | Generates the proto Rust code from the .NET proto definition. |

Every ported file opens with `//! Adapted from <URL of pinned .NET commit da39c71>` plus a `## Implementation notes` block listing deliberate divergences (e.g. "`OptionSet` was replaced by a simple `Vec<DialogueOption>`", "The interface has been changed to make use of our `YarnValue` type").

## 3. IR/VM: kept the .NET instruction stream, did not design its own IR

- `Program { name, nodes: BTreeMap<String, Node>, initial_values }`, `Node { name, instructions: Vec<Instruction>, labels: BTreeMap<String,i32> }` — the **same protobuf-shaped instruction-stream VM as .NET 2.x**, regenerated via prost (artifact compatibility with .NET-compiled programs is not the goal, but the *shape* is kept verbatim).
- VM dispatches the classic 2.x opcode set: `JumpTo, Jump, RunLine, RunCommand, AddOption, ShowOptions, PushString/Float/Bool/Null, JumpIfFalse, Pop, CallFunc, PushVariable, StoreVariable, Stop, RunNode`. (Notably it does **not** even adopt 3.x's instruction-index jumps or saliency-candidate ops — it's 2.x label-jump era.)
- `visited`/`visited_count` are done the **2.x way**: the compiler generates `$visited_<node>` tracking variables (`compilation_steps/add_tracking_declarations.rs`, `find_tracking_nodes.rs`) instead of 3.x's VM-side visit tracking.
- Implicit line IDs: hash of `file_name + node_name + count`, retry loop up to 1000 attempts (`string_table_manager.rs`) — the 2.x scheme, not 3.x's SHA-256-lock scheme.

So the answer to the ticket's IR question: **the Rust port transliterated the .NET Program/VM rather than designing a new IR** — unlike this TS repo's tree-shaped IR.

## 4. Compiler API

- Builder replacing `CompilationJob`: `Compiler::new().add_file(File { file_name, source }).add_files(..).read_file(path).extend_library(lib).declare_variable(d).with_compilation_type(t).compile()`.
- `compile() -> Result<Compilation, CompilerError>`; **`CompilerError(Vec<Diagnostic>)` — errors go in `Err`, warnings are collected in `Compilation.warnings`** ("In contrast to the original implementation … we return an actual `Result`, so this type is guaranteed to only hold warnings").
- `Compilation { program, string_table, declarations, contains_implicit_string_tags, file_tags, warnings }` — same fields as .NET's `CompilationResult`.
- `CompilationType::FullCompilation | StringsOnly | DeclarationsOnly` (2.x set; no 3.x type-check-only mode).

## 5. Diagnostics

- **No YS00xx codes.** `Diagnostic { file_name, range, message, context, severity: Error|Warning }`; rendered via `annotate-snippets` with a **hardcoded id `"Y001"`** on every diagnostic. No `Info` severity (explicitly noted as unimplemented).
- Errors abort the compile (returned in `CompilerError`); warnings accumulate. The contract is collect-warnings / return-errors — a deliberate improvement over .NET's single diagnostics list.

## 6. Runtime API shape

- `Dialogue { vm, language_code }` mirrors .NET closely: `new(Box<dyn VariableStorage>, Box<dyn TextProvider>)`, `continue_()`, `set_selected_option(OptionId)`, `set_selected_option_by_line_id(LineId)`, `set_node`, `replace_program`/`add_program`, `stop`, `unload_all`, `can_continue`, `is_active`, `is_waiting_for_option_selection`, `node_exists`, `node_names`, `get_headers_for_node`, `get_line_id_for_node`, `get_tags_for_node`, `analyse(&mut Context)` (ported the 2.x `Yarn.Analysis` that .NET deleted in 3.0), `current_node`, `library()/library_mut()`.
- **Handlers → return values**: `continue_() -> Result<Vec<DialogueEvent>>`, where `DialogueEvent` is `Line(Line) | Options(Vec<DialogueOption>) | Command(Command) | NodeStart(String) | NodeComplete(String) | LineHints(Vec<LineId>) | DialogueComplete`. Each variant's doc comment names the .NET handler it replaces ("Corresponds to Yarn Spinner's `PrepareForLinesHandler`"). Pull-based instead of .NET's seven push callbacks. `LineHints` is opt-in via `set_line_hints_enabled` (this repo's map flags `PrepareForLines` as an IR pressure point — the Rust answer is "make it an optional event, not a core handler").
- **`VariableStorage` trait** (richer than .NET's per-type `IVariableStorage`): `set/get/contains/extend/variables/clear`, `clone_shallow()` (a clone *sharing* storage — for snapshot/cheap duplicate runners), `as_any/as_any_mut` for downcasting. One `YarnValue` enum (String/Number/Bool) instead of per-type setters. Must reject names not starting with `$` (`VariableStorageError::InvalidVariableName`). Default `MemoryVariableStorage(Arc<RwLock<HashMap>>)` — interior mutability, unlike this TS repo's plain object.
- **`TextProvider` trait** — localisation lives behind this seam, not inside `Dialogue`: `StringTableTextProvider` with `extend_base_language`/`extend_translation` + fallback-to-base-language logic. `Line { id, text, markup }` arrives already substituted; markup parsing via `LineParser` with `select`/`plural`/`ordinal` marker processors and a `character` attribute (2.x replacement-handler parity), locale-aware plural/ordinal classes via ICU crates (`icu_plurals`, `icu_locid`, `fixed_decimal`).
- **`Library`** wraps a `YarnFnRegistry`: `add_function(name, fn)` with marker-based type reflection (the `variadics_please` crate supplies arity/variadic support), `standard_library()` with the 2.x built-ins (`random`, `random_range`, `dice`, `round`, `round_places`, `floor`, `ceil`, `inc`, `dec`, `decimal`, `int`, `number`, `string`, `bool`, `min`/`max`… ), `visited`/`visited_count` registered per-`Dialogue` bound to the variable storage. `generate_unique_visited_variable_for_node`.
- The Bevy `DialogueRunner` wraps `Dialogue` with frame-friendly semantics (`continue_in_next_update`, events as Bevy events, blocking `wait` as a registered command system, `run_selected_options_as_lines`).

## 7. Localisation / string tables

- Core: `StringInfo { text, node_name, line_number, file_name, is_implicit_tag, metadata }` in `Compilation.string_table`; `LineId` newtype; language switching on `Dialogue` (`set_language_code`).
- Bevy layer: `.strings.csv` assets, strings-file asset loading + **auto-updating strings files** (`localization/strings_file/updating.rs`), line-ID generation for untagged lines at project load (`localization/line_id_generation.rs`), per-language asset providers (audio by line ID). Roughly the 2.x Unity-plugin feature set.

## 8. Completeness against 3.2.2

Effectively **0% of the 3.x language surface**: no enums, smart variables, node groups/`when:`, `<<once>>`, saliency strategies, `detour`/`return`, `has_any_content`, `NoOptionSelected` fall-through, YS00xx codes, SHA-256 line locks, implicit `[character]` marker as 3.2 processes it, `ILineTagGenerator`/DescriptiveLineTagGenerator, type-check-only compilation, variadic-with-any-arity registration is present but 2.x-shaped. Its type checker is a port of the .NET **2.x** `TypeCheckVisitor` (basic inference, deferred types), not the 3.x checker. Not even 2.x is complete: the test base explicitly notes upgrade-testing methods weren't ported, and issue #9 (compatibility documentation) has been open since 2023.

## 9. Design lessons for the TS port

**Copy this**
1. **Provenance comments per file**: "Adapted from <upstream file @ pinned commit>" + a short "deliberate divergences" list. Cheap, and it makes parity audits diffable against upstream.
2. **Run upstream's own test suite as fixtures**: `.gitmodules` pulls YarnSpinner .NET into `third-party/YarnSpinner`; `crates/yarnspinner/tests/test_base/` is a port of `YarnSpinner.Tests/TestBase.cs` (test-plan/step machinery included) executing the .NET repo's `.yarn` fixtures. This is the exact golden-test harness the map's fixtures-inventory ticket wants; a git submodule + fixture loader is proven practice, not just for Rust.
3. **Three-layer split + facade**: `core` (shared types incl. the compiled program) / `compiler` / `runtime` / a facade crate with a curated prelude for engine-adapter authors. Maps cleanly onto `src/compile`+`src/runtime` with a documented public surface.
4. **Pull-based event API**: `continue_() -> Vec<DialogueEvent>` with each event documented as the .NET handler it replaces. Better fit for imperative loops (and for this repo's `advance()` model) than .NET's seven callbacks; `PrepareForLines` becomes an opt-in event rather than a mandatory handler.
5. **Compile contract**: `Result<Compilation, CompilerError(Vec<Diagnostic>)>` — errors throw/return, warnings collect; one `Diagnostic` struct with file/range/context/severity, rendered with a snippet renderer.
6. **Seams for state**: `VariableStorage` (single `YarnValue`, `$`-prefix enforcement, `clone_shallow` for snapshots) and `TextProvider` (base-language + translations with fallback) as interfaces rather than baked-in state.
7. **Type-reflecting function registration**: `Library::add_function` reads arity/types off the registered function (variadics included) — TS can do this better with runtime introspection/TS types.

**Avoid this**
1. **ANTLR as the parser core**: antlr-rust is pinned to an unmaintained 0.3.0-beta, drags `better_any`, blocks `no_std` for the compiler, and needs a codegen crate to regenerate. For TS the same trap applies (weak ANTLR TS tooling); this repo's hand-written parser is the better bet — but treat the `.g4` grammar as the shared contract to hand-verify against.
2. **Transliterating the whole implementation**: the Rust port carried over 2.x idioms verbatim (tracking variables for `visited`, an analyser .NET later deleted, label jumps, hash-of-file+node line IDs). A TS port targeting 3.2.2 should copy *structure and contracts*, not 2.x behavior — this port is a 2.x snapshot.
3. **Portability ambitions**: `#![no_std]`, `bevy_platform` HashMap/Arc/RwLock everywhere, wasm feature flags — enormous complexity with no bearing on a browser/Node TS target.
4. **Leaving command-execution semantics unspecified**: the `Command` event docs say "It is not specified whether the command should be finished executing before calling `continue_` again … A library wrapping Yarn Spinner should specify this." Fine for Rust's two-layer split; for TS, decide blocking-vs-async command handling in the runtime API spec rather than punting it to consumers.
5. **Diagnostics without stable codes**: the Rust port's hardcoded `Y001` id shows what happens when codes aren't part of the design — upstream's 3.2 YS00xx table is the thing to adopt (already this repo's stated direction).

## 10. Sources

- Repo clone @ `10a052c` (2026-08-11): `readme.md` (version table, work-in-progress note), `crates/{core,compiler,runtime,yarnspinner,bevy_plugin}/src/…` as cited above, `.gitmodules`, `crates/yarnspinner/tests/test_base/mod.rs` + `paths.rs`.
- README/docs links: docs.yarnspinner.dev/yarn-spinner-for-other-engines/bevy (banner "documentation for Yarn Spinner 3 is being updated"; Bevy version table), docs.rs `bevy_yarnspinner`.
- GitHub issues #232 (no-std effort, notes antlr-rust unmaintained since ~3 years) and #9 (compatibility-table issue, open since 2023).
