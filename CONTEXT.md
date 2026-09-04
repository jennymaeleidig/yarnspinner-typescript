# yarn-spinner-runner-ts

TypeScript parser, compiler, and runtime for Yarn Spinner 3.x, in language-and-behavior parity with upstream Yarn Spinner 3.2.x. Framework-agnostic at the root: React lives behind the `./react` subpath, and `.yarn`/`.yarnproject` content imports as build-time modules via the companion `yarn-spinner-vite-plugin` package.

## Overview

- Parser for `.yarn` files → AST
- Compiler: AST → instruction-stream program, with string table, declarations, and diagnostics
- Runtime (`Dialogue`): pull-based event stream over a stack VM
- React integration: `useDialogue()` hook and dialogue components (adapter-side, non-upstream)

Reference documentation for the Yarn Spinner 3.x language lives in `docs/` (one file per language feature, each citing its source URL). Coding standards for agents and humans: `CODING_STANDARDS.md` (repo root). Architecture decisions: `docs/adr/`.

## Glossary

Canonical vocabulary. Upstream-mirrored terms use upstream's concept names rendered in camelCase for TypeScript. Implementation details live in code and ADRs, not here.

### Language & content

- **Node**: the unit of `.yarn` content; headers, body, terminator.
- **Node group**: multiple nodes sharing a title, each with at least one `when:` header; content is selected by saliency.
- **Line group**: `=>` alternatives within a node, selected by saliency.
- **Shortcut option**: a `->` choice with optional condition and `<<once>>`.
- **Smart variable**: a read-only declaration whose value is recomputed on every access; self/cyclic references are compile errors.
- **Enum**: a named set of cases with uniform raw values (numeric or string, auto-numbered when omitted); comparable only within the same enum; `.Case` shorthand.
- **Raw value**: the constant (number or string) backing an enum case; unique within its enum; what variables hold at runtime.
- **EnumTypeBuilder**: host-side builder of enum types from TypeScript (upstream `YarnSpinner.Compiler.EnumTypeBuilder`; cases require explicit raw values), registered through the external declarations path.
- **Shadow line**: a line reusing another line's text via `#shadow:`; it registers in the string table under its own (implicit, `sh_`-prefixed) line ID with `text: null` and `shadowLineID` pointing at its source, validated at compile time (YS0042/43/44).
- **Hashtag**: per-line metadata (`#tag`); reserved tags include `#line:` and `#shadow:`.
- **Detour / return**: call-and-return node flow; a jump inside a detoured node clears the return stack.
- **Once-state**: the record that content has been viewed, stored as generated variables.
- **Subtitle**: a node-group member's identity (`subtitle:` header); qualifies the member's visit-tracking key (`Title.Subtitle`, upstream node-group naming) and must be unique within its group.

### Compiler

- **Program**: the compiled, serializable artifact of a set of `.yarn` sources; consumed by the runtime. This project's program format is its own versioned JSON (not upstream's protobuf).
- **Compilation result**: what `compile()` returns — program,
  string table, declarations, diagnostics, file tags,
  containsImplicitStringTags, user-defined types (upstream camelCased
  shape). `compile()` takes `{name, source}` files; the program is the
  instruction-stream artifact (the versioned-JSON
  bytecode of the "Program" entry, ADR 0001/0003); the tree-IR program is
  retired and the VM executes this artifact behind the public runtime API.
  A program is only lowered in `full` mode; upstream nulls it on error
  diagnostics while this fork keeps it observable.
- **Compilation mode**: full, strings-only, declarations-only, or
  type-check-only (which also emits the string table); declarations-only is
  the obsolete upstream alias of type-check-only.
- **External declaration**: a variable, function, or enum provided by the host, known to the compiler without appearing in `.yarn`.
- **YarnProject**: an upstream-format `.yarnproject` (v4 schema, legacy v2 accepted; the dead dev v3 rejected) describing source files, localisation, and compiler options. Loaded via `loadProject`/`listSources` behind an injected file-access seam (Node provider under the `./node` subpath); loader diagnostics use this project's local `YP`-code range — upstream has no registry for project files. Its `localisation` map resolves each declared locale's strings CSV into a per-locale strings table feeding a text provider (`loadLocalisations` + `createProjectTextProvider`); `assets` directories surface as configured paths for the host — the library never loads assets.
- **Diagnostic**: a problem report with a stable code, severity, message, file, and range; collected by default, thrown in strict mode.
- **YS-code**: the stable diagnostic identifier shared with upstream's registry (the upstream per-code registry is authoritative, not the docs errors page).
- **Conformance corpus**: the submodule's testplan-driven fixture sweep — `Tests/TestCases/*.yarn` with sibling `.testplan` plans, plus `Tests/Example.yarn` — the only fixtures carrying upstream's own pinned expectations; the harness mirrors them 1:1.
- **Demo projects**: upstream's `Tests/Projects/` (Space, Basic) — real-world material inside the submodule that upstream itself pins no expectations against (upstream uses Space as demo scripts, `Test.json` is Unity editor metadata). Used as realistic inputs only (acceptance tests, declarations-path material); never a conformance surface — expectations for our project-file surface come from purpose-built in-repo fixtures.
- **String table**: mapping of line ID → text, file, node, line number, metadata; interchange format is the upstream 8-column CSV.
- **Line ID**: stable identifier for a line — implicit (upstream CRC32 scheme) or explicit `#line:`.
- **Line-tag generator**: pluggable generator of implicit line IDs (random default, descriptive built-in).

