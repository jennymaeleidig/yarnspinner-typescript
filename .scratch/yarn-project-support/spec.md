# Yarn project files & framework-agnostic hosting

Label: ready-for-agent

## Problem Statement

The repo's `.yarn` content (`examples/yarn/`, vendored upstream conformance
fixtures under `test/fixtures/`) has no `.yarnproject`, so the Yarn Spinner
VS Code extension ([extension](https://marketplace.visualstudio.com/items?itemName=SecretLab.yarn-spinner),
[project files](https://docs.yarnspinner.dev/write-yarn-scripts/yarn-spinner-editor/yarn-spinner-project-files))
falls back to treating the whole workspace as one implicit project: vendored
fixtures with colliding node titles report duplicate-node errors, editor
features have no project semantics, and there is no workspace-recommended
extension. On the library side there is no project-file concept at all —
`compile()` (ticket 49) takes `{name, source}` files, but every host
hand-rolls file gathering. And the only worked example of hosting is React
(ticket 52); the runtime is framework-agnostic by construction, but nothing
proves it outside React.

## Solution

Three layers, one effort:

1. **Workspace editor project** (landed): a root `.yarnproject` (format
   version 4, schema: <https://schemas.yarnspinner.dev/yarnproject.schema.json>)
   scoped to this repo's own authored content with vendored fixtures excluded,
   plus a workspace extension recommendation, so the VS Code extension and its
   language-server features work in this repo today.
2. **YarnProject loader**: a library module that reads a `.yarnproject`,
   validates it (v4; `projectFileVersion` 2 accepted like upstream, 3 is the
   dead dev version), resolves `sourceFiles`/`excludeFiles` globs behind an
   injectable file-access seam, and feeds the resolved `{name, source}` files
   to `compile()` — mapping `compilerOptions` where this compiler has an
   equivalent and surfacing the rest as diagnostics. Framework-agnostic by
   design: no `fs` import in the core, Node is just the default provider.
3. **Framework hosts**: worked Next.js and SvelteKit examples running the
   loader + `Dialogue`, proving the end goal — support beyond React — with
   real apps rather than a claim.

Out of scope: authoring tools (the extension does that), `.ysls.json`
definitions files (only worth adding when example scripts grow custom
commands/functions), and the Unity/Godot engine paths.

## User Stories

1. As a contributor, I want a root `.yarnproject`, so the VS Code extension
   sees a real project instead of one implicit project over vendored fixtures.
2. As a maintainer, I want the vendored conformance fixtures excluded from the
   editor project, so byte-exact upstream fixtures are never flagged, checked,
   or auto-fixed by editor tooling.
3. As a library consumer, I want to load a `.yarnproject` and get compiled
   output in one call, so project setup isn't hand-rolled per host.
4. As a library consumer in a bundler or browser, I want file access injected
   (Node `fs` only as the default), so the loader works in Vite/Next/Svelte
   builds without dragging Node APIs into the core.
5. As a localizer, I want the project's `localisation` map to feed the CSV
   text provider (ticket 51 surface), so translated projects run end-to-end.
6. As a framework developer (Next.js, SvelteKit), I want reference hosts
   exercising loader + `Dialogue` server- and client-side, so framework
   support is demonstrated, not claimed.

## Tickets

| Ticket | Status | Blocked by |
|---|---|---|
| [01 workspace editor project](issues/01-workspace-editor-project.md) | resolved | — |
| [02 YarnProject loader](issues/02-yarnproject-loader.md) | ready-for-agent | — |
| [03 framework hosts: Next.js + SvelteKit](issues/03-framework-hosts.md) | ready-for-agent | 02 |
