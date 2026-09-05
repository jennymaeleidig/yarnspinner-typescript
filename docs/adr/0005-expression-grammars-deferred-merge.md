# One expression grammar, three consumers — merge deferred

> Status: deferred. The three expression
> grammars stay separate; the LOCKSTEP cross-references between them are
> the load-bearing coordination mechanism.

## Context

The expression grammar exists three times, each deep in behaviour:

- `src/compile/typeCheck.ts` — `ExprParser` + `tokenize`: positions feed
  `.Case` rewrites; trailing garbage degrades to unchecked (never a
  diagnostic).
- `src/compile/expressionCodegen.ts` — its own tokenizer + precedence
  climber lowering directly to bytecode; throws `ExpressionCodegenError`.
- `src/runtime/evaluator.ts` — regex-dispatch + ad-hoc recursive descent;
  the fallback path for uncompilable expressions and inline line text.

The upstream `ExpAndOrXor` one-level rule lives only as comments, and the
evaluator's copy is what lost xor (fixed standalone, before any
refactor). A shared grammar module (one tokenizer + one AST with token
positions + one parser; consumers lower to diagnostics, bytecode, and
values) was proposed. The deferral gated the merge on a careful diff.

## The diff (the gate's evidence)

| Rule | typeCheck ExprParser | expressionCodegen | evaluator |
| --- | --- | --- | --- |
| and/or/xor level | one level, left-assoc (`|| && ^`) | one level, left-assoc (`or and xor`) | one flat level via `evaluateLogical` |
| equality vs relational | merged into ONE left-assoc comparison level | separate: equality ABOVE relational | comparison dispatch before logical; regex splits at the FIRST comparison operator |
| mixed `a == b && c` | `(a == b) && c` | `(a == b) && c` | ~~`a == ((b) && (c…))`~~ **fixed** (the logical level now splits first, quote/paren-aware; primary parens unwrap; negation reachable) |
| `=` tolerance | alias of `==` | alias of equality | alias of `==` |
| word aliases | tokenizer maps to symbols (10 incl. `xor`) | parser matches words (9 — **no `xor`**: word-xor content never compiles, rides the fallback; found while fixing the lost xor) | regex preprocess to symbols (10 incl. `xor`) |
| string escapes | none (raw text to closing quote) | `\x` → literal char; unterminated throws | quoted strings stripped by regex heuristics |
| unknown characters | skipped silently (parse-failure territory) | throw `ExpressionCodegenError` | regex dispatch never sees them; degrades to value lookup |
| positions | start/end per token (feeds `.Case` rewrites) | none needed | none |
| trailing garbage | parse returns null (unchecked) | throw | never reached (regexes match substrings) |
| error mode | collect-don't-throw | throw → documented fallbacks | best-effort (throw → caller's catch → `false`/`""`) |

The decisive row is the mixed-precedence one. It is live today: the
fallback evaluator returns `true` for `$a == 1 && $b > 2`
(`$a == ((1 && $b) > 2)` — verified against dist 2026-09) where the
checker's layering and upstream's single grammar give
`($a == 1) && ($b > 2)`. Inline `{expr}` text composes through this
evaluator at delivery time, so the divergence is observable, not
hypothetical.

## Decision

**The merge is deferred.** Two reasons:

1. The divergence a shared parser exists to fix is *behavior*, not
   structure: adopting the shared parser changes the fallback evaluator's
   observable output for mixed-precedence expressions — a parity fix, not
   a refactor. Per the precedent of the standalone xor fix above, parity
   fixes land as standalone commits, never bundled with a refactor.
2. The consumers' AST needs diverge structurally (positions + arg-texts +
   rewrites for the checker; direct bytecode emission for codegen; string
   recursion for the evaluator). The shared parser is real, but wiring
   three backends under it is a multi-session rewrite whose regression
   surface (the golden corpus aside) is the runtime's fallback paths —
   the least-covered corner.

The grammar knowledge therefore stays non-local, with the LOCKSTEP
cross-references (`typeCheck.ts parseOr` ↔ `expressionCodegen.ts
parseOr`) kept as the coordination mechanism, and the diff table above as
the record.

## Reopening conditions

The merge stops being deferrable when any of these holds:

1. **A fourth consumer appears** (e.g. a formatter or an expression
   pretty-printer) — the fourth hand-rolled copy crosses the cost line.
2. **The divergence class grows**: a second live divergence on the
   fallback path (beyond the mixed-precedence fix recorded below) means the
   regex-dispatch evaluator is drifting faster than it can be pinned;
   converge by adopting the shared parser rather than by patching.
3. **Conformance fixtures cover mixed-precedence inline expressions** —
   the corpus stops shielding the evaluator's layering.

## Consequences

- This deferral is recorded here; future architecture reviews
  should read this ADR before re-proposing the merge.
- The known live divergence was fixed as its own standalone change, pinned
  by `src/tests/vm-runtime.test.ts` — the fix
  landed; it was never a step toward the merge, and the deferral above
  stands.
- The three grammars' operators stay pinned by their respective suites;
  the conformance corpus and golden bytecode remain the net.