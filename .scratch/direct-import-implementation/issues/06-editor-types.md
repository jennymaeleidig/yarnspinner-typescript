# 06: Editor types via the `./client` types subpath

**What to build:** The plugin package ships an ambient declaration file exposed as a `./client` types subpath, declaring the three import shapes (`.yarn`, `.yarn?raw`, `.yarnproject`) to match the implemented contracts. A host enables it with a single triple-slash reference in an ambient types file, and all three imports type-check in an editor; the zero-dependency paste-in snippet is documented as the alternative. Verified by a type-level test (or type-check fixture) that exercises the reference path and the snippet path.

**Blocked by:** 03 (`.yarn` contract shapes), 04 (`.yarnproject` contract shapes).

**Status:** resolved

## Answer

`packages/vite-plugin/client.d.ts` declares the three implemented shapes: `*.yarn` (default `Program` + named `stringTable`/`containsImplicitStringTags`/`fileTags`), `*.yarn?raw` (default string), and `*.yarnproject` (the full load-result shape: program, projectName, baseLanguage, baseTable, translations, assets, diagnostics). The `./client` types-only subpath exposes it; it ships in the files array.

One file serves both enablement paths: it references only `yarn-spinner-runner-ts` types (which the host has installed), never the plugin package — so the triple-slash reference (`/// <reference types="yarn-spinner-vite-plugin/client" />`) and the zero-dependency paste-in are literally the same content. Verified by real `tsc --noEmit` runs over a fixture consumer that exercises typed usage of all three shapes, once through the reference and once through the pasted snippet (the test also pins the snippet-cleanliness — a self-referencing file would fail).

- [x] `./client` types subpath resolves from the plugin package (exports entry + files array, pinned by test)
- [x] All three import shapes type-check via the triple-slash reference path (tsc fixture run)
- [x] The paste-in snippet type-checks standalone, without referencing the plugin package (same file, verified self-contained + tsc fixture run)
- [x] Declared shapes match the implemented runtime contracts exactly (built from the ticket 03/04 emitted shapes; contract tests pin the runtime side)
- [x] Full suite green — 659 tests, 658 pass, 0 fail, 1 skip; lint + ts-check clean
