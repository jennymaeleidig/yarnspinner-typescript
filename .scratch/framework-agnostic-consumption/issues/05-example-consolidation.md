# Ticket 05 — Example consolidation design

Type: grilling
Status: resolved
Blocked by: 03, 04

## Question

Decide the target state of `examples/` as spec text: one shared demo `.yarnproject` asset (where it lives, what content it holds — resolving the three-copies drift and the orphaned `examples/scenes/scenes.yaml` and root `yarn-spinner-runner-ts.yarnproject` coverage gap); the browser demo rebuilt as the acceptance harness (imports the published package surface through `dist/` and consumes the new plugin, no src aliasing); what happens to the `examples/react/` re-export stubs (audit recommends deletion); and how nextjs-host/sveltekit-host adopt the shared asset while keeping their SSR load path.

## Answer

All five sub-decisions resolved (human accepted recommendations, 1 round). Facts gathered first: `examples/react/` has zero references anywhere in repo; `examples/yarn/full_featured.yarn` is a test fixture consumed via the root `.yarnproject` (`commandKind` tests); the two hosts demo different stories (crossroads / night_market), so the audit's "three copies" was part drift, part intentional variety.

1. **Shared demo content**: one `.yarnproject` at `examples/content/` — all three hosts (browser, nextjs, sveltekit) tell the same story; the framework-agnostic pitch becomes one content, many hosts.
2. **Root `.yarnproject` + `examples/yarn/`**: kept as-is — upstream-parity test fixture, deliberately separate from demo content.
3. **Browser demo = acceptance harness**: drops the `../src` alias, imports the published package surface (root + `./react`) so `dist/` is exercised, and consumes the shared `.yarnproject` via direct import through `yarn-spinner-vite-plugin` — inline `DEFAULT_YARN`/`STORYLET_YARN` strings and manual `compileSource` calls go away.
4. **Hosts**: nextjs-host and sveltekit-host point their existing SSR `loadYarnProject` path at `examples/content/project.yarnproject`; architectures (RSC split, prerender) untouched.
5. **Cleanup**: delete `examples/react/` (zero references) and `examples/scenes/scenes.yaml` (orphan). Shipped `DialogueExample` keeps its self-contained inline demo string — removing it is a React adapter API change, out of scope; the spec notes its inline content is intentionally self-contained, not part of the demo-content story.
