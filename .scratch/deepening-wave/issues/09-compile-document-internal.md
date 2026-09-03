# 09: compileDocument demoted to internal

**What to build:** end the two-error-regimes split at the compile seam.
`compile()` (collect-don't-throw, ticket 49) is the seam;
`compileSource()` is the thin single-file convenience; but
`compileDocument` (AST-level, throws `ParseError`/`LoweringError`) is
still exported from the package root via
`export * from "./compile/compiler.js"` (`src/index.ts`) and is the
default entry of **15 test files** (vs 10 `compileSource` / 6
`compile([...])`).

**Decisions (binding):**
- `compileDocument` becomes an **internal seam** — real for tooling and
  the compiler's own tests, no longer package surface. `src/index.ts`
  stops `export *`-ing `compiler.js` and exports the compiler's public
  names explicitly.
- The 15 test files migrate to the collect-don't-throw seam
  (`compile`/`compileSource`); tests asserting throws convert to
  diagnostics-code assertions (upstream YS-codes), matching how
  `parseFailureValidations.test.ts` already works. Anything that genuinely
  needs the AST-level entry (e.g. line-ID write-back assertions) imports
  it as internal and says why in a comment.
- Ticket 01 already moved the demo off this path — this ticket is only the
  unexport + test migration, deliberately last in the wave.
- Behaviour is unchanged: no new diagnostics, no result-shape changes.

**Blocked by:** 01 (the demo must be off the throwing path first)

Type: task

**Status:** open

- [ ] `compileDocument` not reachable from the package root (exports test
      or type-level pin)
- [ ] All 15 test files on the collect-don't-throw seam or explicitly
      annotated internal uses; throw-assertions converted to YS-code
      assertions
- [ ] Suite green (521+ pre-wave baseline), lint clean
