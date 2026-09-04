# 03: Truthful pinned-import types in client.d.ts

**What to build:** `client.d.ts` declares `*.yarn` default as `Program` unconditionally, but a pinned import (`project` option) emits the whole one-job project result (program + string tables + metadata). The editor types must tell the truth without wrecking DX for the common unpinned case. Decide and implement the shape: either a union default (truthful, hosts narrow) or an explicitly named exported type for the pinned result with the `*.yarn` declaration honestly documenting the pinned deviation — whichever keeps the demo/hosts type-checking while a host using `project` gets a real type to narrow to. Update the type-level fixture/tests that pin client.d.ts's shapes, and docs/direct-import.md if the wording shifts. Ticket 06 of direct-import claimed "declared shapes match the implemented runtime contracts exactly" — this ticket makes it true.

**Blocked by:** None (independent of 02, but same file neighborhood — coordinate if run in parallel).

**Status:** resolved

## Answer

Decision: the named-type shape, not the union. `client.d.ts` keeps typing the common unpinned case (`*.yarn` default `Program` + the three named exports) and now declares `YarnProjectLoadResult` — a named interface for the full one-job load result, which is both the `.yarnproject` default's shape and what a pinned `.yarn` import emits. The `*.yarn` declaration documents the pinned deviation in place (pinned → `YarnProjectLoadResult`, named exports absent; TypeScript cannot vary an ambient declaration by plugin option). The union was rejected because it wrecks the common case: every unpinned host would need a dead `"program" in` guard before any `Program` use — including this repo's own browser demo, which would carry a runtime-never-true branch for no benefit.

Implementation detail that preserves the file's paste-in contract: `client.d.ts` stays a declaration *script* (no top-level import/export; inline `import(...)` types), so pasting it verbatim cannot change the host ambient file's module-ness. `YarnProjectLoadResult` is therefore a global interface, in scope once the file is referenced or pasted — the ticket's "explicitly named exported type" landed as a named global type (no `export` keyword), which is the closest shape that keeps the zero-dependency, module-ness-preserving paste-in contract intact.

Updated: the type-level fixture (`src/tests/editorTypes.test.ts`) now pins the named type (`const _typed: YarnProjectLoadResult = project` — shape-exactness of the `.yarnproject` default), still verified by real tsc runs through both the reference and snippet paths. Docs: `docs/direct-import.md` gains the pinned-deviation paragraph under Editor types; its loader-contract paragraph now says the compile steps are importable from the package entry (ticket 02's landing); `packages/vite-plugin/README.md`'s `.yarn` bullet notes the pinned deviation.

- [x] `client.d.ts` no longer claims every `*.yarn` default is a bare `Program`
- [x] A host using `project` gets a real named type for the pinned result
- [x] Demo/hosts type-checking unchanged (nothing needed narrowing)
- [x] Type-fixture tests updated and green (reference + snippet paths)
- [x] docs/direct-import.md wording updated
