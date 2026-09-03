# Yarn project files & framework-agnostic hosting

Label: ready-for-agent

## Problem Statement

A contributor or library consumer working the way upstream's own docs teach
— a `.yarnproject` at the root, `.yarn` files organized under it — cannot use
this project without hand-rolled glue. In this repo the Yarn Spinner VS Code
extension used to see one implicit project over vendored conformance fixtures
(duplicate-node noise, no project semantics). In consumer code, `compile()`
takes `{name, source}` files but nothing reads a `.yarnproject`, so every
TypeScript host re-implements project discovery, and the only worked hosting
example is React — nothing demonstrates the runtime in the frameworks people
actually ship with.

## Solution

Three layers. First, this repo becomes a proper Yarn Spinner workspace: a
root `.yarnproject` (upstream format v4) scopes editor checking to authored
content, with the vendored fixtures deliberately outside it. Second, the
library grows a YarnProject loader: point it at a `.yarnproject` — upstream's
format, not a fork — and it validates, resolves the source file globs, and
feeds `compile()`, so any repo set up per upstream's docs compiles here in
one call, with the project's localisation map wiring into the CSV text
provider. Third, reference hosts in Next.js and SvelteKit prove the end goal:
TypeScript projects of any framework consume upstream-style Yarn projects
through this runtime — content flows in from upstream-style repos, and (per
the TypeScript-only scope decision) nothing needs to flow back out to
C#/C++ engines.

## User Stories

1. As a contributor, I want a root `.yarnproject`, so the VS Code extension
   sees a real project instead of one implicit project over vendored fixtures.
2. As a maintainer, I want the vendored conformance fixtures outside the
   workspace project, so byte-exact upstream fixtures are never flagged or
   auto-fixed by editor tooling.
3. As a library consumer, I want to load a `.yarnproject` and get a compiled
   result in one call, so project setup isn't hand-rolled per host.
4. As a library consumer, I want the loader to accept upstream v4 project
   files (and legacy v2), so repos following upstream's docs work unchanged.
5. As a library consumer, I want malformed or unsupported project files to
   produce diagnostics — wrong format version, unknown fields, missing
   strings CSVs — so failures are legible, never silent.
6. As a library consumer, I want `sourceFiles`/`excludeFiles` glob resolution
   relative to the project file's location, so projects behave as upstream's
   tools resolve them.
7. As a library consumer in a bundler or browser, I want file access injected
   with Node `fs` only as the default provider, so the loader works under
   Vite/Next/SvelteKit without Node APIs in the client path.
8. As a library consumer, I want the project's `compilerOptions` mapped onto
   compiler options where equivalents exist and surfaced as diagnostics where
   they don't, so project intent is never silently dropped.
9. As a localizer, I want the project's `localisation` map to feed the CSV
   text provider, so translated upstream projects run end-to-end per locale.
10. As a library consumer debugging file discovery, I want a `listSources()`
    helper, so I can see what a project resolves without compiling.
11. As a Next.js developer, I want a worked app-router example loading the
    project server-side and running `Dialogue` client-side, so framework
    support is demonstrated, not claimed.
12. As a SvelteKit developer, I want the same story with no React anywhere,
    so the runtime's framework-agnostic claim is proven in a second world.
13. As a framework developer, I want both hosts to build clean in CI, so
    framework support can't silently rot between releases.
14. As a consumer with dialogue state, I want the hosts to demonstrate
    variable-storage reset, so the runtime surface beyond `continue()` is
    shown per framework.
15. As a maintainer, I want this effort independent of the 0.2.0 release
    wave, so it lands or slips without holding the rename hostage.

## Implementation Decisions

- **Upstream's format, not a fork**: the loader parses the upstream v4
  schema field-for-field (`projectFileVersion`, `projectName`, `authorName`,
  `sourceFiles`, `excludeFiles`, `baseLanguage`, `localisation`,
  `definitions`, `compilerOptions`, `editorOptions`; `additionalProperties`
  false). Format version 2 is accepted like upstream; the dead dev version 3
  is rejected with a diagnostic.
