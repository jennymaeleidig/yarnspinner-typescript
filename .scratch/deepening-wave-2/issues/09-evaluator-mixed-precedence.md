# Ticket 09 — Fallback evaluator: mixed comparison+logical precedence

Type: task
Status: resolved
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

## Answer

One dispatch reorder fixes all three failure modes (they share the root
cause — the layering):

- **Logical level first** (the headline): `evaluateExpression` now splits
  `&&`/`||`/`^` (paren- AND quote-aware, via a new `splitLogical`) before
  the comparison dispatcher can claim the chain's operands — the layering
  the checker's `parseOr` and the codegen's `parseOr` both implement.
  `$a == 1 && $b > 2` now parses `($a == 1) && ($b > 2)` — pre-fix it
  evaluated `$a == ((1 && $b) > 2)` and composed `True` (verified).
- **Negation reachable**: `containsComparison` drops `!` from its class —
  every comparison operator contains `=`/`<`/`>` anyway, and the bare `!`
  was claiming the dispatcher, making ANY negated expression throw
  (`!true`, `!$x` → "Invalid comparison"). `!x == y` still lands on the
  comparison split, whose left side recurses into the negation —
  `(!x) == y`, the checker's unary binding, now explicit rather than
  accidental.
- **Primary parens unwrapped**: a fully parenthesized expression
  (`(1 && 0)`) re-enters the layering after stripping its wrapper — the
  old dispatcher recursed infinitely there (stack overflow → compose as
  empty). The unwrap is quote-aware and only fires when the paren closes
  at the last character.
- The splitter is quote-aware, so `x && "a && b"` no longer splits inside
  the string literal.

The old `evaluateLogical` also had a latent infinite-recursion path
(`parts.length === 0` → re-evaluate the same expression) — the new
splitter returns null instead, falling through the layering cleanly.

Pins in vm-runtime.test.ts (the fallback path's home, per ticket 03's
pattern), all stash-proven to fail pre-fix and pass post-fix:
- inline-text layering `{$a == 1 && $b > 2} / {$a == 1 && $b > 0}` →
  "False / True";
- negation reachability `{!true} / {!$flag} / {!$flag == true}` →
  "False / True / True" (the third checks the checker's unary binding:
  `(!flag) == true`);
- parens `(1 && 0)` → False (was: stack overflow) and a `&&` inside a
  string literal → no wrong split.

Full suite, conformance corpus, and golden bytecode unchanged otherwise:
suite 602 (601 pass, 1 mirrored skip), lint clean, ts-check clean, demo
build green. Ticket 08's ADR 0005 diff table stays as the record; the
"logical-level-first" row of that table is now fixed for the evaluator
(the ADR's table described the pre-fix state — the deferral itself stands:
no merge, no shared parser, this was a standalone parity fix).

**Glossary proposal (per the grilling round):** none — the layering is
already CONTEXT.md's expression entries (and/or/xor one-level rule); this
fix aligns the fallback mechanism to it.