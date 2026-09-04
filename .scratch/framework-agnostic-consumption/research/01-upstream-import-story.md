# Research note 01 — Upstream reference: how Yarn Spinner itself handles `.yarn` / `.yarnproject` import

Ticket: `issues/01-upstream-import-story.md` · Researched against primary sources only.

## Sources

All source files fetched from the `main` branch of each repo on 2026-02-13 (core tree commit `ec1a680fae4c0fc8aae73b23c7b87f3e5f894100`). Per-claim citations are inline as `[S#]` pointing at URLs; line references are to the files as fetched.

| # | Source |
|---|--------|
| S1 | `YarnSpinnerTool/YarnSpinner` — core compiler/runtime. README (no Unity code in this repo; Unity integration is a separate repo): <https://github.com/YarnSpinnerTool/YarnSpinner> |
| S2 | `YarnSpinnerTool/YarnSpinner-Unity` — Unity integration (UPM package). README: <https://github.com/YarnSpinnerTool/YarnSpinner-Unity> |
| S3 | `YarnSpinnerTool/YarnSpinner-Console` — `ysc` CLI. README + `src/YarnSpinner.Console/YarnSpinnerConsole.cs`, `src/YarnSpinner.Console/Commands/*.cs`: <https://github.com/YarnSpinnerTool/YarnSpinner-Console> |
| S4 | Unity importer: `YarnSpinner-Unity/Editor/Importers/YarnProjectImporter.cs` <https://raw.githubusercontent.com/YarnSpinnerTool/YarnSpinner-Unity/main/Editor/Importers/YarnProjectImporter.cs> |
| S5 | Unity import-data record: `YarnSpinner-Unity/Editor/Importers/ProjectImportData.cs` <https://raw.githubusercontent.com/YarnSpinnerTool/YarnSpinner-Unity/main/Editor/Importers/ProjectImportData.cs> |
| S6 | Project-file parser (core): `YarnSpinner.Compiler/Project.cs` <https://raw.githubusercontent.com/YarnSpinnerTool/YarnSpinner/main/YarnSpinner.Compiler/Project.cs> |
| S7 | Project-file JSON schema v4 (core): `YarnSpinner.Compiler/YarnProject.schema.json` <https://raw.githubusercontent.com/YarnSpinnerTool/YarnSpinner/main/YarnSpinner.Compiler/YarnProject.schema.json> (`$id` `https://schemas.yarnspinner.dev/yarnproject.schema.json`) |
| S8 | Example v4 project file (core tests): `Tests/Projects/Space/Space.yarnproject` <https://raw.githubusercontent.com/YarnSpinnerTool/YarnSpinner/main/Tests/Projects/Space/Space.yarnproject> |
| S9 | Official docs, "Unity Projects + Yarn Spinner": <https://docs.yarnspinner.dev/yarn-spinner-for-unity/yarn-spinner-in-unity-scenes/yarn-projects.md> |
| S10 | CLI project→compilation-job wiring: `YarnSpinner-Console/src/YarnSpinner.Console/Commands/CompileCommand.cs` <https://raw.githubusercontent.com/YarnSpinnerTool/YarnSpinner-Console/main/src/YarnSpinner.Console/Commands/CompileCommand.cs> |

## Upstream repo map (where things actually live)

- The compiler/runtime core (`Yarn.Compiler`, `Yarn`) is its own repo, `YarnSpinner` [S1]. The `.yarnproject` parser *and its JSON schema* live in the core compiler (`YarnSpinner.Compiler/Project.cs`, `YarnSpinner.Compiler/YarnProject.schema.json`) [S6, S7] — so project-file semantics are engine-agnostic by construction.
- Unity-specific import lives in `YarnSpinner-Unity` under `Editor/Importers/` (`YarnProjectImporter.cs`, `YarnImporter.cs` for `.yarn`, `ProjectImportData.cs`) [S2, S4, S5].
- There is no v1 JSON project format: v1 Yarn Projects were special `.yarn` files with Unity metadata; the importer detects `title:`-prefixed project files and reports `NeedsUpgradeFromV1` [S4, S6].

