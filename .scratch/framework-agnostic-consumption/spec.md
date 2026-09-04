# Spec: Framework-agnostic consumption — direct `.yarn`/`.yarnproject` import

Labels: ready-for-agent
Wayfinder effort: `.scratch/framework-agnostic-consumption/` (map: `map.md`; decisions in resolved tickets 01–05)

## Problem Statement

A frontend developer who wants dialogue in their app — Vue, Svelte, vanilla, anything non-React — cannot cleanly consume this package. Importing the package root pulls React into their bundle and fails at module resolution if React isn't installed, because React components ride the main entry point. And even once that is fixed, there is no way to get authored dialogue into a browser app the way every other content format works: `import story from "./story.yarn"`. Today the host must fetch `.yarn` text itself, call the compile seam manually, and wire the result into a `Dialogue` — or route through a Node-only loader that only works SSR-side. The result: the library behaves like a Node tool with a React demo attached, not like a frontend library.

## Solution

The package root becomes React-free; React ships behind a `./react` subpath with optional peer dependencies (already executed — recorded as settled fact). A companion Vite plugin, `yarn-spinner-vite-plugin`, makes `.yarn` and `.yarnproject` files first-class importable modules: a `.yarn` import compiles at build time to a module whose default export is the compiled **Program** (with the rest of the compilation result as named exports), a `.yarnproject` import resolves to the full loaded **YarnProject** result ready for a **text provider**, and compile diagnostics surface as clickable build errors. The plugin ships editor types via a referenceable ambient declaration file. All examples are rebuilt on a single shared demo `.yarnproject` — the browser demo becomes the acceptance harness that exercises the published package surface and the plugin end-to-end. A documented generic loader contract (pure compile function + thin webpack loader path) keeps Next.js/Turbopack and other bundlers a follow-on, not a rewrite.

## User Stories

1. As a Svelte developer, I want to import the package root without React in my dependency tree, so that my bundle and install stay React-free.
2. As a React developer, I want to import `useDialogue` and the dialogue components from a dedicated subpath, so that my imports are explicit and tree-shakeable.
3. As a TypeScript user of the React subpath, I want accurate type declarations on that subpath, so that my editor types my usage correctly.
4. As a package maintainer, I want React declared as an optional peer dependency, so that npm installs warn only when a consumer actually uses the React subpath without React.
5. As a Vite user, I want to `import program from "./story.yarn"`, so that my dialogue compiles at build time and my app bundle only ships the runtime.
6. As a Vite user, I want a compile error in a `.yarn` file to fail the build with the file, line, and column clickable in the terminal and overlay, so that I find the broken line without digging through logs.
7. As a Vite user, I want compile warnings logged without failing the build, so that non-blocking issues don't stop development.
8. As a Vite user, I want a project file's severity overrides honored at build time, so that my content team's severity policy applies identically to bundler and SSR compilation.
9. As a Vite user, I want `import src from "./story.yarn?raw"`, so that I can get the raw source string when my app does its own compiling.
10. As a Vite user, I want `?url` and other Vite-native query suffixes to behave as Vite defines them, so that the plugin doesn't surprise me by hijacking core behavior.
11. As a Vite user, I want to `import project from "./project.yarnproject"`, so that I receive the compiled program plus per-locale string tables and localisation metadata in one object I can hand to a text provider.
12. As a Vite user with localised content, I want the plugin to read my strings CSVs at build time, so that no runtime file access is needed in the browser.
13. As a Vite user whose `.yarn` files live inside a project, I want to pin the owning `.yarnproject` via a plugin option, so that compilation uses the project's base language, definitions, and compiler options.
14. As a Vite user, I want compilation to be standalone when no project is pinned, so that dropping a lone `.yarn` file into a project just works.
15. As a Vite user, I want host functions declared to the compiler via plugin options — inline objects or `.ysls.json`-shaped files — so that build-time signature checking sees the same `Library` surface my runtime does.
16. As a Vite user, I want `include`/`exclude` filter options, so that I can handle unusual layouts without waiting on a plugin release.
17. As a Vite user, I want saving a `.yarn` file to trigger a full page reload in dev, so that I always see my latest content without stale module graphs.
18. As a TypeScript Vite user, I want to reference an ambient declaration file from the plugin package, so that `import program from "./story.yarn"` type-checks in my editor with zero extra config.
19. As a TypeScript Vite user, I want a documented paste-in declaration snippet as an alternative, so that I can type the virtual imports without adding a reference to the plugin package.
20. As a package consumer, I want the plugin's compile step exposed as a pure, bundler-agnostic function, so that non-Vite hosts (webpack loaders, custom tooling) reuse the exact same compilation.
21. As a Next.js developer, I want documented guidance on consuming `.yarn` files via the generic loader contract or the existing SSR load path, so that I know exactly which story applies to my setup.
22. As a contributor, I want the plugin to live as a workspace package in this repo, so that plugin and compiler changes land atomically.
23. As a package maintainer, I want the plugin to depend on the core package and peer-depend on Vite, so that version compatibility is automatic for the compiler and chosen by the host for the bundler.
24. As a package maintainer, I want the plugin versioned in lockstep with core, so that a matching pair of versions is always the tested combination.
25. As a CJS consumer, I want the CommonJS artifacts the package's export map already promises to actually exist, so that `require()` resolves instead of crashing at install-time resolution.
26. As a demo reader, I want one shared demo `.yarnproject` that every host example tells, so that I can compare framework integrations without the stories distracting me.
27. As a maintainer, I want the browser demo to import the published package surface and build with the plugin, so that it functions as the acceptance harness for both.
28. As a maintainer, I want the browser demo to stop aliasing the package name to source, so that breakage in the public surface can never hide behind source imports.
29. As a maintainer, I want the Next.js and SvelteKit hosts pointed at the shared demo content, so that no example carries private copies of demo content that can drift.
30. As a maintainer, I want the vestigial re-export stubs and the orphaned scene asset deleted, so that the examples directory only contains runnable, referenced things.
31. As a test author, I want the shared demo project kept separate from the upstream-parity fixture material, so that parity fixtures stay pinned and demo content stays free to change.
32. As a user of the shipped React demo component, I want its inline demo content documented as self-contained, so that I don't mistake it for the demo-content pipeline.

