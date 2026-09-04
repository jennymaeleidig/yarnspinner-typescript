# yarn-spinner-vite-plugin

Import Yarn Spinner content as build-time modules: `.yarn` files become
compiled programs, `.yarnproject` files become full load results with baked-in
localisation. No runtime compilation, no runtime file access.

```js
// vite.config.ts
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";

export default {
  plugins: [yarnSpinnerVitePlugin()],
};
```

```ts
import program from "./story.yarn";
import { Dialogue } from "yarn-spinner-runner-ts";

const dialogue = new Dialogue(program, { startAt: "Start" });
```

## What you get

- **`.yarn` import** — default export is the compiled
  [Program](https://github.com/oleksii-chekhovskyi/yarn-spinner-runner-ts);
  named exports `stringTable`, `containsImplicitStringTags`, `fileTags`.
- **`.yarn?raw`** — the raw source string.
- **`.yarnproject` import** — the full load result: `program`, project
  metadata, base/translated string tables, assets — shaped for
  `createProjectTextProvider` and localised `Dialogue` playback.
- **Diagnostics as build errors** — an error-severity diagnostic fails the
  build with a RollupError (`id`, `loc`, `frame`); warnings surface without
  failing. Severity maps merge in a fixed order — the project file's own
  first, then the plugin's (most specific wins) — before the split.
- **Dev reload** — content edits full-reload: a rebuilt program means a
  rebuilt dialogue.

## Options

```ts
yarnSpinnerVitePlugin({
  project: "./project.yarnproject",      // pin the compilation context
  definitions: ["./Commands.ysls.json"], // host Library surface for checking
  compilerOptions: { diagnosticsSeverity: { YS0012: "none" } },
  include: ["src/**"],                   // unanchored globs, layered over
  exclude: ["**/draft/**"],              // extension matching
})
```

## Editor types

```ts
/// <reference types="yarn-spinner-vite-plugin/client" />
```

in an ambient types file (or paste `client.d.ts` — it references only
`yarn-spinner-runner-ts`, so the paste-in needs nothing else).

The full story — result shapes, the generic loader contract for webpack
hosts, and when the SSR load path applies instead — lives in
[docs/direct-import.md](../../docs/direct-import.md) in the core repo.
