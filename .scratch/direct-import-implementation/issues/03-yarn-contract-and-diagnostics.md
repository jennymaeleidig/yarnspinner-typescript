# 03: Complete the `.yarn` contract — named exports, query handling, diagnostics as build errors

**What to build:** The `.yarn` import contract is finished on both halves. Success half: the emitted module carries named exports alongside the default `Program` — the string table, the implicit-string-tags flag, and file tags — tree-shakeable when unused; `?raw` returns the raw source string; `?url`, `?inline`, and `?no-inline` bail so Vite core owns them. Failure half: an error-severity diagnostic in the compiled source fails the build with a RollupError-shaped error carrying id, line/column location, and source frame (clickable in terminal and overlay); warnings log without failing; a project file's severity overrides are honored (a would-be error downgraded to a warning does not fail the build).

**Blocked by:** 02 (plugin tracer bullet).

**Status:** resolved

## Answer

Implemented on the emitted-module seam. Two core-side discoveries made during the work:

- **Core bug fixed (`src/compile/compileSource.ts`)**: the `docs.length === 0` early-return path (a file that fails to parse entirely) skipped `applySeverityOverrides()` — a project's severity override was silently dropped exactly when a build-error diagnostic was present. The helper is now hoisted above the early return and applied on every exit path. This ticket's "severity override honored" acceptance caught it.
- **Root tsconfig `paths` self-mapping added**: the plugin's declarations now reference core types (`Diagnostic[]` in `CompiledYarnModule`), so the root program pulled its own `dist/*.d.ts` in through the workspace symlink and tsc refused to emit over its inputs (TS5055). `"paths": { "yarn-spinner-runner-ts": ["./src/index.ts"] }` maps the self-name to source within the root project — semantically exact and collision-free.

Also updated: the ticket-02 tracer test's `?raw` expectation — ticket 03 makes `?raw` an owned query (raw-source module), so the bail test now covers `?url` and non-`.yarn` ids.

- [x] Named exports present on the emitted module and correct for a fixture source (stringTable / containsImplicitStringTags / fileTags asserted, file tags keyed by id)
- [x] `?raw` yields the exact source string; `?url`/`?inline`/`?no-inline` bail to Vite core
- [x] A YS-error fixture rejects with id, line/column, and frame in the error (RollupError shape, 1-based line, caret frame)
- [x] Warning-severity diagnostics resolve without failing the build (surfaced via this.warn)
- [x] Severity override flips an error to a warning and the build succeeds (exposed and fixed the no-parse early-return gap in core)
- [x] Full suite green — 646 tests, 645 pass, 0 fail, 1 skip; lint + ts-check clean