## Implementation Decisions

**Packaging (settled fact — already executed outside this effort):** the root entry re-exports nothing from the React adapter; the adapter ships behind a `./react` subpath export with its own barrel; `react`/`react-dom` are optional peer dependencies. A root-export test asserts React's absence from the root.

**CJS build story (fog ruling, folded in):** the export map's `require` conditions point at CommonJS artifacts that no build step produces. This effort closes the gap: the build gains a CJS output for every promised entry (root, `./react`, `./node`), with per-condition type declarations — because the packaging this effort shapes is only correct if the artifacts it names exist. Flagged as the one scope addition made at assembly.

**Companion plugin package:** npm name `yarn-spinner-vite-plugin` (registry availability verified). Lives as a workspace package inside this repo; the root package continues to publish itself, so the workspaces introduction must preserve root publishing. Vite and the core package are peer dependencies of the plugin — *deviation from the decision as originally locked* (core as a regular dependency): npm cannot link a workspace to the root package by name, and `file:` dependencies are not rewritten at publish, so a regular dependency would either fail install or ship broken; a peer is the publish-correct npm shape and costs nothing — hosts import `Dialogue` from core regardless, so core is always present. Dev-time resolution goes through a `file:` devDependency (npm links it as a symlink). Vite as peer is standard plugin practice. Versions release in lockstep with core at `0.x`. Vite-only — no `unplugin` — with the compile step extracted as a pure, bundler-agnostic function so a future thin webpack loader (the Next.js webpack-mode and Turbopack `turbopack.rules` path) reuses it verbatim.

**`.yarn` import contract:** default export is the compiled **Program**; named exports carry the compilation-result fields the upstream Unity importer also embeds — the string table, the implicit-string-tags flag, and file tags. Compilation runs at build time (the plugin's hook is the analogue of upstream's import-time compilation), with the project file's version plumbed into the compilation job.

**`.yarnproject` import contract:** resolves to the full project-load result — compiled program, per-locale string tables, localisation metadata, diagnostics — shaped for the project text-provider factory. The plugin performs all file access (source globs, strings CSVs) at build time on the Node side; browser hosts never touch the `YarnProjectFileSystem` seam, which remains the SSR hosts' mechanism.

**Query handling:** the plugin compiles real file ids in place (the mdx/svelte/svgr pattern); `virtual:` ids with the `\0` convention are for internal glue only. Requests whose query is `raw`, `url`, `inline`, or `no-inline` bail so Vite core owns them — `?raw` is the sanctioned source-string hatch.

**Diagnostics transport:** error-severity diagnostics fail the build, thrown RollupError-shaped with id, location, and source frame (the vite-plugin-svelte model); warnings log with location and plugin code. The project file's severity map is honored. This is a deliberate divergence from Unity's always-emit-an-asset rule — a bundler has no asset references to preserve — and matches `ysc`'s exit-nonzero semantics.

