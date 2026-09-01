# YarnSpinner-Rust reference study

Type: research
Status: resolved
Blocked by: —

## Question

[YarnSpinnerTool/YarnSpinner-Rust](https://github.com/YarnSpinnerTool/YarnSpinner-Rust) is the official second implementation of Yarn Spinner (Rust) — the closest analogue to what this repo is doing in TypeScript. Study it as a reference: How does it structure parser/compiler/runtime? Did it keep an instruction-stream VM mirroring the .NET `Program`, or design its own IR? How does it shape its public runtime API (Dialogue equivalent, handlers, variable storage, Library), diagnostics (does it adopt YS00xx codes?), localisation/string tables, saliency strategies, and smart variables? How complete is it against 3.2.2 (what's missing or lagging)? What design lessons does it offer for a TS port — both "copy this" and "avoid this"? Cover **both** its source layout and its docs/README. This study feeds the runtime API shape decision ([05](./05-runtime-api-shape.md)) and the IR/VM fog patch on the map.

## Answer

Full findings (with per-claim sources) in [research/rust-reference-study.md](../research/rust-reference-study.md). Summary:

### Headline

YarnSpinner-Rust (crates `yarnspinner`/`bevy_yarnspinner`, v0.9, last commit 2026-08-11) is a **Yarn 2.x implementation, not a 3.x one** — the README version table maps Rust 0.9 ↔ .NET Yarn Spinner **2.5.0**, and repo-wide search finds zero occurrences of saliency, smart variables, enums, node groups/`when:`, `<<once>>`, `detour`, `NoOptionSelected`, or YS00xx codes. It is therefore a **porting-strategy reference, not a 3.2.2 feature reference**.

### Architecture

- **Crates**: `yarnspinner_core` (shared types incl. the compiled program, `YarnValue`, `Library`, type system) · `yarnspinner_compiler` (ANTLR-based; 15 ordered `compilation_steps/` + tree-walk `visitors/` ported from .NET's compiler) · `yarnspinner_runtime` (`no_std`; `Dialogue`, `virtual_machine`, `markup`, `variable_storage`, `text_provider`, `analyser`) · `yarnspinner` (facade crate with curated prelude for engine-adapter authors) · `bevy_plugin` (engine integration: `DialogueRunner`, strings-file localisation, command registry, asset providers).
- **IR/VM: kept the .NET Program verbatim** — prost-generated `Program { name, nodes, initial_values }` / `Node { name, instructions, labels }` from the same `.yarn.proto`, and the classic 2.x opcode set (`RunLine`, `AddOption`, `ShowOptions`, `Push*`, `JumpIfFalse`, `CallFunc`, `PushVariable`, `StoreVariable`, `RunNode`, …) with label jumps. No new IR. `visited()` uses 2.x-style compiler-generated `$visited_<node>` tracking variables; implicit line IDs are hash-of-file+node+count (2.x scheme).
- **Compiler API**: builder equivalent of `CompilationJob` (`Compiler::new().add_file(File{file_name, source}).extend_library(..).declare_variable(..).with_compilation_type(..).compile()`) → `Result<Compilation, CompilerError(Vec<Diagnostic>)>`; `Compilation { program, string_table, declarations, contains_implicit_string_tags, file_tags, warnings }`.
- **Diagnostics: no YS00xx codes** — one `Diagnostic { file_name, range, message, context, severity: Error|Warning }`, rendered via `annotate-snippets` with a hardcoded id `Y001`; errors returned in `Err`, warnings collected in `Compilation.warnings` (a deliberate improvement over .NET's single list).
- **Runtime API**: `Dialogue` mirrors .NET (`continue_()`, `set_selected_option`, `set_node`, `replace_program`, `node_exists`, `analyse`, …) but **handlers become return values**: `continue_() -> Result<Vec<DialogueEvent>>` with `Line | Options | Command | NodeStart | NodeComplete | LineHints | DialogueComplete`, each variant documented as the .NET handler it replaces; `PrepareForLines` → opt-in `LineHints` event via `set_line_hints_enabled`.
- **State seams**: `VariableStorage` trait (single `YarnValue` enum, mandatory `$` prefix, `clone_shallow()` for shared snapshots, `as_any` downcasting; default `MemoryVariableStorage`) and a `TextProvider` trait carrying all localisation (base-language + translation tables with fallback, `StringTableTextProvider`), so `Dialogue` itself is language-agnostic. `Library` = `YarnFnRegistry` with marker-based type reflection (variadic-capable) over `standard_library()`.
- **Localisation**: core has the string table (`StringInfo`) + TextProvider; the Bevy layer adds `.strings.csv` assets, auto-updating strings files, line-ID generation at load, and per-language audio asset providers.

### Completeness vs 3.2.2

Effectively 0% of the 3.x language surface (no enums, smart variables, node groups, saliency, `once`, `detour`/`return`, YS codes, SHA-256 line locks, type-check-only mode); its type checker is the .NET **2.x** `TypeCheckVisitor`; even 2.x has acknowledged holes (upgrade tests not ported; compatibility-doc issue open since 2023).

### Design lessons for the TS port

**Copy this**
1. **Provenance comments per file**: "Adapted from <upstream file @ pinned commit>" + a short "deliberate divergences" list — makes parity audits diffable against upstream.
2. **Upstream's test suite as fixtures**: `.gitmodules` pulls YarnSpinner .NET into `third-party/YarnSpinner`; `tests/test_base/` ports `TestBase.cs` and runs the .NET repo's own `.yarn` fixtures. This is a proven shape for our golden-test harness ticket.
3. **core / compiler / runtime / facade layering** with a curated public prelude per layer.
4. **Pull-based event API** (`continue_() -> Vec<DialogueEvent>`) instead of .NET's seven handler callbacks — a better fit for imperative loops and this repo's `advance()` model; line-hints as an opt-in event rather than a mandatory handler.
5. **Errors-in-Err / warnings-in-Ok compile contract** with one `Diagnostic` struct (file/range/context/severity, snippet-rendered).
6. **`VariableStorage`/`TextProvider` as interfaces** with `$`-prefix enforcement, `clone_shallow` snapshots, and localisation entirely behind the text-provider seam.
7. **Type-reflecting function registration** (arity/variadics read off the registered function).

**Avoid this**
1. **ANTLR as the parser core**: antlr-rust is pinned to an unmaintained 0.3.0-beta and drags codegen complexity; the same trap exists for TS (weak ANTLR tooling). Keep the `.g4` grammar as the contract, not a generated-parser dependency.
2. **Transliterating 2.x behavior**: the port carried tracking variables, label jumps, the (since-deleted) analyser, and hash line IDs verbatim. Copy structure and contracts, not a 2.x snapshot — our target is 3.2.2.
3. **Portability ambitions** (`no_std`, `bevy_platform` collections everywhere): huge complexity, irrelevant to a browser/Node target.
4. **Punting command-execution semantics to consumers**: the Rust `Command` event docs explicitly leave blocking-vs-parallel unspecified; the TS runtime API spec should decide it.
5. **Diagnostics without stable codes** (hardcoded `Y001`) — adopt upstream 3.2's YS00xx table instead (already this repo's direction).
