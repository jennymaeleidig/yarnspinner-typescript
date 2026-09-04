# 02: Delete the React adapter

**What to delete:** All of `src/react/` (9 files: `index.ts`, `useDialogue.tsx`, `DialogueRunner.tsx`, `DialogueView.tsx`, `DialogueScene.tsx`, `DialogueExample.tsx`, `MarkupRenderer.tsx`, `TypingText.tsx`, `dialogue.css`, `css.d.ts`); the `./react` entry in `package.json`'s export map and `"dist/react"` from its `files` array; the `react`/`react-dom` optional peerDependencies and the `react-dom` override; the `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react` devDependencies; the adapter-only tests from ticket 01's die-with-adapter column; the adapter re-export comment in `src/index.ts` (the root is just `export *` lines after this); the `react()` plugin from any vite config still carrying it. The core `YarnRunner` → `Dialogue` alias and the re-homed pins from ticket 01 land here.

**Verification:** full suite green with no React in the tree — `grep -r react src/` (excluding the sveltekit test's *negative assertions* about react) comes back empty; a clean build produces no `dist/react`; `npm ls react react-dom` shows nothing in the root package; the re-homed alias and React-freedom pins pass.

**Notes for the executor:**

- Package-lock regenerates with the dependency removal.
- `useYarnRunner`'s deprecation promise ends early by human decision — nothing to deprecate-print, just delete.
- Examples still importing `yarn-spinner-runner-ts/react` will be broken at the end of this ticket; that is expected and repaired by tickets 04/05 in the same session or the next. If the suite runs examples, note the expected-failure state in the Answer.

**Blocked by:** 01 (nothing deletes before the audit says what survives).

**Status:** resolved

## Answer

Executed per the audit's 8-step recommendation against a re-verified working tree (line numbers 32/40 in `deprecatedAliases.test.ts` confirmed; pre-flight re-grep of `^## Comments` across `.scratch/{framework-agnostic-consumption,direct-import-implementation}/issues/` found no comment sections — still empty, no late-landing findings).

**Deleted**
- `src/react/` — all 10 files (`index.ts`, `useDialogue.tsx`, `DialogueRunner.tsx`, `DialogueView.tsx`, `DialogueScene.tsx`, `DialogueExample.tsx`, `MarkupRenderer.tsx`, `TypingText.tsx`, `dialogue.css`, `css.d.ts`; the ticket said 9, there were 10 on disk).
- Adapter-only test files: `dialogue_view.test.tsx`, `continueScheduler.test.tsx`, `adapterOptions.test.tsx`, `clientDomHarness.ts` (test discovery is glob-based — no list to edit).

**Re-homed pins (per audit)**
- `deprecatedAliases.test.ts` trimmed to its two core `YarnRunner` pins — `"YarnRunner is a deprecated alias of Dialogue (same value)"` and `"the YarnRunner alias runs dialogue exactly like Dialogue"` — plus the alias-contract docstring (now noting `useYarnRunner` shared the contract until deletion). All hook/`DialogueRunner` alias tests and type-level checks gone.
- `dialogue_view.test.tsx:236` storylet saliency walk moved whole into `saliency.test.ts` (as `drawStorylet` + `STORYLET_YARN` + the test, adapted to that file's `compile`/`assert` style). The working-tree test **already contained** the `setSaliencyStrategy("no-such-strategy") → false` rejection pin the audit flagged as unpinned, so moving it whole covered audit step 2's "add the rejection pin" clause — no new assertion needed.
- `index.test.ts:29` strengthened in place → `"the package root and its packaging are React-free"`: root absence of `DialogueRunner`/`useDialogue`, no `"./react"` export key, no `react`/`react-dom` in `peerDependencies`/`peerDependenciesMeta`, and no `react/jsx-runtime` reference in any shipped `dist/` artifact (dist walk excluding `dist/tests` — the compiled test bundles carry the literal: this assertion's own source string, and `nextjsHost.test.js`'s JSX import until ticket 05).
- `cjsExports.test.ts`: `"./react"` dropped from `SUBPATHS` and `surfaceChecks`.

**package.json** — `./react` export block removed; `"dist/react"` removed from `files`; `peerDependencies`/`peerDependenciesMeta` objects removed entirely; `react`, `react-dom`, `@vitejs/plugin-react` devDeps removed; `description` no longer says "with React adapter" and `"react"` keyword removed (**deviation the audit anticipated: these were flagged for ticket 06, but deleting `src/react` makes them false now — ticket 06 should skip them**). Lockfile regenerated.

**Deviations from the audit (2, both flagged)**
1. `react`, `react-dom`, `@types/react`, `@types/react-dom` devDeps **stay** until ticket 05: `nextjsHost.test.tsx` (untouched per audit step 7) imports `react`/`react-dom/server` and its JSX needs the types — removing them breaks the build of a file ticket 02 must not touch. `@vitejs/plugin-react` **was** removed (adapter-only; nothing in src/scripts/packages uses it). Same logic as the audit's jsdom/@types/jsdom deferral.
2. `lint` script: dropped the `"src/**/*.tsx"` pattern. With the adapter `.tsx` files gone, the only remaining match (`nextjsHost.test.tsx`) sits under eslint's ignored `src/tests/**`, so ESLint hard-fails on an all-ignored glob. Reversible in ticket 05 if a `.tsx` ever returns outside src/tests.

**Gate results**
- Suite (`npm test` = build:all + scripts/run-tests.js): 627 tests — 625 pass, 1 fail, 1 skipped. The skip is pre-existing (`port: TestUnreferencedNodesCreateDiagnostics — skipped upstream`). The one failure is `browserDemo.test.ts` `"the browser demo builds end-to-end through the real plugin"`: `examples/browser/vite.config.ts` imports the removed `@vitejs/plugin-react` — the expected broken-examples state; ticket 04 repairs it.
- `npm run lint`: green (after deviation 2).
- `npm run ts-check`: green.
- Clean build (`npm run clean` + full build:all): no `dist/react` produced; stale compiled React test artifacts flushed by the clean.
- `npm ls react react-dom --depth=0`: react/react-dom no longer direct deps of the root package (they remain in the tree only as `next`'s transitive deps — ticket 05's removal). No `peerDependencies` section remains.
- `grep -r react src/` (case-sensitive): only a false positive ("reacts" in upstreamUnitPorts.test.ts) and the new React-free pin's own negative assertions. Case-insensitive leftovers: three historical doc comments in `src/runtime/transcript.ts` referring to "the React adapter" in the past tense — core src, outside this ticket's edit scope; ticket 06's doc sweep should scrub them.

**Expected-broken state**: examples/ untouched per ground rules. `examples/browser` (and its acceptance test) fails on the missing `@vitejs/plugin-react`; `examples/nextjs-host` compiles but its harness still runs React (ticket 05); anything importing `yarn-spinner-runner-ts/react` no longer resolves. SvelteKit host + `sveltekitHost.test.ts` green (negative React assertions intact).

## Comments
