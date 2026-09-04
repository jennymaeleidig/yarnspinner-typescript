# 02: Reachable loader seam — export the compile functions from the plugin package

**What to build:** The spec's generic-loader contract (compileYarnModule/compileYarnProjectModule as pure, bundler-agnostic functions a webpack-loader author imports) is currently documentation of an unreachable seam: `packages/vite-plugin/src/index.ts` doesn't re-export them and the exports map (`.` + `./client` only) blocks deep imports. Re-export both functions (and their result/options types if they aren't already) from the plugin's main entry, so `import { compileYarnModule, compileYarnProjectModule } from "yarn-spinner-vite-plugin"` type-checks and works at runtime. A test pins the surface (the names resolve and execute through the package entry).

**Sanctioned declination (do not do):** consolidating the glob matcher (`index.ts`'s `matchSegment` family vs core `matchGlob`) — deferred with a pointer on the map.

**Blocked by:** None.

**Status:** resolved

## Answer

`packages/vite-plugin/src/index.ts` re-exports the bundler-agnostic compile steps from the package's main entry — `compileYarnModule`, `compileYarnProjectModule`, and their types `CompiledYarnModule` / `CompileYarnOptions` — with a comment stating the seam's intent (the webpack-loader contract is importable, not just documented; the exports map blocks deep imports, so the main entry is the only reachable surface). The functions were already imported there; the re-export adds no new dependency edge.

Pinned by `src/tests/vitePluginExports.test.ts`: both names resolve through `yarn-spinner-vite-plugin` AND execute (module code emitted, errors empty, the emitted `.yarn` module imported and driven through `Dialogue`; the project module verified pure-data). The type imports (`CompiledYarnModule`, `CompileYarnOptions`) pin the type surface through the same entry.

No deviation from the ticket. One build-order note: `pretest`'s `build:all` builds the core (whose tests import the plugin package) before the plugin, so the plugin's dist must exist for the core build — pre-existing behavior (the plugin suites already imported the package), not introduced here.

- [x] `import { compileYarnModule, compileYarnProjectModule } from "yarn-spinner-vite-plugin"` type-checks and works at runtime
- [x] Result/options types exported alongside
- [x] A test pins the surface (names resolve and execute through the package entry)
- [x] Sanctioned declination honored: glob-matcher consolidation untouched