- **One new seam**: the loader's file access is an injected interface
  (list/read by path). Node `fs` ships only as the default provider; the core
  never imports `fs`. Every other step rides existing seams — glob-resolved
  files feed `compile()`'s existing file-collection parameter (ticket 49),
  localisation CSVs ride the string-table/text-provider surface (tickets
  50/51).
- **No silent option drops**: `compilerOptions` maps onto this compiler's
  options where an equivalent exists; `requireVariableDeclarations` has none
  yet and surfaces as a diagnostic or an explicit ticket note, never an
  ignored field. Unknown schema fields produce diagnostics.
- **`.ysls.json` definitions deferred**: host commands/functions register
  through the `Library`; the definitions file is editor tooling, not needed
  for compilation.
- **Compiled artifact ownership** (TypeScript-only scope decision, recorded
  in the map): Programs stay this project's versioned JSON (ADR 0001).
  Upstream-engine export is permanently out of scope — sources and
  localisation flow in; nothing flows out to C#/C++ engines.
- **Workspace project policy**: `sourceFiles` scoped to this repo's authored
  content; vendored fixtures excluded by design (byte-exact upstream corpus,
  ticket 20/21 harness); build-output excludes follow upstream's duplicate-node
  troubleshooting guidance.
- **Hosts are examples, not package surface**: the Next.js and SvelteKit apps
  live beside the browser demo; no adapter abstraction is built until a
  second real consumer forces the shape. The React adapter remains the only
  in-package adapter.
- **Terminology note for `/domain-modeling`**: "YarnProject" is upstream's
  concept name and this effort's term of art; it is not yet in the CONTEXT.md
  glossary and should be added when the loader lands.

## Testing Decisions

- Good tests assert external behavior only: what `loadProject()` returns and
  what diagnostics it emits — never glob-implementation internals.
- **Loader**: driven through the public API with an injected in-memory file
  provider (no `fs` in tests — the injection seam exists for exactly this):
  v4/v2 accepted, v3 rejected, unknown fields diagnosed, globs resolved
  relative to the project location, missing strings CSVs diagnosed, and the
  end-to-end path `loadProject()` → `compile()` → program/string table
  asserted on the vendored upstream Space project fixture (its unvendored
  `German.csv` reference doubles as the missing-CSV diagnostic case).
- **Prior art**: the upstream conformance harness (tickets 20/21) already
  drives `compile()` from fixture files; ticket 51's CSV text-provider tests
  are the prior art for localisation wiring.
- **Hosts**: verified by build targets in CI (alongside `demo:build`) plus
  SSR-style render tests mirroring the browser demo's harness from ticket 52
  — the Next.js host can run the same "demo green" pattern, the SvelteKit
  host asserts server-rendered dialogue output through `Dialogue`.
- **What makes a good test here**: the only new seam is the file-access
  injection point on the loader; every other test goes through `compile()`
  and `Dialogue` — the two public seams that already exist.

## Out of Scope

- Upstream-engine interoperability in any direction (protobuf program export,
  Unity/Godot/Unreal paths) — permanently, per the TypeScript-only decision.
- Authoring tools: the VS Code extension owns editing; this effort only makes
  the workspace legible to it.
- `.ysls.json` definitions-file parsing.
- New adapter abstractions or package surface for frameworks; hosts are
  examples.
- Language or compiler changes: this effort consumes the 3.2-parity surface,
  it does not extend it.

## Further Notes

- Landed order agreed with the maintainer: 01 (workspace project, resolved
  and user-verified in the field), then 02 (loader core), 03 (localisation
  wiring), then the hosts (04 Next.js, 05 SvelteKit) — all before ticket 53's
  0.2.0 release wave, which stays independent of this effort. Tickets were
  split along these lines in a to-tickets review: loader core and localisation
  wiring are separate slices, and each host is its own ticket so every slice
  is demoable and window-sized.
- Content-parity confidence comes from the existing conformance corpus
  (tickets 20/21): upstream-authored `.yarn` content compiling identically is
  the guarantee underneath the "their setup → our compiler" promise.
- The upstream project-file schema lives at schemas.yarnspinner.dev; the
  loader's validation should cite it as the authority, as the compiler cites
  upstream for YS-codes.
