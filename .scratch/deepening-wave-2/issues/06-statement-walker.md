# Ticket 06 — One statement walker for the compile seam

Type: task
Status: resolved

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

## Answer

`src/model/walk.ts` — beside the AST (the AST's shape gets exactly one
home). `walkStatements(stmts, walker, { includeOnce })` with three
callbacks, each owning a re-derived subtlety:
- `onLine(line, at)` — Line statements and line-group items;
- `onOption(option, at)` — a shortcut option, just before its body
  recurses (upstream registers/checks the option's text, then walks the
  body);
- `onStatement(stmt, at)` — every non-line statement (Command, Jump,
  Detour, EnumBlock, containers included, before their children) — for
  target/command collection.

`at` is `{ list, index }` — the node's enclosing list and position
(stringTable's flagLastLines needs the previous statement in the list).
`includeOnce: false` skips the whole `<<once>>` block (body *and* else
body) — the upstream `LastLineBeforeOptionsVisitor` shape, no longer a
per-copy convention.

Five traversals folded (each now a visitor of 2–8 lines): stringTable's
line registration + flagLastLines (positional via `at`, once-excluded),
tagLines' collectLines, compileSource's collectTargets + markup
validation walk, compiler's collectInitialValues (its `(s as {content:
string})` cast gone — the walker narrows types). `case "OptionGroup"`
restatements: 9 across 5 files → walker (2) + compiler lowering (2) +
typeCheck walk (1).

**Deliberately not folded** (recorded per the module header):
- The compiler's lowering recursion (:220–450) — labels, branch wiring,
  the option stack: codegen recursion, not traversal.
- The type checker's walkStatements (:944) — branch-condition rewrites
  interleaved with body walks; `checkExpression` mutates checker state
  (implicit pins), so the interleaving is load-bearing. Folding it in
  would need an interface as wide as its implementation — the
  shallow-module trap.

New `src/tests/walk.test.ts`: document-order pin (option text before
body, containers before children, LineGroup items), includeOnce:false,
context shape, no-op walk. Suite 592 (591 pass, 1 mirrored skip), lint
clean, ts-check clean, demo build green.

**Glossary proposal (per the grilling round):** none — the walker is the
mechanism behind CONTEXT.md's existing document-order entries, not a new
domain-facing contract.