### Runtime

- **Dialogue**: the runtime object that executes a program and yields dialogue events.
- **Virtual machine**: the instruction-stack executor inside `Dialogue` that runs the compiled **instruction-stream program** (upstream `VirtualMachine`); its public surface is `Dialogue` — consumers never drive the machine directly.
- **Dialogue event**: the unit of runtime output — `Line`, `Options`, `Command`, `NodeStart`, `NodeComplete`, `LineHints`, `DialogueComplete`.
- **Continue**: the pull operation returning the events up to the next stopping point.
- **Option-selection pending**: a delivered option set awaits selection — `Dialogue.isWaitingForOptionSelection` (Rust `is_waiting_for_option_selection`, same name); `continue()` while pending logs a diagnostic and returns no events (the recorded divergence — upstream throws/errs).
- **Complete**: `Dialogue.isComplete` — a `DialogueComplete` event has been **delivered** (recorded project extension; upstream completion is push-only). Answers "did the story finish?", not "is it done being used?": `stop()` makes the dialogue inactive without completing it — its complete event still delivers on the next `continue()`; `setNode` resets it for a fresh run.
- **No-option-selected**: the sentinel option selection that falls through when all options are unavailable.
- **Variable storage**: pluggable store for all dialogue state — story variables and generated variables alike — with an in-memory default; resettable as a whole, and the persistence seam (a host implementation carries state across sessions).
- **Generated variable**: internal state (once-state, visit tracking, saliency history) stored in variable storage so it resets with it — never module globals.
- **Library**: registry of host functions (variadic supported) and command handlers; functions may carry compile-time signatures used by the compile seam for signature checking (upstream `CompilationJob.Library`).
- **File tags**: file-level hashtags (`#tag` lines preceding a file's first node), surfaced per file in the compile result's `fileTags`.
- **Visit tracking**: per-node view counts recorded on node return; `tracking: never` suppresses, `tracking: always` equals default; node-group visits aggregate under the shared title.
- **Saliency strategy**: the pluggable selection policy for node groups and line groups; four built-ins with Random Best-Least-Recently-Viewed as default.
- **Line parser**: the runtime stage that expands `{expr}` substitutions, then parses markup into structured attributes; composed text flows from here.
- **Inline-expression spans**: the `{expr}` spans the line parser's substitution stage evaluates — scan contract owned by the runtime composer (`\{`/`\}` are the only escapes; any other backslash is literal; a span runs from `{` to the next `}`; an unclosed `{` composes literally). Compile-side classifiers (markup validation, string-table detection, type checking) consume the same spans, so compile-time classification cannot disagree with delivery.
- **Replacement marker**: built-in value-driven text selection markup — `[select]`, `[plural]`, `[ordinal]`.
- **Character marker**: the implicit `[character name=]` markup generated from a line's character-name prefix, before other processing.
- **Text provider**: injectable resolver from line ID to text for the current language; the runtime is string-table-unaware.

### Packaging & consumption (adapter-side)

- **Framework-agnostic core**: the package root stays React-free — React is optional and lives behind the `./react` subpath (ADR 0006), so non-React consumers never pull in `react/jsx-runtime`. The runtime, compiler, and parser import from the root; every React import rides the subpath.
- **Direct import**: consuming `.yarn` and `.yarnproject` files as build-time modules through the companion **Vite plugin** package (`yarn-spinner-vite-plugin`) — content compiles at build time, the compiled program rides the bundle, and a compile error fails the build. Import shapes: a `.yarn` file yields the Program (plus named `stringTable`/`containsImplicitStringTags`/`fileTags`), `?raw` yields the source string, a `.yarnproject` yields the full load result (program, project name, base language, per-locale tables, assets, diagnostics) ready for a text provider. Severity overrides merge in a fixed order — the project file's own map first, then the plugin's top-level option, then the `compilerOptions` passthrough (most specific wins). Full surface: [docs/direct-import.md](docs/direct-import.md).
- **Editor types**: the plugin's types-only `./client` subpath — one file declaring all three import shapes for TypeScript, served both as a triple-slash reference and as a zero-dependency paste-in.

### Adapter-side (non-upstream)

- **Transcript**: the adapter-side accumulator over a dialogue run — every
  delivered line in order, the live option set (a resolved set leaves the
  transcript), and surfaced commands. Hosts adopt it as component state;
  `runUntilStopped` produces it by merging each pull into the prior one.
- **Stopping point**: where the runtime pauses a `continue()` batch for the
  consumer — a delivered line, an option set, or a command, with node
  lifecycle and line-hint events riding through; completion is the
  terminal stopping point. `pullUntilStopped` is the family's stateless
  member — one pull to the next stopping point as raw events, the at-rest
  states delivered as data (empty events + the stopping point), and
  `mergeEvents` reduces events into a Transcript — so a stateless consumer
  reads "nothing new" off the result instead of pre-empting the contract;
  `runUntilStopped` pulls to the next stopping point, names it, and merges
  into `prior`; `runUntilComplete` drains through line and command stops to
  the terminal one, and `runUntilCompleteEvents` returns the raw event
  stream to that terminal (the runtime/scripts drain), so no consumer
  re-derives the contract.
- **Config / live split**: the hook's input shape, `useDialogue(program,
  config, live)` — one rule, **config identity = dialogue identity**: a
  new config object rebuilds the dialogue even with identical values
  (construction-only inputs — start node, variables, storage, host
  functions — belong there), while **live** (per-call callbacks and
  logging) is read through a ref: identity ignored, the latest object
  always in effect, a fresh literal every render is the intended shape.
  Exists only in the React adapter layer; not part of language parity.
- **DialogueRunner / DialogueView (the split)**: the wired container and the presentational view. `DialogueView` renders a `UseDialogueResult` — no `program` prop, no hook call — and owns **presentation state only**: typing progress, the typing skip, and the one continue scheduler (command flash, typing-done, click). All dialogue state and transitions arrive on the result object. `DialogueRunner` is the container: it calls `useDialogue` (program + config + live) and forwards the result, carrying the deprecated prop aliases. Exists only in the React adapter layer; not part of language parity.
- **Scene system**: scene/actor images reached via the `scene:` header (which itself is an ordinary upstream-compatible header). The name travels on its one channel — the `NodeStartEvent`'s optional `scene` field (absent when the node declares none), surfaced to hosts as `Transcript.scene` / the hook's `sceneName`, carried forward across scene-less nodes; hosts cross-check it against their `SceneCollection` at that seam. The scene YAML parser is demo-side (`examples/browser/scenes.ts`) — the package ships no scene parser and no scene dependency. Exists only in the React adapter layer; not part of language parity.
- **Storylet**: the browser demo's presentation name for a node-group member drawn by saliency (`examples/browser/StoryletsDemo.tsx`); demo-layer vocabulary, not upstream's — the glossary term for the thing being drawn is **node-group member**.

## Retired terms

Fork-era vocabulary, superseded by the parity API. Kept here so old docs and conversations stay decipherable. Removed *syntax* (option `[if]` suffixes, inline `{if}` blocks, `&css{}`, bare `<<set>>` variables) is documented with before/after examples in [docs/migration-notes.md](docs/migration-notes.md).

- **YarnRunner** → `Dialogue` (the runtime)
- **`advance()`** → `continue()` / `selectOption()` / `setNode()` / `stop()`
- **`currentResult` / `TextResult` / `OptionsResult` / `CommandResult`** → the `DialogueEvent` stream
- **`onStoryEnd`** → the `DialogueComplete` event
- **`handleCommand` / `options.functions`** → the `Library`
- **`getVariable` / `setVariable` on the runner** → the variable storage interface
- **Tree IR / `IRNode` / `IRNodeGroup`** → the instruction-stream program / node groups
- **`[if expr]` option conditions** → `<<if expr>>` on the option line (dropped outright)
- **`{if}{else}{endif}` inline text blocks** → line-level `<<if>>` conditions (dropped)
- **`&css{...}`** → removed; styling is consumer-side via markup properties
- **`docs/compatibility-checklist.md`** → replaced by [docs/compatibility.md](docs/compatibility.md)

The two code-level renames above that shipped as part of the parity API —
`YarnRunner` → `Dialogue` and `useYarnRunner` → `useDialogue` — keep a
**deprecated alias for one release** (0.2.0 only; removed in the release
after), so pre-0.2.0 consumers keep compiling while they migrate. The
adapter resurfacing ships the same way: `advance` → `continue`,
`onStoryEnd` → `onDialogueComplete` (payload `storyEnd: true` →
`dialogueComplete: true`), and the typing-flow props
`autoAdvanceAfterTyping`/`autoAdvanceDelay`/`pauseBeforeAdvance` →
`autoContinueAfterTyping`/`autoContinueDelay`/`pauseBeforeContinue` (since
the headless split these live on `DialogueRunner`, the wired container) — old
names stay as `@deprecated` aliases for one release. Everything
else in this list is gone outright.
