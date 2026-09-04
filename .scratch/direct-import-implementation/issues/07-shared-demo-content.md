# 07: Shared demo content project

**What to build:** One demo `.yarnproject` (project file plus `.yarn` sources) lives under the examples tree, and all SSR hosts tell that story: the Next.js and SvelteKit hosts re-point their existing SSR load path at it and their architectures (RSC split, prerender) stay untouched. The per-host content copies disappear. The root project file and its fixture `.yarn` remain, still scoped to upstream-parity test material. Independent of the plugin — hosts use the existing loader.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Answer

One shared demo project at `examples/content/`: `project.yarnproject` ("Wayside") + `crossroads.yarn` (the entry story) + `night_market.yarn` (its `Start` renamed `NightMarket`, reached through crossroads' walk-on path — which gains `<<jump NightMarket>>`, so the lantern flow stays playable from one project with no duplicate node titles). Both SSR hosts point their existing SSR load path at it (Next.js: `examples/content` from the repo root; SvelteKit: `../content` from the host cwd — the RSC split and prerender untouched). Deleted: per-host content dirs, `examples/scenes/`, and the `examples/react/` stubs (the consolidation decisions). The root `.yarnproject` and `examples/yarn/full_featured.yarn` remain the upstream-parity fixture, untouched.

Test-flow note for the record: the runtime's pulls stop per line (option bodies run only when their option is selected), so `noOptionSelected` — falling through with no selection — still ends the dialogue; only the explicit walk-on choice reaches the night market.

- [x] The shared demo project loads and compiles through the Node loader path (both host harnesses + demo builds)
- [x] Next.js host runs on the shared content via its existing SSR path
- [x] SvelteKit host runs on the shared content via its existing SSR path
- [x] Per-host content directories are gone (plus scenes.yaml and the react stubs); the parity fixture and its project file are untouched
- [x] Host conformance tests stay green (650 pass); demo builds stay green (next build + sveltekit vite build + prerender)
