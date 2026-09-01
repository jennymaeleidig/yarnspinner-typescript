# Localisation mechanics deep dive

Type: research
Status: resolved
Blocked by: —

## Question

Localisation is the fork's largest absent area (audit: only implicit line IDs, no string table). Research the full mechanism in **both** official implementations — [YarnSpinnerTool/YarnSpinner](https://github.com/YarnSpinnerTool/YarnSpinner) (StringTable CSV format and columns, `///` doc comments → `comment` column, `lock` hashes, implicit vs explicit `#line:` IDs, `#shadow:` lines, `ILineTagGenerator` + `DescriptiveLineTagGenerator`, `CompilationJob` StringsOnly/type-check modes, `.yarnproject` role) and [YarnSpinnerTool/YarnSpinner-Rust](https://github.com/YarnSpinnerTool/YarnSpinner-Rust) (what it adopted, what it skipped or reshaped). Deliver: the exact string-table contract, what is compiler-time vs runtime-time, and a reasoned recommendation for what subset a **TS library without Unity project files** needs (e.g. is a `.yarnproject` equivalent in scope, or is a program+string-table compile API enough?). Feeds the localisation scope decision ([12](./12-localisation-scope.md)).

## Answer

Full findings with per-claim source citations: [research/localisation-mechanics.md](../research/localisation-mechanics.md). Gist: localisation in Yarn Spinner is three layers — the core compiler only produces a line-ID-keyed string table and rewrites sources with tags; the CSV strings files (8 columns, `lock` = first 8 hex of SHA-256, `comment` = line hashtags) and the `.yarnproject` are host-plugin artifacts, not compiler inputs; the core runtime is string-table-unaware (hosts resolve text per locale; Rust reshaped this into an injected `TextProvider`). A TS library without Unity project files needs the compiler layer plus a small CSV export/import module; it does not need a `.yarnproject` equivalent.

### The exact string-table contract

- `CompilationResult.StringTable: Map<lineID, StringInfo>`; `StringInfo = { text, fileName, nodeName, lineNumber, isImplicitTag, metadata, shadowLineID }` where `text` has inline expressions replaced by positional placeholders like `{0}` (and is null for shadow lines), and `metadata` is the line's hashtags minus `#line:`.
- Implicit IDs: `line:` + CRC32(fileName + node + stringTableCount [+ collision suffix]) — deterministic but edit-unstable; `ContainsImplicitStringTags` reports whether any were generated. Explicit `#line:<id>` used verbatim (must start with `line:`); duplicates → YS0018; multiple/combined line+shadow tags → YS0062/YS0017.
- `#shadow:<sourceID>`: own unique ID, `text = null` after validation; compile-time checks YS0042 (unknown source), YS0043 (source has expressions), YS0044 (text mismatch); shadow lines never appear in the CSV. Purely compile-time — no runtime concept.
- `CompilationType`: `FullCompilation` / `StringsOnly` (string table only, no Program/Declarations) / `TypeCheck` (declarations + string table since 3.2.1, no Program).
- `Utility.TagLines(source, excludedIDs?, generator?, abortBehaviour?)` rewrites `.yarn` sources in place via the pluggable `ILineTagGenerator` seam: `RandomLineTagGenerator` (default, `line:` + 7 hex) and `DescriptiveLineTagGenerator` (3.2.1: `line:<node>_<NNNN>[_gN][_<character>]`, gaps of 100, midpoints rounded to 5, generations when no gap).
- CSV contract (host-side, both integrations): `language,id,text,file,node,lineNumber,lock,comment`; one file per language; `lock` = first 8 hex of SHA-256 of base text (staleness marker — base lock ≠ translated lock → NEEDS UPDATE); `comment` = "Line metadata: <hashtags>" (translator-editable); translated rows are never deleted; shadow rows excluded.
- `.yarnproject`: JSON (projectFileVersion 4, sourceFiles globs, excludeFiles, baseLanguage, localisation map {strings, assets}, definitions). Consumed only by the Unity importer / Bevy plugin to drive CompilationJobs and CSV sync — the core compiler takes raw `{fileName, source}` inputs.
- Runtime: core `Dialogue` emits `Line { ID, Substitutions }` and knows nothing of string tables or languages; hosts resolve text per locale. `PrepareForLinesHandler` = lookahead line IDs for preloading. Rust reshaped: `TextProvider` trait injected into `Dialogue` (`accept_line_hints`/`get_text`/`set_language`/`are_lines_available`), `Line = { id, text, attributes }` with text already substituted + markup-parsed, separate text-language vs asset-language.
- Rust adoption matrix: adopted the string table, ID algorithms, CSV + lock, `.yarnproject`, `tag_lines`; skipped `#shadow:` entirely, `ILineTagGenerator`/Descriptive tagger, and the `TypeCheck` rename; reshaped runtime text resolution into `TextProvider`.

### What is compiler-time vs runtime-time

- **Compiler-time**: line ID assignment (implicit + `#line:`), `#lastline`, `#shadow:` validation, `CompilationType` modes, `TagLines` source rewriting, string-table construction. All of it must exist for language parity.
- **Export-time (host)**: CSV generation/parsing, lock hashes, translation sync workflow, `.yarnproject`, line tagging via editor buttons.
- **Runtime-time**: locale selection and text lookup (host in C#, `TextProvider` in Rust), substitution + markup parsing of the resolved text, `PrepareForLines`/LineHints lookahead.

### Recommendation for yarn-spinner-runner-ts (TS library, no Unity files)

1. **Adopt the compiler layer in full** (this is language parity, not optional tooling): `StringInfo`-shaped string table on compile results, implicit-ID generation (match upstream's `line:`+CRC32 scheme — cheap and makes IDs deterministic across compilations), explicit `#line:` handling + YS0018/17/62 diagnostics, `#lastline`, and `#shadow:` with the YS0042/43/44 checks (it's 3.2 syntax; scripts using it must compile identically).
2. **Expose `containsImplicitStringTags` and two compile modes** on the compile API: full and strings-only (a type-check mode belongs to the diagnostics ticket). This is the program + string-table compile API the question asks about — it is sufficient.
3. **Ship a small dependency-free CSV module** (read + write the 8-column format, `lock` = first 8 hex of SHA-256) — it's the de-facto translator interchange format for *both* official integrations, so a TS library that can't export it can't participate in any localisation pipeline. Include a `tagLines(source, {generator})` utility with the random generator (Descriptive optional/later); the seam is ~2 methods.
4. **No `.yarnproject` equivalent in scope.** It's an editor/plugin artifact; upstream's own core compiler never sees it. A glob-loading convenience wrapper can be a later add-on, not core.
5. **Keep the runtime string-table-agnostic, upstream-shaped**: accept a line-text provider (base table + optional translation table, `setLanguage`, line-hints callback mirroring `PrepareForLines`) as an injectable seam, with base language = text from the script. This matches both upstream runtimes and slots into the runtime-API-shape decision already on the map.
6. Fix the fork's current implicit-ID scheme (`line:<global-counter-hex>` — not deterministic per file/node and collisions across files are likely) as part of (1).

### Corrections to census folklore

- `///` doc comments attach to **declarations** (`Declaration.Description`) in 3.x, **not** to lines; the CSV `comment` column = line hashtag metadata.
- The CSV has **8** columns (`comment` included); `lock` is SHA-256-based.
- Core `Dialogue` has no `LanguageCode` property in 3.2.2; language selection is host-side.
