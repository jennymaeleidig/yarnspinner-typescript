# Direct import: `.yarn` and `.yarnproject` as build-time modules

With [yarn-spinner-vite-plugin](https://www.npmjs.com/package/yarn-spinner-vite-plugin), Yarn Spinner
content participates in the frontend build like any other asset: content is
compiled at build time, nothing compiles or reads files at runtime, and a
type error in your story fails the build like any other error. Vite is the
first-class host (including SvelteKit); webpack hosts are covered by the
loader contract below.

## Setup

```bash
npm install yarn-spinner-runner-ts yarn-spinner-vite-plugin
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";

export default defineConfig({
  plugins: [yarnSpinnerVitePlugin()],
});
```

The plugin compiles real file ids in place (the mdx/svelte precedent) — no
virtual modules. `?raw` returns the raw source string; `?url`, `?inline`,
`?no-inline`, and any other query bail so Vite core (or another plugin) owns
them. Content edits to `.yarn` and `.yarnproject` files trigger a full page
reload in dev: a rebuilt program means a rebuilt dialogue, and variable
storage resets regardless.

## Import shapes

### `import story from "./story.yarn"`

The default export is the compiled, serializable
[Program](../README.md#api-reference) — hand it straight to `Dialogue`:

```ts
import program from "./story.yarn";
import { Dialogue } from "yarn-spinner-runner-ts";

const dialogue = new Dialogue(program, { startAt: "Start" });
```

The emitted module also carries tree-shakeable named exports:

| Export                       | Type                       | What it is                                                            |
| ---------------------------- | -------------------------- | --------------------------------------------------------------------- |
| `stringTable`                | `StringTable`              | Line id → text/node/line info (the full upstream table)               |
| `containsImplicitStringTags` | `boolean`                  | Whether the compiler created line IDs for lines lacking `#line:` tags |
| `fileTags`                   | `Record<string, string[]>` | The file's file-level hashtags                                        |

### `import source from "./story.yarn?raw"`

The default export is the exact source string — useful for showing script
text in an editor pane or teaching UI.

### `import project from "./project.yarnproject"`

The default export is the full build-time load result: the project compiles
as one job (source globs resolved, strings CSVs read, localisation baked in)
and the module is pure data — no runtime file access.

```ts
import project from "./project.yarnproject";
import {
  createProjectTextProvider,
  Dialogue,
} from "yarn-spinner-runner-ts";

const provider = createProjectTextProvider(project);
const dialogue = new Dialogue(project.program!, { textProvider: provider });
dialogue.setLanguage("de"); // localised delivery; missing lines fall back
```

| Field                         | What it is                                                           |
| ----------------------------- | -------------------------------------------------------------------- |
| `program`                     | The compiled program (`null` when the project failed to load)        |
| `projectName`, `baseLanguage` | Project metadata                                                     |
| `baseTable`                   | Base language's id → text table (shadow lines excluded)              |
| `translations`                | Per-locale id → text tables                                          |
| `assets`                      | Configured assets directory per declared locale, verbatim            |
| `diagnostics`                 | Localisation diagnostics (e.g. a missing strings file warns, YP0006) |

An error-severity diagnostic anywhere in the compiled content fails the build
with a RollupError-shaped error (`id`, `loc`, `frame` — clickable in the
terminal and the Vite overlay); warnings surface through Vite's warning
channel without failing, each carrying its code, message, and source
location (file, and line:column when the diagnostic has a range). Severity overrides merge in a fixed order — the
project file's `compilerOptions.diagnosticsSeverity` map first, then the
plugin's options (top-level `diagnosticsSeverity`, then the
`compilerOptions` passthrough, most specific winning) — applied before that
split, so a downgraded error does not fail the build and the plugin can
escalate a project-downgraded code back. The per-code merge of the project
map under a host-supplied `diagnosticsSeverity` is `loadProject`'s own
semantics, so a direct `loadProject` caller gets the same precedence without
the plugin.

## Plugin options

```ts
yarnSpinnerVitePlugin({
  // Pin an explicit .yarnproject as the compilation context for .yarn
  // imports: the project compiles as one job and .yarn imports emit its
  // result. No upward discovery — unpinned imports stay standalone.
  project: "./project.yarnproject",

  // .ysls.json-shaped definitions — file paths or inline objects — feed
  // build-time signature checking (the host's Library surface).
  definitions: ["./Commands.ysls.json"],

  // Compiler-options passthrough, merged over the pinned project's own
  // compilerOptions: the project's map first, then the top-level
  // diagnosticsSeverity option, then these (most specific wins).
  compilerOptions: { diagnosticsSeverity: { YS0012: "none" } },

  // Unanchored glob-or-RegExp filters layered over extension matching.
  include: ["src/**"],
  exclude: ["**/draft/**"],
})
```

## Editor types

All three import shapes type-check once TS knows the ambient declarations.
Either reference the shipped file (one line in an ambient types file, e.g.
`src/vite-env.d.ts`):

```ts
/// <reference types="yarn-spinner-vite-plugin/client" />
```

or paste [`packages/vite-plugin/client.d.ts`](https://github.com/oleksii-chekhovskyi/yarn-spinner-runner-ts/blob/main/packages/vite-plugin/client.d.ts)
verbatim into your ambient types — it references only `yarn-spinner-runner-ts`
types (which you have installed), never the plugin package, so the paste-in
works with zero extra dependencies.

One deviation is documented rather than typed: a `.yarn` import pinned to a
project (the `project` option) emits the full one-job load result — the same
shape as a `.yarnproject` import — not a bare `Program`, and none of the
named exports. TypeScript cannot vary an ambient declaration by plugin
option, so `*.yarn` types the common unpinned case; a host using `project`
types its import as `YarnProjectLoadResult`, declared by `client.d.ts` and
in scope once the reference (or paste-in) is present.

## Framework boundary

**The package is framework-agnostic — end to end.** There is no framework
adapter: the package root ships no UI layer of any kind, and hosts own their
UI against `Dialogue`/`Transcript` directly — pull events, render the line
and options, act on input, repeat. The examples in this repo demonstrate the
pattern in three frameworks on the same surface: a plain-TypeScript browser
demo (`examples/browser/`), a Next.js app (`examples/nextjs-host/`), and a
SvelteKit app (`examples/sveltekit-host/`). They are just a demo — no helper
library, no presentation framework; read `Transcript` raw and render it your
way.

**Vite first-class** — the plugin targets Vite (5/6/7) and works in SvelteKit
unchanged; the browser demo in this repo is built through it as an acceptance
harness.

**The compile step is bundler-agnostic — and importable.** The plugin package
exports `compileYarnModule` (`.yarn` source → emitted module text +
errors/warnings partition) and `compileYarnProjectModule` (`.yarnproject` →
same) from its main entry: both import no Vite types. A webpack loader is a
thin shim: import the same functions from `yarn-spinner-vite-plugin`, map
`errors` to `this.emitError` and `warnings` to `this.warn`. For Next.js:
a loader covers **webpack mode**; **Turbopack** has no loader API yet — use
`webpack: (config) => { ... }` config escape or, until then, the SSR path
below.

**When the SSR load path applies instead.** Server-rendered hosts that
compile once per deploy (Next.js server components, SvelteKit `+page.server.ts`)
can skip bundler integration entirely: call
`loadYarnProject("path/to/project.yarnproject")` from
`yarn-spinner-runner-ts/node` at request/build time and pass the program
across the serialization boundary. Choose the plugin when content should be
baked into client bundles and versioned with them; choose the SSR path when
content is deployment data (CMS-updatable without a rebuild) or when your
bundler has no loader seam.
