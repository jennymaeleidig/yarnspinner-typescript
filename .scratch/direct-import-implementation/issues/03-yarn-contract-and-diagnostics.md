# 03: Complete the `.yarn` contract — named exports, query handling, diagnostics as build errors

**What to build:** The `.yarn` import contract is finished on both halves. Success half: the emitted module carries named exports alongside the default `Program` — the string table, the implicit-string-tags flag, and file tags — tree-shakeable when unused; `?raw` returns the raw source string; `?url`, `?inline`, and `?no-inline` bail so Vite core owns them. Failure half: an error-severity diagnostic in the compiled source fails the build with a RollupError-shaped error carrying id, line/column location, and source frame (clickable in terminal and overlay); warnings log without failing; a project file's severity overrides are honored (a would-be error downgraded to a warning does not fail the build).

**Blocked by:** 02 (plugin tracer bullet).

**Status:** ready-for-agent

- [ ] Named exports present on the emitted module and correct for a fixture source
- [ ] `?raw` yields the exact source string; the bail set passes through to Vite core behavior
- [ ] A YS-error fixture rejects with id, line/column, and frame in the error
- [ ] Warning-severity diagnostics resolve without failing the build
- [ ] Severity override flips an error to a warning and the build succeeds
- [ ] Full suite green
