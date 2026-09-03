# 02: YarnProject loader core

**What to build:** point the loader at an upstream-style `.yarnproject` and
get a compiled result in one call — parse and validate the project file
(v4 schema: <https://schemas.yarnspinner.dev/yarnproject.schema.json>; accept
`projectFileVersion` 2 like upstream, reject 3 as the dead dev version),
resolve `sourceFiles`/`excludeFiles` globs relative to the project file's
location behind an injectable file-access seam (Node `fs` ships only as the
default provider; the core never imports `fs`), and feed the resolved
`{name, source}` files to `compile()` (ticket 49 seam). Map `compilerOptions`
onto this compiler's options where an equivalent exists
(`requireVariableDeclarations` has none yet — surface the gap as a diagnostic
or ticket note, don't silently ignore); unknown fields produce diagnostics per
the schema's `additionalProperties: false`. Referenced localisation strings
files that don't exist are diagnosed as part of project validation. Include a
`listSources()` debug helper (upstream `ysc list-sources` equivalent) used by
the tests. `definitions` (.ysls.json) is explicitly deferred.

**Blocked by:** None (can start immediately)

Type: task

**Status:** resolved

- [x] Parse + validate v4 (and legacy v2) project files with diagnostics; v3 rejected
- [x] Glob resolution relative to the project location behind an injectable
      file-access seam; Node default provider
- [x] Resolved files feed `compile()`; `compilerOptions` mapped or diagnosed;
      unknown fields diagnosed
- [x] Referenced-but-missing strings files diagnosed during validation
- [x] `listSources()` helper + suite green
- [x] Acceptance: loads the vendored upstream Space project fixture — its
      `sourceFiles` resolve to the two `.yarn` scripts and the project
      compiles; its unvendored `German.csv` reference exercises the
      missing-strings diagnostic

## Landing notes (ticket 02)

- **Core**: `src/compile/yarnProject.ts` — pure (no I/O, §2): `parseYarnProject`
  (v4/v2 accepted, v3 rejected via YP0002 "dead dev version"; required fields
  per the schema's `required` list — schema defaults apply when a schema tool
  fills a file, not at validation), a POSIX glob matcher (`**` spans zero+
  segments, `*`/`?` segment-bound, patterns anchor at the project root; no
  braces/char classes — upstream's documented patterns don't use them),
  `loadProject()` (validate → resolve → `compile()`, options pass through
  since `LoadProjectOptions extends CompileOptions`), `listSources()` (the
  `ysc list-sources` equivalent; returns `{ sources, diagnostics }`).
- **YP-codes**: local registry `YP0001–YP0008` in the module — upstream has no
  project-file diagnostic registry, so these are this project's own surface
  (§1 divergence recorded in module header, spec, and the CONTEXT.md
  YarnProject glossary entry, added per the spec's terminology note).
- **Node boundary**: `src/compile/nodeProjectFs.ts` — `nodeProjectFs(dir)`
  (walks, skips `node_modules`/`.git`, POSIX-normalizes) + `loadYarnProject(path)`
  one-call load; exported under a new `./node` package subpath so the main
  entry stays browser-safe. Unreadable project file → collected YP0001, not a
  throw (§3).
- **Severity calls (recorded)**: YP0006 missing strings file is a **warning** —
  it blocks localised playback of that locale, not the base-language compile
  (the Space acceptance depends on this; hard localisation failure is ticket
  03's read-time problem). Unknown **top-level** fields warn (schema closes the
  object — typos surface); unknown **compilerOptions** keys are silent (schema
  leaves it open, `additionalProperties: true`), but the two known upstream
  options with no local equivalent (`requireVariableDeclarations`,
  `allowPreviewFeatures`) warn via YP0005 — never silently dropped. Locale
  sub-objects and `projectName`/`authorName` are type-closed per schema
  (post-review additions).
- **Two-axis code review**: Standards 7 met / 0 missing; Spec 7 met / 2
  partial / 0 missing. Resolutions: single `failedResult()` literal shared by
  all error paths (drift risk), `@internal`; `skipDirs` option removed
  (speculative generality); glob matcher internals renamed
  (`matchPathSegments`/`matchPathSegment`) for legibility; `loadYarnProject`
  collects its own unreadable-file diagnostic; schema-closure gaps fixed with
  a new test. Review-noted scope creep accepted as ticket-serving:
  `parseYarnProject` public export (tooling seam), `loadYarnProject`,
  YP0007/YP0008.
- **Tests**: 18 in `src/tests/yarnProject.test.ts` at the pre-agreed seams
  (`loadProject`/`listSources` over an in-memory provider; Node provider
  against a tmpdir and the vendored Space fixture). Suite 430/430, lint
  clean, build clean.

### Final spec-vs-impl review (yarn-project-support close-out)

Reviewer flagged story 8 partial: unknown `compilerOptions` keys were silently
ignored (rationale: schema-open, `additionalProperties: true`). Resolved — the
loader now warns **YP0005** for every `compilerOptions` key it has no
equivalent for, with distinct messages: the two known upstream options
(`requireVariableDeclarations`, `allowPreviewFeatures`) get "has no equivalent
in this compiler and was ignored"; unknown keys get "is not recognised by this
compiler and was ignored". Schema-openness is respected (a warning, not an
error — a newer upstream option still loads), but project intent is never
silently dropped, per the spec's no-silent-option-drops decision. Test updated
(`every compilerOptions key is either mapped or diagnosed — never silently
dropped`, keyed to each offending option's `context`). Suite 458/458, lint
clean. Earlier severity note corrected: unknown compilerOptions keys are no
longer silent.
