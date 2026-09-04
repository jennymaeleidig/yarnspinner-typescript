# Ticket 03 — Virtual-module contract design

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

Pin the exact contract the plugin provides, as spec text. Open sub-decisions (grill the human; research tickets 01/02 inform, but each is a decision): the shape of the default export of a `.yarn` import (plain `Program` vs a richer compiled bundle carrying string table/diagnostics); the full query-param set (`?raw`, `?url`, anything else); what a `.yarnproject` import resolves to exactly (the `loadProject` result? a composite with per-file programs? how localisation CSVs reach the build); how compile diagnostics surface at build time (fail the build vs warn, strict-mode passthrough); and how the virtual modules coexist with the runtime's injected `YarnProjectFileSystem` seam (does the plugin implement that seam at build time?).

## Answer

All six sub-decisions resolved (human accepted recommendations, 1 round):

1. **Default export of a `.yarn` import**: `Program` as the default export; the emitted module also carries named exports for the rest of the compilation result the upstream Unity importer embeds — `stringTable`, `containsImplicitStringTags`, `fileTags` (tree-shaken if unused).
2. **`.yarnproject` import**: resolves to the full `loadProject` result shape (program + per-locale string tables + localisation metadata + diagnostics) as a single object dropping into `createProjectTextProvider`. The plugin reads source globs and strings CSVs at build time (Node side), so hosts never touch the `YarnProjectFileSystem` seam — that seam stays for SSR hosts.
3. **Bare `.yarn` context**: standalone compilation by default; `project?: string` plugin option pins an explicit `.yarnproject` for context (declarations, base language, compiler options). No magic upward discovery — explicit beats implicit (upstream `list-sources` precedent: glob attribution is inspectable, not guessed).
4. **Diagnostics**: errors fail the build — thrown RollupError-shaped with `id`/`loc`/`frame` (clickable; overlay in dev); warnings via `this.warn` with `loc` + `pluginCode`; `compilerOptions.diagnosticsSeverity` from the project file honored. Deliberate divergence from Unity's always-emit-an-asset rule (reference stability has no bundler analogue); matches `ysc` exit-1 semantics and the svelte/mdx precedent.
5. **HMR (fog item resolved)**: v1 = full page reload on any `.yarn`/`.yarnproject` change — a rebuilt Program means a rebuilt Dialogue and variable storage resets regardless. Module-graph HMR is future work, out of this spec's scope; it only buys value once there is a story for carrying variable storage across program swaps.
6. **Plugin options**: `{ project?, definitions?, compilerOptions?, include?, exclude? }` — `definitions` accepts `.ysls.json`-shaped files or inline objects (the declarations seam inherited as seam-not-mechanism); `include`/`exclude` are mdx-style `createFilter` arrays on top of extension-based matching.

Fog graduated: HMR resolved (5); Next/Turbopack docs boundary already settled by ticket 02; d.ts shapes now pinned by 1+2 (where the client d.ts ships remains ticket 04).
