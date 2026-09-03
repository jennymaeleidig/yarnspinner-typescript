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

**Status:** resolved

- [x] `compileDocument` not reachable from the package root (exports test
      or type-level pin)
- [x] All 15 test files on the collect-don't-throw seam or explicitly
      annotated internal uses; throw-assertions converted to YS-code
      assertions
- [x] Suite green (521+ pre-wave baseline), lint clean

## Answer

Landed. `src/index.ts` no longer `export *`-s `compile/compiler.js` —
`compileDocument`, `LoweringError`, and `CompileDocumentOptions` are
internal (with a comment at the export site saying exactly that). The pin
is a runtime exports test in `index.test.ts`: none of the three names is
on the package namespace. Nothing else imported them: `LoweringError` and
`CompileDocumentOptions` had zero external consumers; `compileSource`
remains `compiler.js`'s only in-package importer.

**All 17 test files migrated** (the ticket said 15; the wave added two) —
51 call sites, all now through `compileSource`. The shape: a tiny shared
test helper `src/tests/compileOk.ts` — compile through the public seam,
assert no error diagnostics and a non-null program, return the program.
Tests that pin diagnostic behaviour keep using `compileSource` directly;
the strict-mode throw assertions (`compile(..., { strict: true })`,
EnumTypeBuilder, `loadProject` strict) are documented public-seam behavior
and stay.

**The migration surfaced what the split was hiding** — the type-check pass
now actually runs for every test, and it demanded what a real host must
provide:
- host-seeded variables need external `declarations.variables` (the
  ticket-01 host pattern) or they are YS0029;
- host functions need compile-time signatures (passed as the compile-time
  `library`, the runtime library doubling as signature source) or their
  `<<declare>>` initializers are YS0029 — and deliberately type-coercing
  tests use `"any"` params with concrete returns;
- `random()`, a runtime built-in, still needs its signature declared to
  type a `<<declare>>` initializer — the checker knows no built-ins;
- one test yarn genuinely re-declared `$flag` across two nodes (YS0039,
  first declaration wins) — the second node now uses its own variable.

These are test-side adaptations only: library behaviour is unchanged (no
new diagnostics, no result-shape changes), exactly as bound. `StoryletsDemo`
also migrated off the internal import, asserting the same host precondition
inline.

Session note: the concurrent session that had deleted this issue file is
overridden by the user — the file was restored byte-identical from HEAD
(`git show HEAD:… >`, the safety net correctly refusing `git restore`) and
worked to resolution here.

Verification: suite 547/547 (546 + the exports pin), lint clean, ts-check
clean, browser demo build, Next.js and SvelteKit hosts green.
