# 08: Browser demo as acceptance harness + examples cleanup

**What to build:** The browser demo consumes the published package: the package-name source alias is gone, imports resolve through the build output (root and the React subpath), and dialogue content loads via direct import through the plugin from the shared demo project — no inline template strings, no manual compile calls. A test builds the browser demo end-to-end through the real plugin and asserts success, making it the acceptance harness for the public surface and the plugin at once. The vestigial re-export stubs and the orphaned scene asset are deleted.

**Blocked by:** 02 (plugin exists), 04 (project import contract), 07 (shared content exists).

**Status:** resolved

## Answer

The demo now consumes the published surface: `main.tsx` imports the React adapter through `yarn-spinner-runner-ts/react` and the runtime through the package root — the vite alias to `../src` is gone. Content loads via direct import through the plugin: the Dialogue tab runs the shared project (`import wayside from "../content/project.yarnproject"`, the whole shared story incl. the crossroads→night-market chain), and the storylets tab runs `examples/content/storylets.yarn` (the inline template deleted; its `Start` renamed `StoryletsIntro` — a duplicate-title YS0011 in the shared project — with its subtitle hyphen fixed per YS0027). Styling is demo-owned (the package ships no CSS; `dialogue.css` copied into the demo). `DialogueExample`'s usage is replaced by a host-owned `DialogueRunner` composition — the react subpath still exercised, now on shared content.

The acceptance test (`src/tests/browserDemo.test.ts`) runs `vite build` with the demo's config through the real plugin and asserts: artifacts produced, the compiled program rides the bundle (`runLine` + shared-content text baked in — build-time compilation, not fetching), and no src-tree references leak (no aliasing). The SSR hosts' sources assertions gained `storylets.yarn`.

- [x] No source aliasing: the demo resolves the package name through the published surface (alias removed; bundle asserted src-free)
- [x] Dialogue runs from the shared content loaded via plugin direct import (project import for the runner, storylets.yarn for the saliency demo)
- [x] End-to-end test builds the demo through the real plugin and asserts success (vite build + bundle proof)
- [x] Re-export stubs and the orphaned scene asset are deleted with no dangling references (react stubs + scenes.yaml deleted in ticket 07; demo's inline template gone)
- [x] Demo build and full suite green — 660 tests, 659 pass, 0 fail, 1 skip; lint + ts-check clean
