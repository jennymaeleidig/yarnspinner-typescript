# 04: `.yarnproject` import contract

**What to build:** `import project from "./project.yarnproject"` resolves to the full project-load result — compiled program, per-locale string tables, localisation metadata, diagnostics — shaped so a host hands it to the project text-provider factory and runs localised dialogue with no runtime file access. The plugin reads the project file, resolves source globs, and reads strings CSVs at build time on the Node side; the `YarnProjectFileSystem` seam stays out of the browser story. Verified on the emitted-module seam: the evaluated import feeds the text-provider factory and a `Dialogue` delivers localised text.

**Blocked by:** 02 (plugin tracer bullet).

**Status:** resolved

## Answer

Implemented via a new `compileYarnProjectModule` (Node-side, Vite-type-free — `loadYarnProject` resolves source globs through `nodeProjectFs` and `loadLocalisations` reads the declared strings CSVs at build time; the emitted module is pure data: program, projectName, baseLanguage, baseTable, translations, assets, localisation diagnostics). The default export feeds `createProjectTextProvider` directly and a `Dialogue` delivers base and localised text. `?raw` on a `.yarnproject` yields the raw JSON; other queries bail. Unknown keys tolerated (fixture carries `editorMetadata`; the loader's own YP validation governs).

Notes:
- The `.yarn` tracer test's `callHook` predated the thisArg form — `load` became a `this`-using method when the plugin context (`this.warn`) arrived in ticket 03; the seam now mirrors Vite's always-supplied-context contract explicitly.
- Delivery is once-per-line: the localisation assertion uses one fresh `Dialogue` per language (the core loader test's pattern), not redelivery after `setLanguage`.
- YS0003 (use-before-declaration of `$gold`) surfaces as a warning through the project path too — same settle contract as `.yarn`.

Review follow-ups applied: the severity partition is now one shared `partitionDiagnostics` (the seam `CompiledYarnModule` existed to provide); the stale ticket-reference header comments dropped; the plugin-context contract is enforced, not guessed — hooks call `this.warn` directly and every seam call supplies Vite's always-present context.

Deferred polish (recorded for ticket 05's diagnostics plumbing): a project-path build error's frame quotes the `.yarnproject` JSON while `loc` points into the offending `.yarn` source — the id is correct and no criterion covers it; when the options surface touches this code, read the diagnostic's `file` for the frame source.

- [x] A project import emits the full load result: program plus per-locale string tables plus localisation metadata
- [x] The evaluated import feeds the text-provider factory; a `Dialogue` delivers base-language and localised text
- [x] Source globs and strings CSVs are resolved at build time; no runtime file access remains in the emitted module (asserted: no require/readFile, translations baked in)
- [x] Unknown keys in the project file are tolerated per the core loader's semantics (editorMetadata fixture)
- [x] Full suite green — 651 tests, 650 pass, 0 fail, 1 skip; lint + ts-check clean
