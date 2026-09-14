# yarnspinner-typescript

TypeScript parser, compiler, and runtime for Yarn Spinner 3.x. Framework-agnostic: hosts own their UI against `Dialogue`/`Transcript` directly.

- [GitHub repository](https://github.com/jennymaeleidig/yarnspinner-typescript)
- [NPM package](https://www.npmjs.com/package/yarnspinner-typescript)

## Features

- Full Yarn Spinner 3.x syntax support: lines with speakers, options with conditions, `<<if>>`/`<<once>>`/`<<jump>>`/`<<detour>>`, variables and expressions, enums, smart variables, node groups, tags and metadata, custom commands
- Parser for `.yarn` files → AST
- Compiler: AST → instruction-stream program (versioned JSON bytecode, ADR 0001)
- Runtime with the `Dialogue` class: pull-based event stream, markup parsed into structured attributes
- Expression evaluator for conditions, with built-in functions (`visited`, `random`, `min`, `max`, etc.)
- Command system with built-in handlers (`<<set>>`, `<<declare>>`, etc.)
- Direct import: `.yarn` / `.yarnproject` files as build-time modules via [yarnspinner-vite-plugin](https://www.npmjs.com/package/yarnspinner-vite-plugin) — see [Direct import](./docs/direct-import.md)
- Scene system: the `scene:` header arrives on `NodeStartEvent`/`Transcript.scene`; scene/actor configuration is host input

## Installation

Clone with `git clone --recurse-submodules` — the conformance fixtures are a git submodule pinned to an upstream tag (in an existing clone: `git submodule update --init --recursive`).

```bash
npm install
npm run build
```

## Quick start

```typescript
import { compileSource, Dialogue, Library } from "yarnspinner-typescript";

const yarnText = `
title: Start
---
Narrator: Hello!
-> Option 1
    Narrator: You chose option 1.
-> Option 2
    Narrator: You chose option 2.
===
`;

// Compile through the collect-don't-throw seam: diagnostics come back with
// the result instead of throwing (program is null only when lowering could
// not produce anything observable).
const { program, diagnostics } = compileSource(yarnText);
const errors = diagnostics.filter((d) => d.severity === "error");
if (!program || errors.length > 0) {
  throw new Error(errors.map((d) => `${d.code}: ${d.message}`).join("\n"));
}
const library = new Library();
library.registerFunction("add", (a: number, b: number) => a + b);
library.registerCommandHandler("flash", (params) => {
  console.log("Flash:", params); // parameters arrive quote-stripped
});

const dialogue = new Dialogue(program, {
  startAt: "Start",
  variables: { score: 10 },
  library,
});

// Pull events up to the next stopping point (line, command, option set,
// or dialogue end)
let events = dialogue.continue();

// When the batch contains an Options event, resume with a selection:
// dialogue.selectOption(0);        // choose option 0
// dialogue.selectOption(-1);       // or fall through past the options block

// End of dialogue arrives as a DialogueComplete event with final state:
if (events.some((e) => e.type === "dialogueComplete")) {
  console.log("Final variables:", dialogue.getVariables());
}
```

> Host-provided variables can be keyed as `score` or `$score` in the variables
> map you pass at construction; the runtime normalizes storage keys. Inside
> `.yarn` scripts, however, variable references must use the `$` prefix (see
> the [migration notes](./docs/migration-notes.md)).

### Conditional options

Add a per-option condition with `<<if expression>>` on the option line. The expression is evaluated when the option list is emitted; options whose expression evaluates to `false` still arrive, with `isAvailable: false`, so your UI can disable them.

```yarn
title: Hub
---
<<declare $hasBadge = false>>
-> Ask about the badge <<if $hasBadge>>
    Narrator: You flash the badge.
-> Offer a bribe
    Narrator: You slide some eddies across the table.
===
```

Once some branch executes `<<set $hasBadge = true>>`, the badge option arrives with `isAvailable: true` alongside the other entries, no extra `<<if>>` blocks needed.

### Arithmetic assignments

`<<set>>` accepts both `to` and `=` aliases and evaluates the right-hand side with full operator precedence and parentheses, as in Yarn Spinner:

```yarn
<<set $reputation = $reputation - 25 >>
<<set $score = ($score + 10) / 2>>
Narrator: Current street cred: {$reputation}, score: {$score}
```

## Examples

Run the interactive browser demo (`npm run demo`): a Vite dev server with the **Crossroads** tab (branching sample over the pull-based runtime: lines, option buttons, a continue button, a full state log) and the **Calibrations** tab (the Try showcase story). See [examples/browser/README.md](./examples/browser/README.md).

Each story under `examples/content/*/` carries its own `.yarnproject`, so the [Yarn Spinner extension for VS Code](https://marketplace.visualstudio.com/items?itemName=SecretLab.yarn-spinner) picks the stories up as Yarn projects (the committed `.vscode/extensions.json` recommends it). Upstream conformance fixtures (`test/fixtures/upstream/YarnSpinner`, the git submodule) sit outside any project on purpose: they are pinned to an upstream tag and must not be edited or auto-fixed by editor tooling.

## API overview

### Parser and compiler

- `parseYarn(text: string): YarnDocument` — Parse Yarn script text into AST
- `compile(files: CompileFile[], opts?: CompileOptions): CompileResult` — Compile `{ name, source }` files (multi-file; four modes, string table, external declarations, diagnostics)
- `compileSource(source: string, opts?: CompileSourceOptions): CompileResult` — Single-file convenience wrapper, the public compile seam: collect-don't-throw, diagnostics come back with the result
- `compileDocument(doc: YarnDocument, opts?: CompileDocumentOptions): Program` — Internal: the AST-level lowering seam (throws `ParseError`/`LoweringError`), for tooling and the compiler's own tests, not reachable from the package root

### Project loader

Loads upstream-style `.yarnproject` files (format v4, legacy v2 accepted) and compiles their sources in one call. File access is injected — the loader core performs no I/O, so it stays bundler-safe; problems surface as collectible `YP` diagnostics (this project's own code range; upstream has no project-file registry).

- `loadProject({ project, fileSystem, projectFile?, ...compileOptions })` — Validate the project, resolve `sourceFiles`/`excludeFiles` globs relative to the project location, and return a `CompileResult` plus `{ project, sources }`. Validation errors skip the compile (`program: null`); missing localisation strings files warn without blocking the base-language compile; unrecognised `compilerOptions` keys warn (YP0005) rather than being silently dropped
- `listSources({ project, fileSystem })` — `ysc list-sources` equivalent: the resolved source paths without compiling
- `parseYarnProject(project, projectFile?)` — Pure project-file validation (types + schema conformance)
- `loadLocalisations({ project, stringTable }, fileSystem)` — Resolve the project's `localisation` map: each declared locale's strings CSV becomes a per-locale id → text table, the compile result's string table becomes the base table (shadow lines excluded), and `assets` directories surface as configured language → path entries for the host (never loaded). Unreadable strings files warn (YP0006) and drop that locale's table
- `createProjectTextProvider(localisation)` — Glue the localisation tables into a `StringTableTextProvider` for `Dialogue`'s `textProvider` option; switch locales with `Dialogue.setLanguage`
- Node hosts: `import { loadYarnProject, nodeProjectFs } from "yarnspinner-typescript/node"` — `loadYarnProject("path/to/MyProject.yarnproject")` loads and compiles from disk in one call; `nodeProjectFs(dir)` is the default `YarnProjectFileSystem` (skips `node_modules`/`.git`)
- Frontend bundles: `import story from "./story.yarn"` — the companion [yarnspinner-vite-plugin](https://www.npmjs.com/package/yarnspinner-vite-plugin) compiles `.yarn`/`.yarnproject` files at build time; see [docs/direct-import.md](./docs/direct-import.md)

### Runtime

- `new Dialogue(program: Program, options?: DialogueOptions)` — Pull-based dialogue runner
  - `continue(): DialogueEvent[]` — Events up to the next stopping point (line, command, option set, or dialogue end)
  - `selectOption(index: number): void` — Resume after an Options event; `noOptionSelected` (-1) falls through past the options block
  - `setLanguage(language: string | null): void` — Switch the injected text provider's language (`null` = the base language, the program's own text)
  - `setNode(title: string): void` / `stop(): void` — Jump to a node / end the dialogue
  - `getVariable(name)` / `setVariable(name, value)` / `getVariables()` / `tryGetSmartVariable(name)`
  - `currentNode: string | null` — Current node title (the `scene:` header travels on the `NodeStartEvent`, not a getter)
  - Options: `startAt` (default `"Start"`), `library`, `variables`, `variableStorage` (pluggable store; inject a pre-populated `VariableStorage` to restore state, see [docs/logic-and-variables.md](docs/logic-and-variables.md)), `lineHints` (opt-in `LineHintsEvent`), `textProvider` (line-ID → text resolver; lines a provider lacks fall back to the program's text), `logError` (default `console.error`), `logDebug` (default silent)
  - Events (all camelCased): `LineEvent`, `OptionsEvent` (full option set with advisory `isAvailable` flags), `CommandEvent` (state commands like `<<set>>` never surface), `NodeStartEvent` (carries the node's `scene:` header as `scene?` when it declares one — the scene system is non-upstream), `NodeCompleteEvent`, `LineHintsEvent`, `DialogueCompleteEvent`
- `VariableStorage` / `InMemoryVariableStorage` — The storage contract the runtime drives (`has`/`get`/`set`/`entries`) and its in-memory default. Generated variables (once-state, visit tracking) live in the same storage and appear in `entries()` but not `getVariables()` snapshots
- `Library` — Registry of host functions and command handlers
  - `registerFunction(name, fn)` — Throws on duplicate; `getFunction(name)` returns undefined when missing
  - `registerCommandHandler(name, handler)` / `getCommandHandler(name)` — Handlers receive quote-stripped parameters
  - `importLibrary(other)` — Merge another library; its entries take precedence
- `ExpressionEvaluator(variables, functions, enums?)` — Safe expression evaluator: comparison and boolean operators plus word aliases (`eq/is`, `neq`, `gt`, `lt`, `lte`, `gte`, `and`, `or`, `not`, `xor`), function calls, variables, numbers, strings, booleans, and enums with shorthand (`MyEnum.Case`)
- `parseCommand(content: string): ParsedCommand` — Parse command string. Built-in `<<set>>`, `<<declare>>`, and `<<call>>` are state statements handled internally and never surface as `Command` events

### Built-in functions

`visited(nodeName)`, `visited_count(nodeName)`, `random()`, `random_range(min, max)`, `random_range_float(min, max)`, `dice(sides)`, `min(a, b)`, `max(a, b)`, `round(n)`, `round_places(n, places)`, `floor(n)`, `ceil(n)`, `inc(n)`, `dec(n)`, `decimal(n)`, `int(n)`, `string(n)`, `number(n)`, `bool(n)`, `has_any_content(nodeNames)` — see [docs/functions.md](./docs/functions.md).

### Scenes

The package ships no scene parser (YAML or otherwise): you parse your collection host-side and pass it as a `SceneCollection` (with `SceneConfig`/`ActorConfig` types). The scene name itself is runtime output, travelling on the `NodeStartEvent`'s `scene` field and `Transcript.scene` (carried forward across scene-less nodes) — the seam where you cross-check your collection. A typical host-side YAML collection:

```yaml
scenes:
  scene1:
    background: https://example.com/background1.jpg
    actors:
      special_npc:
        image: https://example.com/special-npc.png

actors:
  Narrator: https://example.com/narrator.png
  Player: https://example.com/player.png
```

```yarn
title: MyNode
scene: scene1
---
Narrator: This scene uses scene1's background and actors.
===
```

See [Scene and Actor Setup](./docs/scenes-actors-setup.md) for complete documentation.

### Styling

The language carries no styling constructs (the fork-era `&css{}` attribute was removed for 3.2 parity — see the [migration notes](./docs/migration-notes.md)). The runtime emits structured events (speaker, tags, markup attributes) that your components can key presentation on.

## Example Yarn script

```yarn
title: Start
tags: #introduction #tutorial
---
Narrator: Welcome!
<<set $score to 10>>
<<if $score >= 10>>
    Narrator: High score!
<<else>>
    Narrator: Low score.
<<endif>>

// Upstream Yarn Spinner has no ternary operator — branch with `<<if>>`:
<<declare $randomName = "Bob">>
<<if random_range(1, 3) == 1>>
    <<set $randomName = "Alice">>
<<endif>>
Narrator: Your name is {$randomName}.

-> Ask about features
    Player: What can this do?
    Narrator: Lots of things!
-> Ask about commands
    Player: Tell me about commands.
    Narrator: Commands modify state.

<<once>>
    Narrator: This only shows once!
<<endonce>>

<<jump NextNode>>
===

title: NextNode
scene: scene1
---
Narrator: You've arrived at the next scene!
===
```

## Development

```
yarnspinner-typescript/
├── src/
│   ├── model/          # AST types
│   ├── parse/          # Lexer and parser
│   ├── markup/         # Markup types and line parser
│   ├── compile/        # Compiler (AST → program)
│   ├── runtime/        # Runtime execution
│   ├── scene/          # Scene system
│   └── tests/          # Test files
├── examples/
│   ├── content/        # Demo Yarn content (per-story projects)
│   └── browser/        # Browser demo (Vite)
├── docs/               # Documentation
└── dist/               # Compiled output
```

Tests live in `src/tests/` and assert observable behavior through the public seams — compiled outputs and runtime event streams — against the upstream fixture corpus. Run them with `npm test`.

## Documentation

- [Lines, Nodes, and Options](./docs/lines-nodes-and-options.md)
- [Options](./docs/options.md)
- [Jumps](./docs/jumps.md) / [Detour](./docs/detour.md)
- [Flow Control](./docs/flow-control.md) / [Once Blocks](./docs/once.md)
- [Logic and Variables](./docs/logic-and-variables.md) / [Smart Variables](./docs/smart-variables.md) / [Enums](./docs/enums.md)
- [Commands](./docs/commands.md) / [Functions](./docs/functions.md)
- [Node Groups](./docs/node-groups.md) / [Tags and Metadata](./docs/tags-metadata.md) / [Line Groups](./docs/line-groups.md)
- [Saliency](./docs/saliency.md) / [Shadow Lines](./docs/shadow-lines.md)
- [Markup (Yarn Spinner)](./docs/markup.md)
- [Direct Import](./docs/direct-import.md)
- [Scene and Actor Setup](./docs/scenes-actors-setup.md)
- [Migration Notes (1.0.0 breaking changes)](./docs/migration-notes.md)
- [Compatibility](./docs/compatibility.md)
- [Releasing](./docs/releasing.md)
- [Changelog](./CHANGELOG.md)

## Credits and references

Inspired by [yarn-spinner-runner-ts](https://github.com/oleksii-chekhovskyi/yarn-spinner-runner-ts) by Oleksii Chekhovskyi. This is an independent implementation, not a fork. Other reference material:

- bondage.js (Yarn 2.x JS parser): [mnbroatch/bondage.js](https://github.com/mnbroatch/bondage.js/tree/master/src)
- YarnSpinner.Compiler (official C# compiler): [YarnSpinnerTool/YarnSpinner](https://github.com/YarnSpinnerTool/YarnSpinner/tree/main/YarnSpinner.Compiler)
- YarnBound (existing dialogue runner API): [mnbroatch/yarn-bound](https://github.com/mnbroatch/yarn-bound?tab=readme-ov-file)
- YarnSpinner-Rust (pull-based runtime API shape, Apache-2.0): [YarnSpinnerTool/YarnSpinner-Rust](https://github.com/YarnSpinnerTool/YarnSpinner-Rust)

Code borrowed or adapted from external sources keeps its original license and is recorded in [`CITATION.cff`](./CITATION.cff).

## License

The original code of this project is dedicated to the public domain under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (see `LICENSE`). The Yarn Spinner material (the MIT C# repository this project mirrors and ports from, mounted as the pinned git submodule under `test/fixtures/upstream/`, and the Apache-2.0 Rust runtime referenced for the pull-based API shape) is covered by its own license; see [`CITATION.cff`](./CITATION.cff).
