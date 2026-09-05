# SvelteKit host

The Next.js host's story with zero React anywhere — the strongest proof the
runtime is framework-agnostic. A worked SvelteKit example: the YarnProject
loader runs server-side, the compiled program crosses the load boundary as a
plain serializable object, and `Dialogue`'s pull-based continue loop renders
natively in a Svelte 5 runes component. An example app, not package surface.

## Run it

```bash
npm run sveltekit:build   # from the repo root: builds the library (dist/), then `vite build` the host
npm run sveltekit:dev     # dev server for the host
```

The npm targets `cd` into this directory — the standard SvelteKit workflow —
and the server load resolves the content directory relative to it
(`process.cwd()` is this directory while Vite runs).

## How the story fits together

- **Server side** (`src/routes/+page.server.ts`): `loadYarnProject()` loads
  the shared demo project — `examples/content/project.yarnproject` +
  `examples/content/crossroads.yarn` + `examples/content/night_market.yarn` — through the Node file-access provider
  (`nodeProjectFs`). This is the injected file-access seam earning its keep:
  the loader core never touches Node APIs. The `.server.ts` suffix keeps the
  import out of the client bundle entirely — the client gets data, never
  file access.
- **The load boundary**: the only thing passed to the page is the compiled
  program — a plain serializable object (ADR 0001) — plus loader context
  (project name, resolved sources, diagnostics), which SvelteKit serializes
  to the client.
- **Client side** (`src/lib/DialogueHost.svelte`): imports the package's
  main entry only, which is browser-safe by construction (coding standard
  §2 — no `node:` builtins in the bundle). Runes state, no framework
  adapter, zero React in the tree. The first pull runs during the initial
  render — on the server too — so the opening line is in the SSR output;
  Continue delivers one `continue()` batch; option sets render as buttons
  (plus a `noOptionSelected` fall-through); Reset demonstrates
  variable-storage reset — a fresh `Dialogue` is a fresh storage, so the
  `<<declare>>` seeds reapply and the story replays from the top (coding
  standard §4).
- **Prerendering** (`+layout.js` + adapter-static): the page is prerendered,
  so the loader call and the first pull's server-rendered dialogue output
  run at build time and ship baked into the static HTML.
- **Resolution**: the app imports `yarnspinner-typescript` by package name;
  Node and Vite resolve it through the root package.json's `exports`
  self-reference, to the built `dist/`. Build the library first
  (`sveltekit:build` does).

## Tests

`src/tests/sveltekitHost.test.ts` mirrors the browser demo-harness
pattern: the content files are the single source of truth (loaded through
the same server-side path +page.server.ts uses), the client component's
initial-pull logic is mirrored in the test (tests compile from src only —
no package surface for a one-app example), and the reset story is asserted
behaviorally through `Dialogue`. The SSR harness goes one step further than
the Next host's JSX mirror: it compiles the **real** `DialogueHost.svelte`
with `svelte/compiler` (server generation) and renders it with
`svelte/server` — the component file is the single source of truth for the
server-rendered output, and the harness itself is the no-React proof.