## 1. How Unity's `YarnProjectImporter` turns `.yarnproject` into a compiled asset

`YarnProjectImporter` is a Unity `ScriptedImporter` registered for the `yarnproject` extension (`[ScriptedImporter(7, new[] { "yarnproject" }, 1000)]`); Unity calls `OnImportAsset` whenever the file (or a dependency) changes [S4].

The import pipeline, in order [S4]:

1. **Always produce an asset, even on failure.** A `YarnProject` ScriptableObject is created and set as the main object before any parsing, "no matter what … so that other assets don't lose their references." Only then does it load the project file (`Yarn.Compiler.Project.LoadFromFile`). If loading throws, it records `ImportStatus` (`NeedsUpgradeFromV1` if the text starts with `title:`, else `Unknown`) and returns [S4; status enum in S5].
2. **Record project metadata into `ProjectImportData`** (a second sub-asset): `sourceFilePatterns`, `baseLanguageName`, and one `LocalizationEntry` per entry in the project's `localisation` map. A `strings` path starting with `unity:` means "external Unity Localization asset" (resolved by GUID); otherwise the strings CSV and assets folder are resolved to `TextAsset`/`DefaultAsset` references. If the base language has no `localisation` entry, an implicit base-localisation entry is added [S4, S5].
3. **Declare file dependencies.** Each resolved source file gets `ctx.DependsOnSourceAsset(scriptPath)`, so editing any included `.yarn` re-imports (recompiles) the project [S4]. Docs confirm: "When you make changes to the script, the Yarn Project will automatically be re-imported" [S9].
4. **Compile the whole project at import time.** `CompilationJob.CreateFromFiles(project.SourceFiles)` with `job.LanguageVersion = project.FileVersion` (the project file's `projectFileVersion`) [S4]. Host function declarations are injected into the job before compiling: Unity actions registered via `IActionRegistration`/`RegistrationType.Compilation` are converted to `Declaration`s (`FunctionDeclarationReceiver`) [S4]. `ysc` does the analogous thing with `.ysls.json` definitions files [S10].
5. **Diagnostics surfacing.** Errors are grouped by `Diagnostic.FileName`; each error is logged via `ctx.LogImportError` with a clickable file link and 1-based line number (`error.Range.Start.Line + 1`), plus stored in `importData.diagnostics` as `DiagnosticEntry { yarnFile, errorMessages }`. Diagnostics with no file, or file name `"(unknown)"`, are logged without a link. On any error: `ImportStatus = CompilationFailed` and the program is *not* stored. Warnings are logged the same way but do not fail the import [S4].
6. **Store the compiled program as bytes.** On success, `compilationResult.Program.WriteTo(CodedOutputStream)` (Protobuf) is stored as `projectAsset.compiledYarnProgram` (a `byte[]` embedded in the asset) [S4]. The runtime `YarnProject` thus ships pre-compiled bytecode; there is no runtime compile in Unity.
7. **Also store declarations and string-table data.** All variable declarations (minus compiler-internal `$Yarn.Internal.*` and `FunctionType` declarations) are serialized into `ProjectImportData.serializedDeclarations`; `containsImplicitLineIDs = compilationResult.ContainsImplicitStringTags` is recorded [S4].
8. **Localisation.** Without Unity Localization, `CreateYarnInternalLocalizationAssets(...)` builds Yarn's own `Localization` assets from the compilation result's string table (`localizationType = YarnInternal`); with Unity Localization installed and enabled, the string table is populated later by an asset post-processor (`localizationType = Unity`) [S4]. The editor also runs a strings-only compilation (`CompilationJob.Type.StringsOnly`) to produce the inspector's string table [S4].
9. **Unity-only extras**: optional generation of a C# variables class (`generateVariablesSourceFile`, `variablesClassName/Namespace/Parent`), Addressables flag, custom line tagger selection [S4, S9].

Side note — how a `.yarn` file participates: `YarnProjectImporter.GetProjectReferencesYarnFile` loads the project and checks whether the script's path is in `project.SourceFiles`; a `.yarn` can be included by more than one project [S4, S9].

## 2. The v4 `.yarnproject` schema and its semantics

`projectFileVersion` history: 2 = Yarn Spinner 2.0, 3 = Yarn Spinner 3.0, 4 = Yarn Spinner 3.2.0; `CurrentProjectFileVersion = 4` [S6]. Loading rejects a file whose version is **greater than** 4 (`Project.LoadFromString`) [S6]. Version 1 was not JSON (see above) [S4, S6].

Required fields: `projectFileVersion`, `sourceFiles`, `baseLanguage` [S7, S6]. JSON parsing is camelCase, case-insensitive, allows trailing commas and comments (they are skipped) [S6].

### Fields (schema v4 [S7], parser [S6], example [S8])

- **`sourceFiles`** (array of strings, default `["**/*.yarn"]`): glob patterns for included `.yarn` files, **relative to the directory containing the `.yarnproject`** (the "search directory" is the project file's parent) [S6, S9]. Resolution uses `Microsoft.Extensions.FileSystemGlobbing.Matcher` with `sourceFiles` as include patterns and `excludeFiles` as exclude patterns, case-insensitive [S6]. Docs document the pattern dialect: `*` (any filename), `**/*` (any path including subdirectories), `..` (parent folder); duplicate matches are included once; a script may be in multiple projects [S9]. Absolute paths ending in `.yarn` inside `sourceFiles` are added verbatim (the globber can't match them) [S6].
- **`excludeFiles`** (array of strings, no default): excludes files even if matched by `sourceFiles` [S6, S7]. CLI `create-proj --unity-exclusion` sets excludes for folders with a trailing `~` (a Unity convention) — an example of engine-specific convention kept out of the core schema [S3].
- **`baseLanguage`** (string, default `"en"`): BCP-47-ish language code of the language the scripts are written in; the parser's programmatic default is the machine's current neutral culture, and docs say the editor defaults to the computer's locale [S6, S7, S9].
- **`localisation`** (object mapping language code → `{ strings?, assets? }`): `strings` is the path to a translated-strings CSV, `assets` a directory of localised assets. Paths are relative to the project file [S7, S6 (`LocalizationInfo { Assets, Strings }`), S8]. Unity resolves `unity:`-prefixed `strings` values as references to external Unity Localization assets — that prefix convention is *Unity-side*, not in the core schema [S4].
- **`definitions`** (string **or** array of strings — new in v4, via `StringOrListOfStringsConverter`): path(s)/glob(s) to `.ysls.json` files declaring custom commands/functions for tooling. Supports a `${workspaceRoot}` placeholder (replaced with a workspace root supplied by the tool, e.g. the language server) [S6, S7]. `ysc` parses the definitions file's `Functions` array (YarnName, ReturnType, Parameters, Documentation) into compiler variable/function declarations for the compilation job [S10].
- **`compilerOptions`** (object, `additionalProperties: true`): options affecting compilation "used by all parts of the Yarn Spinner pipeline". The schema documents `requireVariableDeclarations` (bool, default false) and `allowPreviewFeatures` (bool, default false) [S7]. The core parser models this as an open bag: `CompilerOptionsData` has `diagnosticsSeverity` (map of diagnostic code → severity override) plus `JsonExtensionData` for everything else; `allowPreviewFeatures` is explicitly wired (`AllowLanguagePreviewFeatures` reads it from the extension data), other flags are read by consumers of the bag [S6]. `ysc run`/`dump-code` expose `--allow-preview-features` on the CLI side [S3].
- **`editorOptions`** (object, `additionalProperties: true`): per-editor sub-objects (e.g. `yarnScriptEditor`) for tooling configuration [S7].
- **`projectName`, `authorName`**: display metadata only [S7].
- Unknown keys at the root: schema says `additionalProperties: false`; the parser keeps them in `ExtensionData` rather than erroring [S6, S7] (parser is more lenient than the schema — a useful precedent for a tolerant web loader).

Example v4 file from upstream tests [S8] shows the whole surface compactly: `projectFileVersion: 4`, `sourceFiles: ["**/*.yarn"]`, `baseLanguage: "en"`, `localisation` with `en`/`de` entries (`strings: "../German.csv"`, `assets: ...`), and `definitions: "Commands.ysls.json"`.

Implicit projects: a `Project` with a path that doesn't exist on disk is "implicit" — tools like the language server synthesise one for a folder of `.yarn` files with no `.yarnproject` [S6]. Relevant precedent for this repo's "import a bare `.yarn` without a project file" path.

## 3. Non-Unity ahead-of-time compile path: `ysc` (YarnSpinner-Console)

Upstream does ship an engine-independent AOT path — the `ysc` CLI [S3, S10]:

- **`compile`** takes either a collection of `.yarn` files *or a single `.yarnproject`* (argument description: "The .yarnproject file to compile, or a collection of .yarn files") [S10]. For a `.yarnproject`: `Project.LoadFromFile` → `CompilationJob.CreateFromFiles(project.SourceFiles)` → `job.LanguageVersion = project.FileVersion` → parse the project's `definitions` file(s) into function declarations → compile [S10]. `ysc` additionally injects built-in declarations for `visited`, `visited_count`, `has_any_content` [S3, `YarnSpinnerConsole.cs`].
- **Outputs**: one `{name}.yarnc` file (the compiled `Program` serialized via Protobuf), `{name}-Lines.csv` (columns `id, text, file, node, lineNumber`) and `{name}-Metadata.csv` (`id, node, lineNumber, tags`, minus `line:` metadata) [S10, S3]. `--stdout` instead emits a machine-readable JSON rendering of a `CompilerOutput` proto (program + strings + diagnostics, each diagnostic with file, range, severity) [S10]. Exit code 1 and no output files when any error-severity diagnostic is present [S10].
- **Other project-aware commands**: `list-sources <input.yarnproject>` resolves includes/excludes to the concrete file list (explicitly provided so users "can make sure you have set your globstar values correctly") [S3]; `run`, `print-tree`, `print-tokens`, `tag` (adds `#line:` tags in place or to an output dir), `extract`, `graph`, `dump-code`, `browse-binary` (parses a `.yarnc` protobuf and prints nodes + variable defaults) [S3].
- **No watch mode, no editor**: `ysc` is a batch tool; the compile-on-change loop in Unity comes from the AssetDatabase dependency graph, not from the compiler [S3, S4].

## 4. What the web-bundler/Vite-plugin design should inherit vs. keep out

### Inherit (engine-agnostic upstream semantics)

- **Compile-at-import as the default.** Unity compiles the full project during import and stores bytecode on the asset; `ysc compile` does the same ahead of time [S4, S10]. This is exactly the locked decision in the map (default `.yarn` import → build-time-compiled `Program`). The plugin's `load`/`transform` hook is the direct analogue of `OnImportAsset`.
- **Parse `.yarnproject` with the core semantics, not Unity's**: required fields `projectFileVersion`/`sourceFiles`/`baseLanguage`; `sourceFiles`/`excludeFiles` as globs rooted at the project file's directory; duplicate matches collapsed; reject `projectFileVersion > 4`; tolerate unknown keys (collect, don't throw) [S6, S7]. This repo already mirrors much of this (`src/compile/yarnProject.ts` has `parseYarnProject`, `listSources`), so the plugin should delegate to it rather than re-implement.
- **`LanguageVersion = project.FileVersion`** flows into the compilation job [S4, S10].
- **Localisation semantics**: `localisation` map → strings CSV + assets dir per language; implicit base-language entry when the map lacks the base language; base language drives the default string table [S4, S6]. (`src/compile/projectLocalisation.ts` already implements the loading side.)
- **External declarations injection point**: both engines inject host-declared functions into the compilation job before compiling — Unity via action registration [S4], `ysc` via `.ysls.json` definitions [S10]. The plugin should have the same seam (e.g. plugin options passing declarations).
- **Diagnostics discipline**: errors grouped per source file with file + 1-based line, severity-distinct; errors block output, warnings don't [S4]. For Vite, the analogue is throwing a build error / surfacing via the overlay with file+line — same grouping, different transport.
- **Source-list resolution as its own inspectable step**: upstream exposes `list-sources` precisely so users can debug glob config [S3]; a plugin/virtual-module contract should do the same (this repo's `listSources` maps 1:1).
- **`ContainsImplicitStringTags` surfaced** on the result (Unity stores `containsImplicitLineIDs`) [S4] — worth carrying into the plugin's emitted virtual module so hosts can warn.

### Deliberate divergences (defensible, but they *are* divergences)

- **"Always emit an asset, even on failure"** [S4] is Unity's reference-stability requirement. In a bundler the better default is fail-the-build (or emit + fail in dev), since there are no asset references to preserve. Flag for ticket 03 rather than silently inheriting.
- **Protobuf `.yarnc` binary output** [S10] is an interop format for C# runtimes. A web plugin should emit whatever this repo's `Program` representation is (JS module), not protobuf.
- **HMR**: upstream has nothing to copy — Unity's recompile-on-change comes from the AssetDatabase [S4, S9], `ysc` is batch-only [S3]. The open map item "HMR for `.yarn` files" has no upstream answer; it's genuinely novel design space, though `ctx.DependsOnSourceAsset` shows the *semantics* wanted: any changed included `.yarn` invalidates the whole project's compilation.

### Unity-specific — must not leak into the web bundler

- **`ScriptedImporter`/AssetDatabase mechanics**: importer version numbers, GUID-based references, `ctx.LogImportError`, `TextAsset`/`DefaultAsset` wrappers, sub-asset `ProjectImportData`, dependency-based reimport [S4, S5].
- **`unity:`-prefixed strings paths** (external Unity Localization asset references) and the whole Unity Localization post-processor flow (`localizationType = Unity`) [S4].
- **Addressables** (`useAddressableAssets`) and Yarn-internal Unity `Localization` asset construction [S4].
- **C# variable-class code generation** (`generateVariablesSourceFile`, `variablesClassName/Namespace/Parent`) [S4].
- **Reflection-based action registration** as the declarations source (web hosts will pass declarations via plugin options instead; keep the seam, not the mechanism) [S4].
- **Trailing-`~` folder exclusion** (`create-proj --unity-exclusion`) — Unity folder convention, opt-in even upstream [S3].
- **`NeedsUpgradeFromV1` handling** (project-as-`.yarn`-file format) — irrelevant for web unless someone imports ancient projects [S4].

## Answers to the ticket's focus questions, in one line each

1. **How Unity imports**: a `ScriptedImporter` on `.yarnproject` parses the project file, resolves source globs, compiles everything in-process at import time (`CompilationJob` with `LanguageVersion` from the file), logs per-file diagnostics, and embeds the Protobuf-serialized program plus declarations and string-table data in the resulting asset [S4].
2. **v4 schema semantics**: required `projectFileVersion`(≤4)/`sourceFiles`(globs, project-relative)/`baseLanguage`; `excludeFiles` subtracts; `localisation` maps language → strings CSV + assets dir; `definitions` (string|list of `.ysls.json`, `${workspaceRoot}` aware); open `compilerOptions` bag (`diagnosticsSeverity`, `allowPreviewFeatures`, `requireVariableDeclarations`) and per-editor `editorOptions` [S6, S7, S8].
3. **Non-Unity AOT path**: yes — `ysc compile` accepts a `.yarnproject` or `.yarn` files and emits a compiled program + strings/metadata CSVs (or JSON on stdout), plus `list-sources` for glob debugging; no watcher [S3, S10].
4. **Inherit vs don't leak**: inherit compile-at-import, project-file parsing semantics, LanguageVersion plumbing, localisation map handling, declarations seam, per-file diagnostic grouping, inspectable source resolution; keep out GUIDs/asset wrappers, `unity:` external-localisation convention, Unity Localization/Addressables, C# codegen, reflection-based action registration, protobuf output, and Unity folder conventions [S3, S4, S10].
