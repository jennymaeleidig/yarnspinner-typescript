# yarn-spinner-runner-ts

TypeScript parser, compiler, and runtime for Yarn Spinner 3.x with React adapter.

* [Github repository](https://github.com/oleksii-chekhovskyi/yarn-spinner-runner-ts) for more information.
* [NPM package](https://www.npmjs.com/package/yarn-spinner-runner-ts)

## References

* Old JS parser: `bondage.js` (Yarn 2.x) — [GitHub](https://github.com/mnbroatch/bondage.js/tree/master/src)
* Official compiler (C#): YarnSpinner.Compiler — [GitHub](https://github.com/YarnSpinnerTool/YarnSpinner/tree/main/YarnSpinner.Compiler)
* Existing dialogue runner API: YarnBound — [GitHub](https://github.com/mnbroatch/yarn-bound?tab=readme-ov-file)

## Features

* ✅ Full Yarn Spinner 3.x syntax support
* ✅ Parser for `.yarn` files → AST
* ✅ Compiler: AST → instruction-stream program (versioned JSON bytecode, ADR 0001)
* ✅ Runtime with `Dialogue` class (pull-based event stream)
* ✅ React hook: `useDialogue()`
* ✅ React components: `<DialogueRunner />` (wired), `<DialogueView />` (presentational), `<DialogueScene />`, `<DialogueExample />`
* ✅ Typing animation with configurable speeds, cursor styles, and auto-continue controls
* ✅ Markup parsing with HTML formatting tags and CSS-ready spans
* ✅ Expression evaluator for conditions
* ✅ Command system with built-in handlers (`<<set>>`, `<<declare>>`, etc.)
* ✅ Scene system with backgrounds and actor images (with configurable portrait cross-fades)
* ✅ Built-in functions (`visited`, `random`, `min`, `max`, etc.)
* ✅ Support for:
  * Lines with speakers
  * Options with indented bodies
  * Option-line conditions via `<<if expression>>`
  * `<<if>>/<<elseif>>/<<else>>/<<endif>>` blocks
  * `<<once>>...<<endonce>>` blocks
  * `<<jump NodeName>>` commands
  * `<<detour NodeName>>` commands
  * Variables and expressions
  * Enums (`<<enum>>` blocks)
  * Smart variables (`<<declare $var = expr>>`)
  * Node groups with `when:` conditions
  * Tags and metadata on nodes, lines, and options
  * Custom commands

## Installation

Clone with `git clone --recurse-submodules` — the conformance fixtures are a git submodule pinned to an upstream tag (in an existing clone: `git submodule update --init --recursive`).

```bash
npm install
npm run build
```

## Quick Start

### Basic Usage

```typescript
import { compileSource, Dialogue, Library } from "yarn-spinner-runner-ts";

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

You can add a per-option condition with `<<if expression>>` on the option line. The expression is evaluated when the option list is emitted; options whose expression evaluates to `false` are still delivered, but with `isAvailable: false` so your UI can disable them.

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

Once some branch executes `<<set $hasBadge = true>>`, the badge option arrives with `isAvailable: true` alongside the other entries, without extra `<<if>>` blocks.

### Arithmetic assignments

`<<set>>` accepts both `to` and `=` aliases and evaluates the expression on the right-hand side, so you can modify variables inline—operator precedence and parentheses all work the same way they do in Yarn Spinner:

```yarn
<<set $reputation = $reputation - 25 >>
<<set $score = ($score + 10) / 2>>
Narrator: Current street cred: {$reputation}, score: {$score}
```

### React Usage

Two layers, your choice of seam (headless split):

```tsx
import { compileSource, useDialogue, DialogueView } from "yarn-spinner-runner-ts";
import type { SceneCollection } from "yarn-spinner-runner-ts";

function MyDialogue() {
  // Collect-don't-throw: diagnostics come back with the result.
  const { program, diagnostics } = compileSource(yarnText);

  // The scene collection is host input — plain data, no library parser
  // (the package ships no YAML scene parser; the browser demo keeps one in
  // examples/browser/scenes.ts if you want a starting point).
  const scenes: SceneCollection = {
    scenes: {
      street: {
        background: "/images/street.jpg",
        actors: { Narrator: { image: "/images/narrator.png" } },
      },
    },
  };

  // Full control: the hook carries all dialogue state and transitions; the
  // presentational view owns only presentation state (typing, the continue
  // scheduler). One rule: config identity = dialogue identity, so keep the
  // config object stable across renders (module constant or useMemo).
  const result = useDialogue(program, { startAt: "Start", variables: { score: 10 } });
  return <DialogueView result={result} scenes={scenes} />;
}
```

Prefer the wiring done for you? `DialogueRunner` takes the program directly
and forwards every runtime, live, and presentation option:

```tsx
import { DialogueRunner } from "yarn-spinner-runner-ts";

<DialogueRunner program={program} startAt="Start" scenes={scenes} autoContinueAfterTyping />;
```

### Full Example Component

```tsx
import { DialogueExample } from "yarn-spinner-runner-ts";

function App() {
  return <DialogueExample />;
}
```

### Typing Animation

Set `enableTypingAnimation` on `DialogueView` (or `DialogueRunner`) to enable the `TypingText` component for typewriter-style delivery. Tweak props like `typingSpeed`, `showTypingCursor`, and `cursorCharacter` to fine-tune behaviour, and see [Typing Animation (React)](./docs/typing-animation.md) for details.

### Browser Demo

Run the interactive browser demo:

```bash
npm run demo
```

This starts a Vite dev server with two demos: the **Dialogue** tab (the
visual-novel view over the pull-based runtime) and a **Storylets** tab — a
node-group/saliency demo with switchable saliency strategies
(`examples/browser/StoryletsDemo.tsx`). See
[examples/browser/README.md](./examples/browser/README.md).

### Next.js Host

A worked app-router example proving the YarnProject story in Next.js
(`examples/nextjs-host/`): the loader runs server-side — `loadYarnProject()`
over the app's own authored content (`content/project.yarnproject` +
`content/crossroads.yarn`) through the Node file-access provider — and the
compiled program crosses the React Server Component boundary as a plain
serializable object. The client component runs `Dialogue`'s pull-based
continue loop natively, importing only the package's browser-safe main entry
(no Node APIs in the client path), with a **Reset** button demonstrating
variable-storage reset: a fresh `Dialogue` is a fresh storage, so the
`<<declare>>` seeds reapply and the story replays from the top.

```bash
npm run host:build   # builds the library, then `next build` the host
npm run host:start   # serve the built host (after host:build)
```

Run from the repo root — the server component resolves the content directory
relative to `process.cwd()`. The SSR render test (the ticket-52 demo-harness
pattern over the host's first pull) lives in
`src/tests/nextjsHost.test.tsx`.

### SvelteKit host

The same story again, with zero React anywhere — the strongest proof the
runtime is framework-agnostic (`examples/sveltekit-host/`). The loader runs
in `+page.server.ts` — `loadYarnProject()` over the app's own authored
content (`content/project.yarnproject` + `content/night_market.yarn`) — and
the compiled program crosses the SvelteKit load boundary as a plain
serializable object. `Dialogue`'s pull-based continue loop runs natively in
a Svelte 5 runes component (`src/lib/DialogueHost.svelte`); the page is
prerendered (adapter-static), so the server-rendered dialogue output is
baked into the build. **Reset** demonstrates variable-storage reset, as in
the Next.js host.

```bash
npm run sveltekit:build   # builds the library, then `vite build` the host
npm run sveltekit:dev     # dev server for the host
```

The npm targets `cd` into the host directory — the standard SvelteKit
workflow — and the server load resolves the content directory relative to
it. Framework support is demonstrated across both hosts — Next.js (React)
and SvelteKit (Svelte) — on the same `Dialogue`/loader surface. The SSR
harness (`src/tests/sveltekitHost.test.ts`) compiles the real component
with `svelte/compiler` and renders it with `svelte/server`.

### Editing the Yarn scripts

The repo root contains `yarn-spinner-runner-ts.yarnproject`, so the
[Yarn Spinner extension for VS Code](https://marketplace.visualstudio.com/items?itemName=SecretLab.yarn-spinner)
(git-ignored `.vscode/extensions.json` recommends it) treats the workspace as
a Yarn project: syntax highlighting, node navigation, and error checking are
scoped to the authored content in `examples/yarn/`. Upstream conformance
fixtures (the `test/fixtures/upstream/YarnSpinner` git submodule) are
deliberately outside the project — they are pinned to an upstream tag and
must not be edited or auto-fixed by editor tooling.

## API Reference

### Parser

* `parseYarn(text: string): YarnDocument` — Parse Yarn script text into AST

### Compiler

* `compile(files: CompileFile[], opts?: CompileOptions): CompileResult` — Compile `{ name, source }` files (multi-file; four modes, string table, external declarations, diagnostics)
* `compileSource(source: string, opts?: CompileSourceOptions): CompileResult` — Single-file convenience wrapper — **the public compile seam**: collect-don't-throw, diagnostics come back with the result
* `compileDocument(doc: YarnDocument, opts?: CompileDocumentOptions): Program` — *Internal*: the AST-level lowering seam (throws `ParseError`/`LoweringError`); real for tooling and the compiler's own tests, not reachable from the package root (deepening-wave ticket 09)

### YarnProject loader

Loads upstream-style `.yarnproject` files (format v4, legacy v2 accepted; schema: <https://schemas.yarnspinner.dev/yarnproject.schema.json>) and compiles their sources in one call. File access is injected — the loader core performs no I/O, keeping it bundler-safe; problems surface as collectible `YP` diagnostics (this project's own code range; upstream has no project-file registry).

* `loadProject({ project, fileSystem, projectFile?, ...compileOptions })` — Validate the project, resolve `sourceFiles`/`excludeFiles` globs relative to the project location, and return a `CompileResult` plus `{ project, sources }`. Validation errors skip the compile (`program: null`); referenced-but-missing localisation strings files warn without blocking the base-language compile; unrecognised `compilerOptions` keys warn (YP0005) rather than being silently dropped
* `listSources({ project, fileSystem })` — `ysc list-sources` equivalent: the resolved source paths without compiling
* `parseYarnProject(project, projectFile?)` — Pure project-file validation (types + schema conformance)
* `loadLocalisations({ project, stringTable }, fileSystem)` — Resolve the project's `localisation` map: each declared locale's strings CSV becomes a per-locale id → text table, the compile result's string table becomes the base table (shadow lines excluded), and `assets` directories surface as configured language → path entries for the host (never loaded). Unreadable strings files warn (YP0006) and drop that locale's table
* `createProjectTextProvider(localisation)` — Glue the localisation tables into a `StringTableTextProvider` for `Dialogue`'s `textProvider` option; switch locales with `Dialogue.setLanguage`
* Node hosts: `import { loadYarnProject, nodeProjectFs } from "yarn-spinner-runner-ts/node"` — `loadYarnProject("path/to/MyProject.yarnproject")` loads and compiles from disk in one call; `nodeProjectFs(dir)` is the default `YarnProjectFileSystem` (skips `node_modules`/`.git`)

### Runtime

* `new Dialogue(program: Program, options?: DialogueOptions)` — Pull-based dialogue runner
  * `continue(): DialogueEvent[]` — Return events up to the next stopping point (line, command, option set, or dialogue end)
  * `selectOption(index: number): void` — Resume after an Options event; `noOptionSelected` (-1) falls through past the options block
  * `setLanguage(language: string | null): void` — Switch the injected text provider's language (`null` = the base language, the program's own text)
  * `setNode(title: string): void` / `stop(): void` — Jump to a node / end the dialogue
  * `getVariable(name: string): unknown` / `setVariable(name: string, value: unknown): void` / `getVariables(): Readonly<Record<string, unknown>>`
  * `tryGetSmartVariable(name: string)` — Read a smart variable's current value
  * `currentNode: string | null` — Current node title (the `scene:` header travels on the `NodeStartEvent`, not a getter)
  * Options: `startAt` (default `"Start"`), `library`, `variables`, `variableStorage` (pluggable store for story and generated variables; the persistence seam — inject a pre-populated `VariableStorage` to restore state, see [docs/logic-and-variables.md](docs/logic-and-variables.md)), `lineHints` (opt-in `LineHintsEvent`), `textProvider` (line-ID → text resolver for localisation; lines a provider lacks fall back to the program's text), `logError` (default `console.error`), `logDebug` (default silent)
  * Events (all camelCased): `LineEvent`, `OptionsEvent` (full option set with advisory `isAvailable` flags), `CommandEvent` (state commands like `<<set>>` never surface), `NodeStartEvent` (carries the node's `scene:` header as `scene?` when it declares one — adapter-side, the scene system is non-upstream), `NodeCompleteEvent`, `LineHintsEvent`, `DialogueCompleteEvent`
* `VariableStorage` / `InMemoryVariableStorage` — The storage contract the runtime drives (`has`/`get`/`set`/`entries`) and its in-memory default; exported from `dialogue.ts` and the package root. Generated variables (once-state, visit tracking) live in the same storage and appear in `entries()` but not `getVariables()` snapshots
* `Library` — Registry of host functions and command handlers (replaces the old `functions` map and `handleCommand` option)
  * `registerFunction(name, fn)` — Throws on duplicate; `getFunction(name)` returns undefined when missing
  * `registerCommandHandler(name, handler)` / `getCommandHandler(name)` — Handlers receive quote-stripped parameters
  * `importLibrary(other)` — Merge another library; its entries take precedence

### React Components

* `useDialogue(program: Program, config: UseDialogueOptions, live?: UseDialogueLive)` — React hook over `Dialogue`
  * Returns: `{ result: DialogueViewResult | null, continue: () => void, selectOption: (index: number) => void, sceneName?: string, dialogue: Dialogue }` (`continue` is a reserved word — destructure it under a local name; `dialogue` is the escape hatch for variable reads and `setLanguage`; `sceneName` is the `scene:` header of the most recently started node, derived from the transcript's `NodeStartEvent` and carried forward across scene-less nodes — cross-check it against your `SceneCollection` here, the one seam where the name and the image collection meet)
  * `config` holds construction-only inputs, reference-compared as a whole — one rule: **config identity = dialogue identity** (a new config object means a new dialogue, even with identical values): `startAt`, `functions`, `variables` (they seed state — different values means a new dialogue), `variableStorage` (the persistence seam — inject a pre-populated storage to restore state), `textProvider` (line-ID → text for the current language; switch languages via `dialogue.setLanguage` on the hook result, no rebuild), `lineHints` (opt-in `LineHintsEvent`; the hook consumes hints silently, so observe them via the provider's `acceptLineHints` or the `dialogue` escape hatch)
  * `live` holds per-call inputs, read through a ref — identity is ignored and the latest object is always in effect (a fresh literal every render is fine): `onDialogueComplete` (fired once on dialogue completion, with the story variables; deprecated alias: `onStoryEnd`), `logError`/`logDebug` (runtime diagnostics; defaults `console.error`/silent)
  * Deprecated aliases: `advance` (same function as `continue`)
* `<DialogueRunner program={...} startAt={...} scenes={...} onDialogueComplete={...} />` — The wired component: calls the hook and renders `DialogueView`; its props extend the hook's `UseDialogueOptions` + `UseDialogueLive` and the view's presentation options, so every runtime option is accepted here under the same rules as the hook (deprecated prop aliases: `onStoryEnd`, `autoAdvanceAfterTyping`/`autoAdvanceDelay`/`pauseBeforeAdvance` → `autoContinueAfterTyping`/`autoContinueDelay`/`pauseBeforeContinue`); the scene background follows the hook's `sceneName` automatically
* `<DialogueView result={hookResult} scenes={...} enableTypingAnimation={...} />` — The presentational view: renders a `UseDialogueResult` — **no `program` prop, no hook call**. It owns presentation state only: typing progress, the typing skip, and the continue scheduler (a surfaced command auto-continues after its 50ms flash, a finished typing animation waits `autoContinueDelay`, a click waits `pauseBeforeContinue`); all dialogue state and transitions arrive on the result object. Pair it with `useDialogue` for full control
* `<DialogueScene sceneName={...} speaker={...} scenes={...} actorTransitionDuration={...} /> — Scene background, actor display, and portrait transitions` — Scene background and actor display
* `<DialogueExample scenes={...} />` — Full example with editor (the scene collection is host input; the browser demo parses its own YAML in `examples/browser/scenes.ts`)

### Scene System

* `SceneCollection` — Type for scene configuration (host input — the parsed collection is passed to the view; the package ships no YAML parser, the browser demo keeps one in `examples/browser/scenes.ts`)
* `SceneConfig` — Type for individual scene config
* `ActorConfig` — Type for actor configuration

See [Scene and Actor Setup Guide](./docs/scenes-actors-setup.md) for detailed documentation.

### Expression Evaluator

* `ExpressionEvaluator(variables, functions, enums?)` — Safe expression evaluator
  * Supports: `===`, `!==`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`
  * Operator aliases: `eq/is`, `neq`, `gt`, `lt`, `lte`, `gte`, `and`, `or`, `not`, `xor`
  * Function calls: `functionName(arg1, arg2)`
  * Variables, numbers, strings, booleans
  * Enum support with shorthand (`MyEnum.Case`)

### Commands

* `Library.registerCommandHandler(name, handler)` — Register a custom command handler (see Runtime)
* Built-in: `<<set>>`, `<<declare>>`, `<<call>>` are state statements handled internally and never surface as `Command` events
* `parseCommand(content: string): ParsedCommand` — Parse command string

### Built-in Functions

The runtime includes these built-in functions:

* `visited(nodeName)` — Check if a node was visited
* `visited_count(nodeName)` — Get visit count for a node
* `random()` — Random float 0-1
* `random_range(min, max)` — Random integer in range
* `dice(sides)` — Roll a die
* `min(a, b)`, `max(a, b)` — Min/max values
* `round(n)`, `round_places(n, places)` — Rounding
* `floor(n)`, `ceil(n)` — Floor/ceiling
* `inc(n)`, `dec(n)` — Increment/decrement
* `decimal(n)` — Convert to decimal
* `int(n)` — Convert to integer
* `string(n)`, `number(n)`, `bool(n)` — Type conversions

## Example Yarn Script

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

## Styling

The language carries no styling constructs (the fork-era `&css{}` attribute was
removed for 3.2 parity — see the [migration notes](./docs/migration-notes.md)).
Style dialogue in your consumer: the runtime emits structured events (speaker,
tags, markup attributes) that your components can key presentation on.

## Scene Configuration

Configure scenes and actors using YAML:

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

Use scenes in Yarn nodes:

```yarn
title: MyNode
scene: scene1
---
Narrator: This scene uses scene1's background and actors.
===
```

See [Scene and Actor Setup Guide](./docs/scenes-actors-setup.md) for complete documentation.

## Project Structure

```
yarn-spinner/
├── src/
│   ├── model/          # AST types
│   ├── parse/          # Lexer and parser
│   ├── compile/        # Compiler (AST → IR)
│   ├── runtime/        # Runtime execution
│   ├── scene/          # Scene system
│   ├── react/          # React components
│   └── tests/          # Test files
├── examples/
│   ├── yarn/           # Example Yarn scripts
│   ├── browser/        # Browser demo (Vite)
│   ├── nextjs-host/    # Next.js host example (React client)
│   ├── sveltekit-host/ # SvelteKit host example (Svelte client)
│   └── scenes/         # Scene configuration examples
├── docs/               # Documentation
└── dist/               # Compiled output
```

## Development

```bash
npm run build     # Build TypeScript
npm run dev       # Watch mode
npm run lint      # Run ESLint
npm test          # Run tests
npm run demo      # Start browser demo
npm run demo:build # Build browser demo
npm run host:build # Build library + Next.js host
npm run sveltekit:build # Build library + SvelteKit host
```

## Testing

Tests are located in `src/tests/` and cover:

* Basic dialogue flow
* Options and branching
* Variables and flow control
* Commands (`<<set>>`, `<<declare>>`, etc.)
* `<<once>>` blocks
* `<<jump>>` and `<<detour>>`
* Full featured Yarn scripts

Run tests:

```bash
npm test
```

## Documentation

Additional documentation is available in the `docs/` folder:

* [Lines, Nodes, and Options](./docs/lines-nodes-and-options.md)
* [Options](./docs/options.md)
* [Jumps](./docs/jumps.md)
* [Detour](./docs/detour.md)
* [Logic and Variables](./docs/logic-and-variables.md)
* [Flow Control](./docs/flow-control.md)
* [Once Blocks](./docs/once.md)
* [Smart Variables](./docs/smart-variables.md)
* [Enums](./docs/enums.md)
* [Commands](./docs/commands.md)
* [Functions](./docs/functions.md)
* [Node Groups](./docs/node-groups.md)
* [Tags and Metadata](./docs/tags-metadata.md)
* [Line Groups](./docs/line-groups.md)
* [Saliency](./docs/saliency.md)
* [Shadow Lines](./docs/shadow-lines.md)
* [Markup (Yarn Spinner)](./docs/markup.md)
* [Migration Notes (0.2.0 breaking changes)](./docs/migration-notes.md)
* [Compatibility](./docs/compatibility.md)
* [Changelog](./CHANGELOG.md)
* [Typing Animation (React)](./docs/typing-animation.md)
* [Actor Image Transitions](./docs/actor-transition.md)
* [Scene and Actor Setup](./docs/scenes-actors-setup.md)

## License

MIT
