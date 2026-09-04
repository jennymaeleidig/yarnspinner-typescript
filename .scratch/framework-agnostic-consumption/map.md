# Wayfinder map: framework-agnostic consumption spec

Labels: wayfinder:map

## Destination

A complete, reviewable **spec** for framework-agnostic consumption of yarn-spinner-runner-ts: every decision needed to (a) keep the package importable in any frontend project without React, and (b) support direct import of `.yarn` / `.yarnproject` files via a Vite plugin (first-class) plus a documented generic virtual-module contract, all demonstrated by updated examples. The spec lands at `.scratch/framework-agnostic-consumption/spec.md`; its supporting artifacts are the resolved decision tickets and research notes linked below.

## Notes

- Domain: this repo is a TypeScript Yarn Spinner 3.x parser/compiler/runtime, framework-agnostic core + optional React adapter. Vocabulary from `CONTEXT.md` is binding (**Program**, **YarnProject**, **Dialogue**, **compilation mode**). Coding standards: `CODING_STANDARDS.md`.
- Decisions already locked by the human (do not re-litigate): default import of a `.yarn` yields a build-time-compiled **Program**, `?raw` yields the source string, `.yarnproject` yields the full loaded project (program + string table + text-provider inputs); Vite first-class + documented generic loader contract; all examples updated/consolidated; upstream Yarn Spinner's own import story is a reference input.
- Already executed *outside* this map (human-sanctioned quick fix, feeds the spec's packaging section as settled fact): React re-exports removed from the root entry, `./react` subpath export added, `react`/`react-dom` declared optional peerDependencies. The packaging audit finding it addressed is resolved.
- An architecture-review agent may be working concurrently in `src/runtime/*`; re-verify line numbers before editing.
- Skills every session should consult: `grilling`, `domain-modeling` (glossary updates as terms crystallise), `research`.
- One ticket resolved per session; research tickets exempt.

## Decisions so far

- [React packaging fix executed outside the map](../../CONTEXT.md): root entry is now React-free (`src/index.ts`); React ships behind `./react`; optional peer deps declared. Settled input to the spec, recorded here because it closed an audit red flag without a ticket.
- [Ticket 01 — Upstream reference: how Yarn Spinner itself handles .yarn/.yarnproject import](issues/01-upstream-import-story.md): upstream compiles at import (Unity `ScriptedImporter`) or AOT (`ysc`); the v4 `.yarnproject` schema is engine-agnostic and its semantics (globs, baseLanguage, localisation map, compilerOptions) are what the Vite plugin inherits — Unity's GUID/asset/Localization/codegen mechanics must not leak. Research: [research/01-upstream-import-story.md](research/01-upstream-import-story.md).
- [Bundler virtual-module conventions and precedents](issues/02-bundler-conventions.md): compile real file ids in-place (like mdx/svelte/svgr), reserve `virtual:` + `\0` ids for glue; throw RollupError-shaped diagnostics with loc; ship a referenceable `client` d.ts; Vite-only plugin + pure compile function, with a thin webpack loader as the Next/Turbopack path.
- [Virtual-module contract design](issues/03-virtual-module-contract.md): `.yarn` default export = Program + named stringTable/containsImplicitStringTags/fileTags; `.yarnproject` = full loadProject result object; `project?` option pins context (no upward discovery); errors fail the build RollupError-style, severity map honored; v1 HMR = full reload; options `{project, definitions, compilerOptions, include, exclude}`.
- [Companion package identity](issues/04-companion-package.md): `yarn-spinner-vite-plugin` (verified available), workspace package in this repo, Vite-only + pure compile function, core as dependency / vite as peer, lockstep 0.x versioning, `./client` types subpath for ambient d.ts.
- [Example consolidation design](issues/05-example-consolidation.md): one shared demo `.yarnproject` at `examples/content/` for all three hosts; browser demo rebuilt as acceptance harness through `dist/` + the plugin; hosts re-point SSR path; delete `examples/react/` stubs and orphan `scenes.yaml`; root `.yarnproject` stays the test fixture.
- [Assemble the spec](issues/06-assemble-spec.md): spec published at [spec.md](spec.md), labelled ready-for-agent; seams confirmed (one new: emitted-module contract via resolveId/load); last fog ruled — CJS build story folded into the spec's scope. Map complete.

## Not yet specified

(None — fog exhausted. The CJS build story was ruled into scope at spec assembly, ticket 06.)

## Out of scope

- React adapter API changes beyond the executed export split (the adapter's surface is settled by the 0.2.0 parity work).
- New framework adapters (Vue/Svelte component libraries); SvelteKit stays covered via Vite + vanilla runtime.
- Localisation/asset loading beyond what `YarnProject` loading already provides.
- Reworking the SSR hosts' `loadYarnProject` path (it works and stays the Next.js story).
- Module-graph HMR beyond v1's full-reload (decided in ticket 03: a rebuilt Program means a rebuilt Dialogue; custom HMR only pays off with a variable-storage-carrying story, which is a runtime effort, not this spec).
