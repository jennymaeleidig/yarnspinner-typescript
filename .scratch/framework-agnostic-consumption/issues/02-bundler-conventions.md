# Ticket 02 — Bundler virtual-module conventions and precedents

Type: research
Status: resolved

## Question

What are the established conventions for shipping a "compile a file format at import time" bundler plugin, and which should this project's Vite plugin follow? Investigate against primary sources (official docs and source repos, not blog posts):

- Vite plugin API: virtual module ids (`\0` prefix convention), `resolveId`/`load`, `enforce: 'pre'`, `handleHotUpdate`, `?raw`/`?url` suffix interplay — from vitejs.dev docs and Vite's own source.
- The `unplugin` cross-bundler abstraction: does it cover webpack/esbuild/Turbopack well enough to justify building on it vs a Vite-only plugin?
- Precedents: `@mdx-js/rollup` (MDX → JS at import), `vite-plugin-svgr`, GraphQL tools' plugins, `@sveltejs/vite-plugin-svelte` — how each names virtual modules, surfaces compile diagnostics as build errors, and handles TS types for the imported extension (d.ts shipping conventions).
- How SvelteKit and Next interact with Vite plugins (SvelteKit uses Vite; Next does not — confirm the boundary for the docs' framework-support statement).

Deliverable: research note at `.scratch/framework-agnostic-consumption/research/02-bundler-conventions.md`, cited, ending with a recommendation table (virtual-module id scheme, query-param handling, diagnostic surfacing, unplugin vs Vite-only, d.ts strategy).

## Answer

Research note written to [`research/02-bundler-conventions.md`](../research/02-bundler-conventions.md) (primary-source cited). Gist: (1) compile real file ids in-place (like @mdx-js/rollup, vite-plugin-svelte, vite-plugin-svgr); reserve `virtual:` ids with the `\0`-prefix convention for plugin-internal glue only; (2) bail on Vite's built-in `?raw`/`?url`/`?inline` queries (mdx-js cites vitejs/vite#22417) — `?raw` remains the source-string hatch; (3) fatal compile errors thrown as RollupError with `id`/`loc`/`frame`, warnings via `this.warn` with `loc`+`pluginCode` (vite-plugin-svelte is the model); (4) recommend Vite-only plugin with the compiler extracted as a pure function — unplugin covers webpack/esbuild but hides Vite-specific hooks (handleHotUpdate) and has no Turbopack story, since Next/Turbopack only accepts webpack loaders (`turbopack.rules`); a thin webpack loader over the same function is the later cross-bundler path; (5) d.ts: ship a referenceable `client` d.ts with ambient `declare module "*.yarn"` / `"*.yarn?raw"` / `"*.yarnproject"` (vite-plugin-svgr convention). SvelteKit is Vite-based (first-class coverage confirmed); Next.js is webpack/Turbopack only — boundary statement for the docs settled.
