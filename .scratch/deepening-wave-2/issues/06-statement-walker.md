# Ticket 06 — One statement walker for the compile seam

Type: task
Status: open

## Question

Every compile pass re-implements the AST's shape by hand — the statement-tree
walk contract is restated ~8 times across the compile seam. Each walk is a
shallow module whose interface (a recursive helper per file) is nearly as
complex as its implementation, and the traversal's subtleties are undocumented
per-copy decisions a new walker can get wrong.

## Evidence

- `src/compile/compiler.ts` (764) — walkers at :229, :242, :414–420, :752, :759
- `src/compile/typeCheck.ts` (1378) — `walkStatements` (:1077–1123)
- `src/compile/stringTable.ts` (407) — `walkStatements` (:211–234) +
  `flagLastLines` (:237–258), which *deliberately* skips `<<once>>` blocks
  ("upstream's visitor has no once case", stringTable.ts:241)
- `src/compile/tagLines.ts` (550) — `collectLines` (:257–280)
- `src/compile/compileSource.ts` (542) — `collectTargets` (:403–421) +
  `validateMarkup.walk` (:490–517); `collectTargets` handles only
  If/Once/OptionGroup; `collectInitialValues` in compiler.ts doesn't handle
  `LineGroup`
- `grep "case \"OptionGroup\"" src` (non-test): 9 hits in 5 files
- Deletion test passes: delete a shared walker and the traversal contract
  (including the once-exclusion variant and the line-bearing-items enumeration)
  reappears in 8 callers.

## Work item

One deep statement-walker module (home: `src/model/` beside the AST, or
`src/compile/` — decide at implementation by which side owns the contract):
`walkStatements(stmts, visitor, { includeOnce })` where the visitor gets
`onLine(line, context)` / `onStatement(s, context)` and the walker owns:

- document order (option-line-before-body)
- the once-exclusion rule (behind the option)
- line-bearing vs all-statement filtering

Each of the ~8 sites becomes a visitor of 3–10 lines; the AST's shape gets
exactly one home. Adding one statement kind becomes one edit, not eight
switch statements.

## Tests

- One focused traversal pin on the walker (order, once exclusion, line-bearing
  filtering) — the golden corpus keeps guarding the end-to-end contract.
- All compile-side suites (multiFileCompile, lineIds, tagLines, diagnostics,
  bytecode goldens) pass unchanged.

## Constraints

- Pure internal factoring; no ADR tension (ADR 0001–0004 untouched).
- No public-surface change.
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.
