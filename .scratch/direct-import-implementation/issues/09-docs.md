# 09: Docs — direct import, loader contract, framework boundary

**What to build:** The docs tell the whole consumption story: every import shape with its result and options; the ambient-types reference path and the paste-in fallback; the generic loader contract (pure compile function + the webpack-loader path for Next.js webpack mode and Turbopack rules) with explicit guidance on when the SSR load path applies instead; and the framework boundary statement (Vite first-class including SvelteKit, webpack-loader path documented, Next SSR path unchanged). The React subpath import change is reflected wherever the README shows package imports.

**Blocked by:** 06 (types documented), 08 (acceptance harness demonstrates the story).

**Status:** resolved

## Answer

`docs/direct-import.md` tells the whole consumption story: all three import shapes with result-shape tables, the diagnostics-as-build-errors contract, the full plugin options surface (project / definitions / compilerOptions / include+exclude), the editor-types reference path and paste-in fallback (one file serving both), the generic loader contract (compileYarnModule / compileYarnProjectModule are Vite-type-free — the webpack-loader shim maps errors to this.emitError; Next.js webpack mode covered, Turbopack has no loader API yet), the framework-boundary statement (Vite first-class incl. SvelteKit), and explicit guidance on when the SSR load path applies instead (deployment data vs baked-in bundles).

React subpath reflected everywhere: README's React Usage / DialogueRunner / DialogueExample examples now import from `yarn-spinner-runner-ts/react` with an explicit root-stays-React-free note; docs/scenes.md and docs/migration-notes.md imports updated; the features list and the YarnProject loader section link the new doc; the plugin's own README rewritten to the full implemented surface.

- [x] All import shapes documented with result shapes and the full options surface
- [x] Editor-types reference path and paste-in fallback both documented
- [x] Generic loader contract and Next.js/Turbopack guidance written
- [x] Framework boundary statement present; React subpath reflected in all import examples
- [x] Docs reviewed against the spec for drift (written from the implemented contracts; final reviewer pass follows)