**Context and options:** compilation context is standalone unless pinned; a `project` option names an explicit `.yarnproject` (no upward discovery — upstream's `list-sources` exists precisely because glob attribution should be inspectable, not guessed). Full option surface: project path, declarations (`.ysls.json`-shaped files or inline objects — the host-declarations seam inherited as seam, not mechanism), compiler options passthrough, and include/exclude filters layered over extension matching.

**HMR:** v1 semantics are full page reload on any `.yarn`/`.yarnproject` change — a rebuilt Program means a rebuilt Dialogue and variable storage resets regardless. Module-graph HMR is future work (out of scope below).

**Editor types:** the plugin package ships an ambient declaration file exposed as a `./client` types subpath, declaring the three import shapes (`.yarn`, `.yarn?raw`, `.yarnproject`) per the contracts above; hosts opt in with a single triple-slash reference. A documented zero-dependency paste snippet is the fallback. Per-file declaration narrowing is out of scope.

**Examples:** one shared demo `.yarnproject` (project file plus `.yarn` sources) under the examples tree; browser, Next.js, and SvelteKit hosts all consume it. The browser demo imports the published package surface (root and `./react`) and consumes the shared content via direct import through the plugin — no source aliasing, no inline template strings, no manual compile calls. The hosts keep their architectures (RSC split, prerender) and re-point their SSR load path at the shared content. The re-export stubs and the orphaned scene asset are deleted. The root project file and its fixture `.yarn` remain, scoped to upstream-parity test material. The shipped React demo component keeps its self-contained inline content, documented as such.

## Testing Decisions

Good tests here assert external behavior only — the emitted module contract, the failure transport, the published surface — never hook internals or the compile function in isolation.

- **Emitted-module contract (the one new seam):** drive the plugin as Vite does — `resolveId`/`load` on a `.yarn`, `.yarn?raw`, and `.yarnproject` id — then evaluate the emitted code: default export is a Program with the expected node stream; named exports carry the string table, implicit-tags flag, and file tags; the `.yarnproject` result feeds the text-provider factory with per-locale tables. The pure compile function is exercised only through this seam (its behavior is otherwise covered by the compiler's own suite).
- **Failure transport (same seam, failure half):** a fixture carrying a YS-code error rejects with the RollupError shape — id, line/column location, frame; warnings resolve without throwing; a severity override flips a would-be error to a warning.
- **Package-surface conformance (existing seams, prior art):** the host-conformance tests (SvelteKit and Next.js harnesses, the client DOM harness, and the root-export-absence test) extend to cover the `./react` subpath barrel; a build of the browser example through the real plugin must succeed and produce a runnable bundle — the end-to-end acceptance harness asserted as a test.
- **CJS artifacts:** a test resolves every `require` condition in the export map and executes the CJS entry, so the exports map can never again name artifacts the build doesn't produce.

## Out of Scope

- Module-graph HMR beyond v1 full reload — it only pays off with a story for carrying variable storage across program swaps (a runtime effort).
- React adapter API changes beyond the executed export split.
- New framework adapters (Vue/Svelte component libraries); SvelteKit stays covered via Vite plus the vanilla runtime.
- Localisation/asset loading beyond what YarnProject loading already provides.
- Reworking the SSR hosts' load path — it works and stays the Next.js story.
- A first-class webpack/esbuild plugin — the pure compile function and the documented loader contract are the deliverable; adapters are follow-on.
- Per-file declaration narrowing for editor types.

## Further Notes

- The upstream research notes (tickets 01–02) are the design's citation base: Unity's `YarnProjectImporter` and `ysc` for compile-at-import semantics, the v4 project schema for project-file handling, and the vite/mdx/svelte/svgr plugin sources for transport conventions. Unity-specific machinery (GUIDs, asset wrappers, `unity:` localisation references, Addressables, protobuf output, C# codegen) must not leak into the plugin.
- The `ysc` CLI's `list-sources` is the upstream citation for keeping source-list resolution inspectable; the context-pinning option exists so attribution is never guessed.
- The plugin targets current Vite (Rolldown-era plugin API); minimum supported version is a release-time decision, not a design constraint.
- Domain vocabulary in this spec follows the repo glossary: Program (compiled instruction-stream artifact), compilation result (program plus string table, declarations, diagnostics, file tags), YarnProject (upstream-format project file and its load result), Dialogue (the runtime), text provider (the line-ID-to-text seam).
