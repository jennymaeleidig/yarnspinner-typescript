# 01: Adapter test-surface audit — what dies, what must be re-homed first

**Type:** research

**The question:** The adapter's test suite (`dialogue_view.test.tsx`, `continueScheduler.test.tsx`, `adapterOptions.test.tsx`, `deprecatedAliases.test.ts`, `nextjsHost.test.tsx`, plus the adapter assertions inside `index.test.ts`, `cjsExports.test.ts`, `clientDomHarness.ts`) pins a mix of adapter behavior and core behavior. Deleting `src/react/` deletes all of it. Which pins are **adapter behavior** (die legitimately with the adapter), and which pin **core behavior through the React harness** and need a new core-side home before ticket 02 deletes anything?

Known suspects from plotting (verify, don't assume):

- `deprecatedAliases.test.ts` pins BOTH the core `YarnRunner === Dialogue` alias (must survive per the human's ruling — needs a non-React test home) and the `useYarnRunner` alias (dies with the hook).
- `index.test.ts` pins that `DialogueRunner` is absent from the root export — the React-freedom-of-root pin likely becomes trivial (no React anywhere), but check whether a stronger pin is warranted (e.g. no `react`/`react-dom` in dependencies/peerDependencies at all, and no `jsx-runtime` in the emitted `dist/`).
- `cjsExports.test.ts` iterates the `./react` subpath — must be edited when the export map shrinks, not ported.
- `continueScheduler.test.tsx` claims to test the scheduler "headless — a host's own useDialogue + DialogueView, no runner" — determine whether the scheduling semantics it exercises are adapter-internal (`scheduleContinue` in `DialogueView.tsx`) or core `Dialogue`/`Transcript` semantics pinned elsewhere. If core, name the existing test that covers them or flag the gap.
- The type-level mutual-assignability pins in `adapterOptions.test.tsx` (`DialogueViewOption` derived from `DialogueOption`, `TranscriptLine` flow) — `DialogueViewOption` dies with the adapter; check whether `Transcript`-type pins exist core-side already.
- Anything the landed two-axis review of the open `.scratch/` efforts flagged about the adapter (see the `## Comments` sections of the prior efforts' issue files) — fold relevant findings in.

**Deliverable:** a written inventory (this file, `## Answer`) with three columns: die-with-adapter / re-home-before-deletion / already-covered-elsewhere. Tickets 02 and 04–06 consume it.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Answer

Inventory of the adapter test surface (verified 2026-02; line numbers re-checked against the working tree). Scope fact first: exactly four test files import `../react/*` — `adapterOptions.test.tsx` (5 imports), `continueScheduler.test.tsx` (3), `deprecatedAliases.test.ts` (3), `dialogue_view.test.tsx` (4) — plus `clientDomHarness.ts`, which only those three React suites import. **`nextjsHost.test.tsx` imports react/react-dom but has ZERO `../react` imports** — its React use is the test's own `MirroredHost` SSR harness (react is a devDependency), so it survives ticket 02 untouched. Test discovery is automatic (`scripts/run-tests.js` globs `dist/tests/*.test.js`), so deleting files suffices — no list to edit.

### deprecatedAliases.test.ts (8 runtime tests + 2 type-level checks)

- **Re-home before deletion** — the two core pins (the ONLY pins of the `YarnRunner` alias anywhere; grep over `src/tests` confirms no other file touches it):
  - `"YarnRunner is a deprecated alias of Dialogue (same value)"` (line 32) — pins `YarnRunner === Dialogue` (alias defined `src/runtime/dialogue.ts:285-290`). The human ruling keeps this alias.
  - `"the YarnRunner alias runs dialogue exactly like Dialogue"` (line 40) — pins the alias is *usable* as the runtime (construct + `continue()` through it).
  - **Where:** trim the file to these two tests — delete every other test, the React imports, `setupClientDom`/`tickClock` usage, and the type-level alias checks; keep the alias-contract docstring. Alternative if the executor prefers one-file-per-topic: move the two pins into `src/tests/dialogue.test.ts` (the runtime-contract home). Either satisfies the ruling; trimming is the smaller diff.
- **Die with adapter**: `useYarnRunner` alias test (36); `advance`-is-alias-of-`continue` (64); `onStoryEnd` absent-precedence ×2 (117, 146); `DialogueRunner` typing-flow alias tests ×2 (180, 226); the `UseYarnRunnerOptions`/`UseYarnRunnerResult` type-level interchangeability checks (~60–63).

### continueScheduler.test.tsx (5 tests)

- **Die with adapter — all five** (48, 98, 136, 166, 210). Every scheduling semantic exercised is adapter-internal: `scheduleContinue` (`src/react/DialogueView.tsx:104`), the hardcoded 50 ms command flash (`COMMAND_CONTINUE_DELAY_MS`, `DialogueView.tsx:17`), `pauseBeforeContinue`/`autoContinueDelay`/typing-done effects (`DialogueView.tsx:47-68,148-154,180`). The test at 48 claims "headless" but means *no `DialogueRunner`* — it still composes `useDialogue` + `DialogueView`, i.e. pure adapter.
- **Core behavior underneath, already covered elsewhere**: command-surface-then-skip (the semantics the scheduler automates) is pinned core-side in `transcript.test.ts:115` ("a command surfaces, then the next pull skips past it; commands accumulate"), and the whole stopping-point contract in `transcript.test.ts` (incl. the stateless pair, 449–512). The 50 ms flash, click pause, and typing delay are presentation opinions — ticket 03 rules whether they become documented recipes.

### dialogue_view.test.tsx (7 tests)

- **Die with adapter**: `DialogueRunner renders initial variables via props` (14 — core override behavior already pinned at `variableStorage.test.ts:118`); both headless `DialogueView` render tests (55, 68 — presentation, CSS classes, `stubResult` shape); `keeps scene visible during command results` (93 — the scene-header transport is pinned core-side at `transcript.test.ts:334`); `DialogueExample renders its opening line` (122 — the dying demo component); `DialogueRunner renders a node-group program` (132 — default-saliency pick covered by `saliency.test.ts:251,165`).
- **Re-home (small, judgment call)**: `"storylet demo: saliency strategies switch mid-story and steer the draws"` (236) uses **zero adapter API** — pure `Dialogue` core (`setNode`/`continue`/`getSaliencyOptionsForNodeGroup`/`setSaliencyStrategy`/`getVariables`); it sits in a `.tsx` file only by accident. Mostly covered core-side: complexity scores (`saliency.test.ts:123`), query APIs (393), deterministic BLRV walk (220), runtime strategy switching via `<<set_saliency>>` (303), generated-variables-in-storage (286). The one genuinely unpinned bit: `Dialogue.setSaliencyStrategy("nonsense")` returning `false` — only the module-tier `saliencyStrategyForMode("nonsense") → null` is pinned (~line 210), not the `Dialogue` method's boolean rejection. Re-home the test to `saliency.test.ts` (rename; no React to strip) or drop it and add a one-line rejection pin there.

### adapterOptions.test.tsx (12 runtime tests + 3 type-level blocks)

- **Die with adapter — all of it**: every `useDialogue`/`DialogueRunner` test (91, 107, 132, 154, 210, 221, 246, 260, 277, 302, 396, 423) pins hook contract (config-identity=dialogue-identity, live-ref freshness, the `dialogue` escape hatch, prop passthrough) — presentation-layer composition, no core re-home needed. Type-level blocks too: `ViewOptionIsRuntimeOption` (73–79; `DialogueViewOption` is declared `useDialogue.tsx:61`), the `UseDialogueOptions ⊇ DialogueOptions` / runner-derives checks (~339–352), and the `@ts-expect-error` no-program/no-aliases-on-view checks (~354–372).
- **Already covered elsewhere — the core halves of those tests** (verified per option):
  - variableStorage restore / declare-default / in-memory default: `variableStorage.test.ts:60,104,118,124`.
  - lineHints opt-in emission + default-off: `dialogue.test.ts:459` ("lineHints events are opt-in") plus `textProvider.test.ts:175` and `transcript.test.ts:194`.
  - textProvider injection + same-instance language switching + default diagnostic: `textProvider.test.ts:42,103,137,187`.
  - logError/logDebug reaching host callbacks (incl. invalid-selection and inactive-dialogue paths): `dialogue.test.ts:299-349,437`.
- `TranscriptLine`-style derivation needs no new pin: it is enforced structurally at construction (`transcript.ts:30` `Omit`, comment at `transcript.ts:134`).

### index.test.ts

- **Edit, don't port**: `"DialogueRunner is exported from ./react, not the package root"` (29) becomes trivially true once React is gone. The ticket's instinct is right — strengthen it in place: keep the root-absence assert and add (a) no `"./react"` key in `package.json` `exports`, (b) no `react`/`react-dom` in `peerDependencies`/`peerDependenciesMeta`, (c) no `react/jsx-runtime` reference in `dist/` (grep pattern, same technique as the bundle-purity test `nextjsHost.test.tsx:66`). No test currently pins peerDependencies — this is the one strengthened pin ticket 02 should land.
- **Stay untouched**: `compileDocument … not package surface` (20) and `basic dialogue with options` (33) — core.

### cjsExports.test.ts

- **Edit, not port**: drop `"./react"` from `SUBPATHS` (line 12) and `"./react": ["DialogueRunner"]` from `surfaceChecks` (~line 66). Everything else (require-condition resolution, `.d.cts` existence, no-ESM-sibling, ESM parity) is packaging-core and stays.

### clientDomHarness.ts

- **Dies**: imported only by `adapterOptions` (49), `continueScheduler` (10), `deprecatedAliases` (22). jsdom/react-dom devDependencies become unused by `src/tests` once the three suites are gone (nextjsHost still uses react until ticket 05 de-Reacts it).

### nextjsHost.test.tsx — survives unchanged

- No `../react` imports. Pins are all core/host: `loadYarnProject` server-side (53), program JSON-serializability across the RSC boundary (59), `dist/index.js` Node-builtin purity (66), pull-loop SSR over the real host content (108), buy-the-map flow + variable-storage reset (124), walk-on path (155), `noOptionSelected` fall-through (170). The last three overlap `transcript.test.ts`/`variableStorage.test.ts` but on the real `examples/content` project — they are the acceptance pins for ticket 05's vanilla rewrite and must not be lost. Ticket 05 may replace the React SSR harness (108) with a plain-text render; the flow pins (124/155/170) carry over as-is.

### Prior-effort review findings (per the ticket's last suspect)

- **framework-agnostic-consumption and direct-import-implementation issue files contain no `## Comments` sections at audit time** — scanned all 15 files; the map's pointer ("findings appended … under `## Comments`") is not yet satisfied on disk. Ticket 02's executor should re-grep `^## Comments` across `.scratch/{framework-agnostic-consumption,direct-import-implementation}/issues/` before deleting, in case the review lands meanwhile.
- The only landed two-axis review Comments found in `.scratch/` are in **deepening-wave-3** (deleted in the working tree, present in HEAD). The adapter-relevant one, ticket 04 (`04-stateless-pull.md`, `## Comments`): after `applyPull` migrated to `pullUntilStopped` + `mergeEvents`, **"the React suite … no longer covers any stopping-point contract logic — the stateless-pull contract is pinned in `transcript.test.ts` (module tier, no React)"**. Independently verified above: the hook/scheduler suites carry zero core transcript pins.

### Ordered recommendation for ticket 02's executor

1. Trim `deprecatedAliases.test.ts` to its two core `YarnRunner` pins (lines 32, 40), dropping all React imports/tests and the type-level alias checks (or move the two pins to `dialogue.test.ts`). This is the only mandatory re-home.
2. Move `dialogue_view.test.tsx:236` (storylet saliency walk) to `saliency.test.ts` — it has zero adapter imports; while there, add the unpinned `Dialogue.setSaliencyStrategy` unknown-mode `false` rejection (or drop the test if judged redundant, but add the rejection pin either way).
3. Delete `src/react/` and the four React test files (`dialogue_view.test.tsx`, `continueScheduler.test.tsx`, `adapterOptions.test.tsx`) + `clientDomHarness.ts` (after step 1, `deprecatedAliases.test.ts` is no longer React and stays).
4. Edit `index.test.ts:29` to the strengthened root-React-free pin (no `./react` export, no react peers, no jsx-runtime in dist).
5. Edit `cjsExports.test.ts`: remove `"./react"` from `SUBPATHS` and `surfaceChecks`.
6. Remove `"./react"` from `package.json` `exports`, `"dist/react"` from `files`, `react`/`react-dom` from `peerDependencies(Meta)`, and (ticket 06's doc fallout, flag it) the package `description` ("with React adapter") and the `"react"` keyword; `jsdom`/`@types/jsdom` become removable devDeps if nextjsHost's harness goes in ticket 05.
7. Leave `nextjsHost.test.tsx` untouched (no adapter imports; ticket 05 owns its harness).
8. Before executing, re-grep `^## Comments` in the two prior efforts' issue files (see above) and re-verify the line numbers cited here — concurrent work is moving code.

## Comments
