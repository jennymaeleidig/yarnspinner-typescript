# 05: Cheap smell sweep — the review's one-liner judgement calls

**What to fix (each small, each from the 2026-09-04 review):**

1. `src/compile/compileSource.ts:230` — inline the local `applySeverityOverrides` wrapper (Middle Man): import the shared function once under its real name and call it directly at the four call sites.
2. `packages/vite-plugin/src/index.ts:114` — `asBuildError` returns bare `object`; give it a named shape (RollupError-ish interface) and return that.
3. `packages/vite-plugin/src/index.ts` — the local `settle` helper's name hides its warn-then-throw-then-return contract; rename to something honest (e.g. `emitDiagnosticsOrFail`).
4. Plugin creation: a malformed `.ysls.json` surfaces as a raw `SyntaxError` — shape it like the rest of the plugin's error contract (message identifying the definitions file) instead of letting JSON.parse's error escape raw.
5. `packages/vite-plugin/src/index.ts` — `readFile(projectFile, "utf8").catch(() => "")` silently swallows read errors; propagate a shaped error naming the file instead.
6. `examples/browser/StoryletsDemo.ts` — `let draw: Transcript | null` shadows the draw *action*; rename to `lastDraw` (or `drawTranscript`).
7. `examples/browser/StoryletsDemo.ts` — `strategy: string` / `switchStrategy(mode: string)` where `typeof STRATEGIES[number]` exists; use the union so an invalid mode is unrepresentable.

**Sanctioned declinations (do not do):** demo line-rendering triplication (the "just a demo" ruling keeps the demos independently minimal); the glob-matcher consolidation (deferred on the map).

**Blocked by:** 01 (the wrapper in #1 is part of the owned cluster).

**Status:** resolved

## Answer

All seven landed, plus two pin tests:

1. **Wrapper inlined** — `src/compile/compileSource.ts` imports `applySeverityOverrides` under its real name from `./diagnostics.js` and calls it directly at the four sites (`applySeverityOverrides(diagnostics, opts.diagnosticsSeverity)`); the alias (`as applySeverityMap`) and the local Middle Man closure are gone; the delegation comment now sits above the first call site.
2. **Named error shape** — `asBuildError` returns `YarnBuildError` (exported interface: `message`, `id`, optional `loc`/`frame`, RollupError-ish and documented), no longer bare `object`.
3. **`settle` rename** — superseded, not needed: the severity cluster (ticket 01's owned code) already reshaped the helper into `emitModule`, whose name and doc state the warn-then-throw-then-return contract honestly ("Surface the compile outcome: warnings to the sink, the first error as a build failure, otherwise the emitted module code"). No `settle` exists anywhere in the tree; the suggested `emitDiagnosticsOrFail` would be *less* honest since the helper also returns the emitted code.
4. **Shaped `.ysls.json` errors** — `definitions.ts` gained `readYslsFile`: a malformed file throws an error naming the definitions file (`Commands.ysls.json is not valid JSON: …`), not JSON.parse's raw SyntaxError. The read failure is shaped by the same helper (same contract class at the same call site — a raw ENOENT would equally fail to name the file); noted as a half-step beyond the item's literal wording, same smell, one function.
5. **Project-file read errors propagate** — the load hook's `readFile(projectFile).catch(() => "")` now rejects into `fileReadError(projectFile, cause)`, a `YarnBuildError` whose message names the file; an unreadable project fails the build with its path instead of compiling as if empty.
6. **Demo `draw` renamed** — `examples/browser/StoryletsDemo.ts`'s `draw: Transcript | null` is now `drawTranscript` (the draw *action* keeps its name; only a comment references it).
7. **Strategy union-typed** — `strategy` and `switchStrategy`'s parameter are `(typeof STRATEGIES)[number]`; an invalid mode is unrepresentable (`setSaliencyStrategy(mode: string)` accepts the union unchanged).

Pins: `vitePluginOptions.test.ts` asserts a malformed `.ysls.json` fails plugin creation with an error naming the file, and an unreadable pinned project fails the load naming the file.

- [x] 1 wrapper inlined · 2 named shape · 3 superseded by emitModule (recorded) · 4 shaped SyntaxError · 5 read errors propagate · 6 rename · 7 union
- [x] Sanctioned declinations honored: demo triplication and glob-matcher consolidation untouched
