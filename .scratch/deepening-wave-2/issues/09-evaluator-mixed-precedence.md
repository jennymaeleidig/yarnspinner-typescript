# Ticket 09 — Fallback evaluator: mixed comparison+logical precedence

Type: task
Status: open
Blocked by: 08

## Question

The fallback evaluator's dispatch order puts comparison splitting BEFORE
logical splitting, so a mixed expression parses against the wrong grammar
layering. `$a == 1 && $b > 2` evaluates as `$a == ((1 && $b) > 2)` —
verified live against dist: the evaluator returns `true` where the type
checker, the codegen, and upstream's single expression grammar parse
`($a == 1) && ($b > 2)` (which is `false` here). Inline `{expr}` text
composes through this evaluator at delivery, so the divergence is
observable, not hypothetical.

This is the same class as ticket 03's xor escape (the fallback grammar's
weakest link), found by ticket 08's grammar-diff gate.

## Evidence

- `src/runtime/evaluator.ts` `evaluateExpression` (:43–75): dispatch order
  is function call → `containsComparison` → logical → negation →
  arithmetic → value. `containsComparison` is `/[<>=!]/` — any `=` anywhere.
- `evaluateComparison` (:281): regex `^(.+?)\s*(===|==|!==|!=|=|<=|>=|<|>)\s*(.+)$`
  splits at the FIRST comparison operator, so the right side swallows the
  `&&`/`||`/`^` chain.
- `evaluateLogical` (:311) already implements the correct flat left-assoc
  level — but it only ever sees expressions the comparison regex didn't
  claim first. Its splitter is also not quote-aware (`&&` inside a string
  literal splits).
- Checker/codegen layering (the target): or/and/xor level LOOSEST
  (`parseOr` → comparison/equality → relational → additive → …), so
  logical operators split first, comparisons inside each part.

## Work item

Reorder the fallback evaluation to the upstream layering: split the
logical level (`&&`/`||`/`^`, paren- AND quote-aware) FIRST, then apply
the existing comparison/arithmetic evaluation to each part. The word
aliases preprocess to symbols before splitting (unchanged). Do not touch
the compile grammars; do not move toward the shared parser (ADR 0005 —
this is a standalone parity fix, never bundled with refactor work).

While there: the negation check (`trimmed.startsWith("!")`) sits below
the comparison dispatch — `!$a == 1` accidentally lands correctly through
`evaluateComparison`, but the layering should be explicit: negation binds
TIGHTER than comparison (upstream unary), so a leading `!` over a
comparison expression should evaluate the comparison then negate only if
the `!` binds to the whole remainder per the checker's grammar — verify
against the checker's parse before changing; if `!x == y` parses as
`(!x) == y` in the checker, the current accidental behavior is correct
and only the logical/comparison order changes.

## Tests

- Pins in vm-runtime.test.ts (the fallback path lives there — see ticket
  03's pins): `$a == 1 && $b > 2` through a runtime-driven fallback
  (uncompilable content forcing the string evaluator), stash-proven to
  fail pre-fix; the quote case `x && "a && b"`; `a || b == c` layering.
- Full suite + conformance corpus unchanged otherwise.

## Constraints

- Standalone parity fix — must not share a commit with any grammar-merge
  work (ADR 0005).
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.