# Research: Localisation mechanics in Yarn Spinner 3.2.2 (C#) and YarnSpinner-Rust

> Research ticket [11](../issues/11-localisation-mechanics.md). Sources: YarnSpinnerTool/YarnSpinner @ `main` (3.2.2 line, Aug 2026), YarnSpinnerTool/YarnSpinner-Unity @ `main`, YarnSpinnerTool/YarnSpinner-Rust @ `main`, docs.yarnspinner.dev (3.x pages). All file references are to those repos unless noted.

## 1. The big picture: three layers

Localisation is split across three layers, and *only the first one is in the core compiler package* (`YarnSpinner`/`YarnSpinner.Compiler` NuGet):

| Layer | Owner (C# world) | What it does |
|---|---|---|
| **Compiler-time** | core `YarnSpinner.Compiler` | Tag every line with a unique line ID; produce `CompilationResult.StringTable` (ID → `StringInfo`); validate `#shadow:` lines |
| **Export / interchange** | host integration (Unity `YarnProjectImporter`, Bevy plugin in Rust) | Turn the compiled string table into translator-facing **CSV strings files** (with `lock` hash + `comment` columns), keep them in sync as `.yarn` files change |
| **Runtime** | core `YarnSpinner` runtime + host | Core `Dialogue` emits `Line { ID, Substitutions }` and is **string-table-unaware**; the *host* looks up text for the active locale (Unity `LocalizedLine`/LineProvider; Rust injects a `TextProvider` into `Dialogue`) |

Source: `YarnSpinner/Dialogue.cs` ("Because the Dialogue class is designed to be unaware of the contents of the string table…"), `YarnSpinner.Compiler/StringTableManager.cs`, `YarnSpinner-Unity/Runtime/YarnProject/StringTableEntry.cs`.

## 2. The compiler-time string table contract

### 2.1 `StringInfo` — one entry per line of user-visible text

`YarnSpinner.Compiler/StringInfo.cs`: the compiler's string table is `IDictionary<string /*lineID*/, StringInfo>` with:

- `text` — the line's original source text, with `{expr}` inline expressions **replaced by positional placeholders** (`{0}`, `{1}`, … via `StringTableGeneratorVisitor.GenerateFormattedText`, which also counts expressions). **`null` for shadow lines** (their content comes from the source line).
- `fileName`, `nodeName`, `lineNumber` — provenance.
- `isImplicitTag` — `true` if the compiler generated the line ID.
- `metadata` — every hashtag on the line **except** the `#line:` tag itself (includes auto-added `#lastline` and `#shadow:…`? no — `#shadow:` is extracted into `shadowLineID`; `metadata` is the remaining hashtags).
- `shadowLineID` — the ID of the source line this line shadows, or `null`.

### 2.2 Implicit vs explicit line IDs

- **Explicit**: a `#line:<id>` hashtag on the line/option. The ID is used **verbatim** — it must already start with `line:` (compiler matches tags by prefix, `Compiler.GetContentIDTags`).
- **Implicit**: `StringTableManager.RegisterString` generates
  `"line:" + ["sh_" if shadow] + CRC32(fileName + nodeName + stringTable.Count [+ collision counter])`
  — a CRC32 checksum (hex) over file name + node name + the running string count, with a numeric suffix retried up to 1000 times on collision (`StringTableManager.cs`, `YarnSpinner/CRC32.cs`). Deterministic for unchanged input, but *not* stable across edits — which is exactly why `ContainsImplicitStringTags` exists and why the taggers below exist.
- Duplicate explicit IDs: **YS0018 DuplicateLineID** on both occurrences (`StringTableGeneratorVisitor.cs`).
- A line may not carry multiple `#line:`/`#shadow:` tags: **YS0062 MultipleLineOrShadowIDsOnALine**, and never both a `#line:` and a `#shadow:`: **YS0017**.
- `#lastline` is auto-added to the metadata of the line immediately preceding an options block (`LastLineBeforeOptionsVisitor`) — not emitted when a command/`if` sits between line and options.
- Special case: `GetStringIDForNode` (runtime) returns `"line:" + nodeName` for nodes whose `tags:` header contains `rawText` — the node's full source text is stored in the string table under that ID (`Dialogue.cs`, `Compiler.GetLineIDForNodeName`).

### 2.3 `#shadow:` lines (compile-time feature; not a runtime concept)

From `Compiler.cs` (~line 147) + `StringTableGeneratorVisitor.cs` + docs Shadow Lines page:

- A line with `#shadow:<sourceID>` reuses another line's content. The shadow line gets its **own** unique line ID (generated like any other, prefixed `sh_` if implicit) but its `text` is set to `null` after validation, and the VM plays the *source* line's ID.
- Constraints enforced at compile time:
  - source line must exist → **YS0042 UnknownLineIDForShadowLine**;
  - source must have **no inline expressions** → **YS0043 ShadowLinesCantHaveExpressions**;
  - shadow text must be **byte-identical** to source text → **YS0044 ShadowLinesMustHaveSameTextAsSource**;
  - may not combine with `#line:` on the same line → YS0017.
- Allowed difference: hashtags (a shadow line may carry different metadata than its source).

### 2.4 `CompilationType` and what each mode emits

`CompilationJob.cs` + `Compiler.cs`:

- `FullCompilation` → `Program` + `StringTable` + `Declarations` + everything.
- `StringsOnly` → stops right after string-table registration; returns `StringTable`, `ContainsImplicitStringTags`, `Diagnostics`, `NodeMetadata`; **no** `Program`, **no** `Declarations`.
- `TypeCheck` (3.2 renamed from the now-obsolete `DeclarationsOnly`) → stops after the type checker; returns `Declarations`, `UserDefinedTypes`, **and (since 3.2.1) the `StringTable`**, `FileTags`, `Diagnostics`; no `Program`.
- Compilation always produces the string table (unless it bails on errors); `Program` is null on errors or non-full modes.

### 2.5 Line tagging (`Utility.TagLines` + `ILineTagGenerator`)

`YarnSpinner.Compiler/Utility.cs` + `LineTaggers/`:

- `Utility.TagLines(file|source, excludedLineIDs?, lineTagGenerator?, tagAbortBehaviour?)` parses the source, finds every user-visible line (lines, options, shortcut options) lacking a `#line:` tag, asks the generator for a new ID, and **rewrites the source text** in place, returning `(ModifiedSource, LineIDs, TagExceptions)`. It aborts before tagging if the file has parse errors (`CompilationTagException`).
- `ILineTagGenerator` (3.2.0): two methods — `PrepareForLines(Dictionary<node, List<LineTagContext>>, HashSet<string> excludedIDs)` (a pass to gather context; `LineTagContext` exposes the parse tree, line number, formatted line text, existing `LineID`) and `GenerateLineTag(node, lineIndex)` (must return an ID beginning `line:`). `TagAbortBehaviour` = `EntireTagging | CurrentNode | CurrentLine` (3.2.1); failures raise `LineTaggingException` (with `SourceFile`/`LineNumber`).
- **`RandomLineTagGenerator`** (default): `"line:" + 7 hex chars` (`{0:x7}` of a random 0..0xFFFFFF), collision-checked against all known IDs, 500 ms search cap.
- **`DescriptiveLineTagGenerator`** (3.2.1): `"line:<node>_<NNNN>[_gN][_<CharacterName>]"` — node title, a 4-digit sequence number starting at 0100 and stepping by `IndexMultiplier=100`, inserted lines get midpoints (rounded to a multiple of `RoundFactor=5`), `_gN` generation suffixes when no gap remains, and the speaker character's name (whitespace-stripped) taken from the line's parsed `[character]` markup attribute. Descending/misordered existing tags raise a tagging exception.
- Unity (Inspector "Add Line Tags") and the VS Code extension both drive this API; **custom taggers are host-side only** (docs: "Custom taggers are currently only available in Yarn Spinner for Unity").

## 3. The strings-file (CSV) contract

The CSV never exists inside the core compiler — it is produced by host integrations from `CompilationResult.StringTable`. Both official integrations emit the **same 8 columns**:

```
language,id,text,file,node,lineNumber,lock,comment
```

- Unity: `YarnSpinner-Unity/Runtime/YarnProject/StringTableEntry.cs` (`CreateCSV`/`ParseFromCSV`, CsvHelper, invariant culture). Note the header is `lineNumber` (camelCase).
- Rust/Bevy: `crates/bevy_plugin/src/localization/strings_file/asset.rs` — same columns via serde+csv, but the header is `line_number` (snake_case — a deliberate divergence, confirmed in the docs example CSV).
- Rows sorted by file, then line number (Rust); entries with `text == null` (shadow lines) are excluded (Unity filters `s.Value.text != null`).
- **`lock`**: `YarnImporter.GetHashString(text, 8)` = **first 8 hex chars of the SHA-256 of the line's base-language text** (`YarnProjectImporter.cs` ~1576; Rust `Lock::compute_from` — documented as "Adapted from YarnSpinner-Unity"). The base CSV is regenerated on every import, so `lock` changes whenever base text changes; a translated row whose `lock` differs from the base row is stale.
- **`comment`**: not `///` doc comments — it is the line's **hashtag metadata** (all tags except `#line:…`), rendered as `"Line metadata: tag1 tag2 …"` (`GenerateCommentWithLineMetadata`; Rust `read_comments`). Translators may edit the `comment` column; the Rust updater preserves a translator-written prefix and re-appends metadata on sync.
- **Translation workflow (Rust, `strings_file/asset.rs` + Bevy docs "Localisations")**: per-language CSV `<lang>.strings.csv`; on recompile, new lines are appended; edited-and-untranslated lines are overwritten; edited-but-translated lines get a `(NEEDS UPDATE) ` prefix; untranslated deleted lines are removed; **translated lines are never deleted**; `DevelopmentFileGeneration::None` turns the file-writing off for release builds (missing translations fall back to base language).

## 4. The `.yarnproject` role

- Format: JSON, `projectFileVersion` (v3 schema in compiler repo, v4 = current, `Project.CurrentProjectFileVersion`), `sourceFiles` glob list (default `**/*.yarn`), `excludeFiles`, `baseLanguage` (BCP-47, default `en`), `localisation` map (`{ "<lang>": { "strings": path?, "assets": path? } }`), optional `definitions` (`.ysls` files), plus free-form extension data (`Project.cs`, `yarnproject-v3.schema.json`).
- Who consumes it: **host tooling and the plugin layer** — Unity importer (drives CompilationJob construction, base CSV generation, `Add Line Tags`, asset dirs) and the Rust `Project` (`crates/compiler/src/project.rs`, same fields, glob resolution via GlobSet). The **core compiler never sees it**: `CompilationJob` takes raw `{FileName, Source}` inputs. `.yarnproject` is a project-management artifact, not a compile input.

## 5. Runtime-time localisation

- **Core C#**: `Dialogue` has no language and no string table. VM emits `Line { ID, Substitutions }` (`Dialogue.cs` line struct); the host's LineProvider resolves text per locale (Unity `LocalizedLine` with `Text`, `Metadata`, assets). `Dialogue.PrepareForLinesHandler` fires with all line IDs in the node being started (lookahead for preloading voice assets — `VirtualMachine.cs` ~368). `Dialogue.GetStringIDForNode` returns the rawText ID. **No `LanguageCode` property exists on core 3.2.2 `Dialogue`** (that's Unity-side) — correction to the census.
- **Rust (reshaped)**: `Dialogue` takes an injected `TextProvider` trait (`crates/runtime/src/text_provider.rs`): `accept_line_hints(line_ids)` (= PrepareForLines), `get_text(id)`, `set_language(Option<Language>)`, `are_lines_available()`. Default `StringTableTextProvider` holds a base table plus one translation table; base language = text straight from the Yarn files. The emitted `Line` is `{ id, text, attributes }` — text already resolved, substitutions expanded, markup parsed *inside* the runtime (`line.rs`: "we don't require consumers to manually fetch from string tables"). Bevy's `DialogueRunner` exposes `set_language` / `set_text_language` / `set_asset_language` separately (text locale vs voice-over locale).

## 6. What YarnSpinner-Rust adopted / skipped / reshaped

| Mechanism | C# 3.2.2 | Rust |
|---|---|---|
| String table (ID → StringInfo) | core compiler | **Adopted 1:1** (`string_table_manager.rs`, identical CRC32 implicit-ID algorithm) |
| Implicit line ID algorithm | `line:` + CRC32(file+node+count) | **Adopted** (`crc32fast`, same seed, same 1000-attempt cap) |
| Explicit `#line:`, duplicates, `#lastline` | yes | **Adopted** |
| `#shadow:` lines + YS0042/43/44 validation | yes | **Skipped entirely** (no `shadow` anywhere in `crates/`) |
| `CompilationType` | `FullCompilation` / `TypeCheck` / `StringsOnly` | **Adopted, older shape**: `FullCompilation` / `DeclarationsOnly` / `StringsOnly` (no `TypeCheck` rename) |
| `Utility.TagLines` + `ILineTagGenerator` seam | yes, pluggable | **Adopted `tag_lines`, skipped the seam** — no trait, no Descriptive tagger; random-style IDs only |
| CSV strings file (8 columns) | host (Unity) | **Adopted in bevy_plugin**, same columns (`line_number`), same lock hash, full NEEDS-UPDATE sync workflow |
| `///` doc comments | declarations only (`Declaration.Description`) | Adopted for declarations; **not** for lines (comment column = hashtags, same as Unity) |
| `.yarnproject` | compiler `Project` class + Unity importer | **Adopted** (`Project` with sourceFiles/baseLanguage/localisation/definitions/projectFileVersion; plugin consumes) |
| Runtime string table | host-side (Unity LineProvider) | **Reshaped**: `TextProvider` injected into `Dialogue`; `Line` carries resolved text; `LineHints` event replaces PrepareForLines; text-language vs asset-language split |

## 7. Corrections to baseline census (ys322-census.md §3)

1. **"`///` doc comments above lines become the CSV `comment`" is wrong for 3.x.** `///` comments attach to *declarations* (`Compiler.GetDocumentComments`, used by `TypeCheckerListener` → `Declaration.Description`). The CSV `comment` column carries the line's **hashtag metadata** ("Line metadata: …"). (Possibly true in 2.x; it is not the 3.2.2 contract.)
2. **"columns `language, id, text, file, node, lineNumber, lock`"** — there are **8** columns; `comment` is part of the contract, and `lock` is **SHA-256** (first 8 hex), not CRC-based.
3. **`Dialogue.LanguageCode`** — no such property on core 3.2.2 `Dialogue`; language selection lives in hosts (Unity LineProvider; Rust `TextProvider`).
4. Random tagger emits **7** hex chars per source (`{0:x7}`), though docs examples show 8 (`c792e31a`).
