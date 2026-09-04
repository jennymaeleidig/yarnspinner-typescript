# 04: Browser demo rewritten against the vanilla runtime

**What to build:** `examples/browser/` runs the same shared content (`examples/content/` project, storylets tab, crossroads → night-market chain) on the vanilla runtime — `Dialogue` constructed from the plugin-emitted module, `Transcript` read directly, no `yarn-spinner-runner-ts/react` import anywhere. The acceptance-harness contract from direct-import 08 survives intact: imports resolve through `dist/` (root export) and the plugin's direct-import contract, the vite alias to `../src` stays gone, content loads via direct import — no inline template strings, no manual compile calls. A test still builds the demo end-to-end through the real plugin and asserts success.

**Blocked by:** 02 (adapter gone), 03 (the demo implements the ownership decisions).

**Status:** resolved

## Answer

`examples/browser/` is now a React-free vanilla demo — plain TypeScript DOM, no framework, no view layer, implementing ticket 03's rulings exactly (manual continue/option input only, no typing effect, no markup rendering — `textContent` everywhere, hosts read `Transcript` raw).

**What it does now**

- `main.ts` hosts the two tabs (vanilla tablist + hidden panels); `dom.ts` is a 12-line `el()` helper shared by the tabs.
- Dialogue tab (`dialogueDemo.ts`): constructs `new Dialogue(wayside.program, { startAt: "Start" })` from the plugin-emitted `../content/project.yarnproject` import, then a deletion-shaped loop — `runUntilStopped` pulls the transcript, lines + surfaced commands render as plain text, a delivered option set renders as buttons (`selectOption(index)`), otherwise a Continue button (`step()`), and on `stopped === "complete"` a Restart button rebuilds the Dialogue. Verified by simulation: all three branch paths (map→Chapel; walk→lantern→Alleys; walk→keep-walking) play to `dialogueComplete`.
- Storylets tab (`StoryletsDemo.ts`): same storylet story as before, vanilla — strategy buttons over the five built-in modes, Draw (`setNode("Storylets")` + `runUntilComplete`), Reset (fresh `Dialogue` proves the storage-backed view-count history is instance-local), draw history, and story variables (`getVariables`). The old saliency-options table was dropped as presentation beyond "just a demo" (03's ruling); the panel still exercises `setSaliencyStrategy`/`hasSalientContent`.
- `dialogue.css` rewritten demo-owned (tabs, buttons, cards, chips — no `.yd-*` scene/actor classes, which belonged to the deleted view); `index.html` loads `/main.ts` into `#app`; `vite-env.d.ts` unchanged (the plugin client types are still the ambient declarations for the content imports).

**Deleted:** `main.tsx`, `StoryletsDemo.tsx`, and `scenes.ts` (the demo-owned YAML scene parser — its only consumer was the adapter's scene view, dropped by 03). `vite.config.ts` drops the `@vitejs/plugin-react` import and plugin; it is just `yarnSpinnerVitePlugin()` now.

**Acceptance-harness contract preserved** (no edits to `src/tests/browserDemo.test.ts` needed — its assertions hold as written):

- Imports resolve through the package name / workspace → `dist/` root export; no source alias, no `../src` reference.
- Content loads via direct import through the plugin: the shared `examples/content/project.yarnproject` (crossroads → night-market chain intact) and `storylets.yarn`; no inline template strings, no manual compile calls.
- The test builds the demo end-to-end through the real plugin and asserts the bundle carries the compiled program (`runLine`), shared-content text (`Rogue`), and no src-tree references — all confirmed against the fresh `dist-demo` bundle.

**Gate results:** full suite `npm test` → 627 tests, 626 pass, 0 fail, 1 skip (the pre-existing upstream skip); `npm run lint` green; `npm run ts-check` green. Examples sit outside both `lint` and `ts-check` globs, so the demo was additionally type-checked explicitly (`tsc --noEmit --strict` over `examples/browser/*.ts`, exit 0).

**Deviations / notes for ticket 06's doc sweep:** deleting `scenes.ts` leaves three stale doc references — `docs/scenes.md` (`examples/browser/scenes.ts` as host starting point), root `README.md` (three mentions, all already React-adapter-shaped) — and `src/tests/saliency.test.ts:575`'s comment says "mirrors examples/browser/StoryletsDemo.tsx" (the `.tsx` is now `.ts`; content unchanged). All doc-tier, untouched here per ground rules.

## Comments
