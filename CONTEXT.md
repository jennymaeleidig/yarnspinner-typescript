# yarn-spinner-runner-ts

TypeScript parser, compiler, and runtime for Yarn Spinner 3.x, in language-and-behavior parity with upstream Yarn Spinner 3.2.x, with a React adapter.

## Overview

- Parser for `.yarn` files → AST
- Compiler: AST → instruction-stream program, with string table, declarations, and diagnostics
- Runtime (`Dialogue`): pull-based event stream over a stack VM
- React integration: `useDialogue()` hook and dialogue components (adapter-side, non-upstream)

Reference documentation for the Yarn Spinner 3.x language lives in `docs/` (one file per language feature, each citing its source URL). Coding standards for agents and humans: `docs/coding-standards.md`. Architecture decisions: `docs/adr/`.

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
  shape). `compile()` takes `{name, source}` files (story 31); since ticket
  46 the program is the instruction-stream artifact (the versioned-JSON
  bytecode of the "Program" entry, ADR 0001/0003); the tree-IR program is
  retired and the VM executes this artifact behind the public runtime API.
  A program is only lowered in `full` mode; upstream nulls it on error
  diagnostics while this fork keeps it observable (ticket 49 notes).
- **Compilation mode**: full, strings-only, declarations-only, or
  type-check-only (which also emits the string table); declarations-only is
  the obsolete upstream alias of type-check-only.
- **External declaration**: a variable, function, or enum provided by the host, known to the compiler without appearing in `.yarn`.
- **YarnProject**: an upstream-format `.yarnproject` (v4 schema, legacy v2 accepted; the dead dev v3 rejected) describing source files, localisation, and compiler options. Loaded via `loadProject`/`listSources` behind an injected file-access seam (Node provider under the `./node` subpath); loader diagnostics use this project's local `YP`-code range — upstream has no registry for project files. Its `localisation` map resolves each declared locale's strings CSV into a per-locale strings table feeding a text provider (`loadLocalisations` + `createProjectTextProvider`); `assets` directories surface as configured paths for the host — the library never loads assets.
- **Diagnostic**: a problem report with a stable code, severity, message, file, and range; collected by default, thrown in strict mode.
- **YS-code**: the stable diagnostic identifier shared with upstream's registry (the upstream per-code registry is authoritative, not the docs errors page).
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
- **Replacement marker**: built-in value-driven text selection markup — `[select]`, `[plural]`, `[ordinal]`.
- **Character marker**: the implicit `[character name=]` markup generated from a line's character-name prefix, before other processing.
- **Text provider**: injectable resolver from line ID to text for the current language; the runtime is string-table-unaware.

### Adapter-side (non-upstream)

- **Scene system**: YAML scene/actor definitions and portrait handling reached via the `scene:` header (which itself is an ordinary upstream-compatible header). Exists only in the React adapter layer; not part of language parity.
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
- **`docs/compatibility-checklist.md`** → superseded by the 3.2 parity spec (`.scratch/ys32-parity/spec.md`); replaced by [docs/compatibility.md](docs/compatibility.md)

The two code-level renames above that shipped as part of the parity API —
`YarnRunner` → `Dialogue` and `useYarnRunner` → `useDialogue` — keep a
**deprecated alias for one release** (0.2.0 only; removed in the release
after), so pre-0.2.0 consumers keep compiling while they migrate. The
adapter resurfacing (ticket 55) ships the same way: `advance` → `continue`,
`onStoryEnd` → `onDialogueComplete` (payload `storyEnd: true` →
`dialogueComplete: true`), and the `DialogueView` typing-flow props
`autoAdvanceAfterTyping`/`autoAdvanceDelay`/`pauseBeforeAdvance` →
`autoContinueAfterTyping`/`autoContinueDelay`/`pauseBeforeContinue` — old
names stay as `@deprecated` aliases for one release. Everything
else in this list is gone outright.
