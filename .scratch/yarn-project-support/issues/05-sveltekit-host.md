# 05: SvelteKit host

**What to build:** the Next.js host's story with zero React anywhere — the
strongest proof the runtime is framework-agnostic: project load via the
loader (ticket 02), `Dialogue`'s continue loop rendered natively in Svelte,
variable-storage reset demonstrated. Same acceptance-harness role, same
minimalism — one dialogue flow from the authored examples content, an example
app rather than package surface.

**Blocked by:** 02 (loader core)

Type: task

**Status:** resolved

- [x] Project load via the loader; native Svelte rendering of the continue
      loop, no React in the tree
- [x] Variable-storage reset demonstrated
- [x] Builds clean in CI; server-rendered dialogue output asserted through
      `Dialogue`
- [x] README documents framework support as demonstrated across both hosts

## Landing notes (ticket 05)

- **App**: `examples/sveltekit-host/` — SvelteKit 2 + Svelte 5 runes,
  adapter-static with `prerender = true` (+layout.js), so `vite build`
  prerenders the page: `loadYarnProject()` (the ticket-02 loader through the
  ticket-04-proven Node provider) runs in `+page.server.ts` at **build
  time**, and the opening pull's server-rendered dialogue output ships baked
  into the static HTML (verified in-session: the built `index.html` carries
  the Night Market content). The `.server.ts` suffix keeps the Node import
  out of the client bundle — the client gets data, never file access. The
  compiled program crosses the load boundary as load data — a plain
  serializable object (ADR 0001) — devalue-serialized by SvelteKit.
- **Native Svelte continue loop**: `src/lib/DialogueHost.svelte` — runes
  state, no framework adapter, zero React in the tree. One `continue()`
  batch per Continue; option buttons plus `noOptionSelected` fall-through;
  Reset = fresh `Dialogue` = variable-storage reset (§4: declares reseed,
  generated state clears, story replays from the top). Variable chips read
  `getVariables()`.
- **Content**: the app's own authored project
  (`content/project.yarnproject` + `content/night_market.yarn`) — declares,
  a price-gated option with a conditional jump, and a live `{expr}`
  substitution line. Hosts stay self-contained per the map's "no inter-host
  edge" split (the Next host keeps crossroads; this one authors the Night
  Market).
- **Resolution**: package-name import of `yarn-spinner-runner-ts` via the
  root package.json's `exports` self-reference (the ticket-04 mechanism,
  now proven under Vite as well as Next). `sveltekit:build` /
  `sveltekit:dev` npm targets `cd` into the host directory — the standard
  SvelteKit workflow (SvelteKit, unlike `next build <dir>`, runs from the
  app dir) — and the server load resolves `content/` from there.
- **Dependencies**: svelte stack at the repo root devDeps, mirroring
  ticket 04's structure: `@sveltejs/kit@^2.70.3` + `@sveltejs/vite-plugin-svelte@^4.0.4`
  (the v4 line — peers vite ^5, matching the repo's pinned vite), `@sveltejs/adapter-static@^3.0.10`,
  `svelte@^5.57.0`. Empty PostCSS pin in the host's vite config (the
  ticket-52 hermetic-build lesson). Host typechecks clean via
  `tsc -p examples/sveltekit-host` (hand-written tsconfig, the ticket-04
  shape; no svelte-check dependency).
- **Tests**: 7 in `src/tests/sveltekitHost.test.ts` — server-side load of
  the real content files, program JSON round-trip, source-level Node/React
  split (only `+page.server.ts` touches the Node subpath / `node:` builtins;
  zero React imports anywhere; `dist/index.js` node-free per §2), and the
  reset/flow/walk-on/fall-through behavioral asserts through `Dialogue`. The
  SSR harness goes one step further than the Next host's JSX mirror: it
  compiles the **real** `DialogueHost.svelte` with `svelte/compiler` (both
  generations must compile warning-free — client generation is what the
  browser hydrates, handlers included) and renders it with `svelte/server`
  — the component file is the single source of truth for the
  server-rendered output, and the harness itself is the no-React proof
  (asserted: no React markers in the rendered tree).
- **CI**: `sveltekit:build` builds clean in-session (adapter-static,
  prerender verified). The CI workflow edit itself is ticket 53, per the
  ticket-04 precedent recorded in its landing notes.
- **Docs**: README "SvelteKit host" section (framework support documented
  across both hosts), stale Project Structure/Development sections fixed in
  the same change (§7 — they pre-dated this ticket missing both hosts),
  `examples/sveltekit-host/README.md`.
- **Suite**: 458/458 (451 + 7), lint clean, host typecheck clean.
- **Two-axis code review**: Standards 5 met / 1 partial / 1 n/a; Spec 4 met
  / 2 partial / 0 missing. Partials are the ticket-04 disclosures verbatim
  (CI wiring is ticket 53; the SSR harness exercises the first pull — the
  interactive handlers are asserted through `Dialogue` and compile-checked
  at client generation, but can't execute inside a server render).
  Resolutions: structured `Diagnostic[]` cross the load boundary (not
  string-flattened — mirrors ticket 04's resolution, verified through
  devalue by the adapter-static build); the UI text says `loadYarnProject()`
  (what the server load calls — ticket 04's resolution, applied before
  mirroring could regress it); `pump` renamed `pull` and the state-sync
  helper `deliver` (glossary: Continue is the pull operation; `advance` is
  a retired term); `host` is `$state.raw` so the `Dialogue` class instance
  is held by reference, structurally outside reactivity; test drain loop
  deduplicated into `runUntilComplete`; single-use `renderHost` wrapper
  inlined; stray root-level `.svelte-kit/` (from off-script invocation
  attempts) deleted. Not acted on, disclosed: §6 deep import of
  `../compile/nodeProjectFs.js` in the test (ticket-02/04 prior art — the
  module behind the public `./node` subpath); `HostProps` hand-synced with
  the component (a .svelte file has no importable type surface); root
  README Project Structure/Development stale-section fixes kept (§7 — they
  pre-dated this ticket missing both hosts).
