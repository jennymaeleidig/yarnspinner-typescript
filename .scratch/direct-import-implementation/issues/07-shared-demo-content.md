# 07: Shared demo content project

**What to build:** One demo `.yarnproject` (project file plus `.yarn` sources) lives under the examples tree, and all SSR hosts tell that story: the Next.js and SvelteKit hosts re-point their existing SSR load path at it and their architectures (RSC split, prerender) stay untouched. The per-host content copies disappear. The root project file and its fixture `.yarn` remain, still scoped to upstream-parity test material. Independent of the plugin — hosts use the existing loader.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The shared demo project loads and compiles through the Node loader path
- [ ] Next.js host runs on the shared content via its existing SSR path
- [ ] SvelteKit host runs on the shared content via its existing SSR path
- [ ] Per-host content directories are gone; the parity fixture and its project file are untouched
- [ ] Host conformance tests stay green; demo builds stay green
