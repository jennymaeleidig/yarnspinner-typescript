# Ticket 07 — One inline-expression span scanner

Type: task
Status: resolved
Blocked by: 05

## Question

Four hand-rolled scanners answer the same question — "where are the inline
`{expr}` spans in this text?" — and their escape rules already disagree, so
compile-time classification is coupled to the runtime composer's escape
contract by convention only. A line like `\{not an expr\}` or an escaped
backslash before `{` can classify differently at compile time than at delivery
— precisely the class of bug the compile-time markup validation exists to
prevent.

## Evidence

- `src/compile/compileSource.ts` — `blankInlineExpressions` (:523–545): skips
  two chars after *any* backslash
- `src/compile/stringTable.ts` — `hasInlineExpression` (:380–399): treats only
  `\{`/`\}` as escapes (:387)
- `src/compile/typeCheck.ts` — `collectInlineExpressionVars` (:897–931): skips
  backslash+2 like blankInlineExpressions, but its doc comment claims the
  runtime's contract is `\{`/`\}`
- `src/runtime/interpolate.ts` — `expandSubstitutions` (:177–200): the runtime's
  authority

## Work item

One `inlineExpressionSpans(text)` module returning
`{ start, end, source }[]` with the runtime's escape contract stated once:

- `blankInlineExpressions` becomes "blank the spans"
- `hasInlineExpression` becomes `spans.length > 0`
- `collectInlineExpressionVars` becomes "parse each span's source"
- `expandSubstitutions` consumes the same spans

The one subtlety to respect: `expandSubstitutions` must keep evaluating spans
*during* the scan (substitution values can contain braces) — that consumer
keeps its own incremental loop, or the module supports incremental scanning;
everything else folds.

## Tests

- One span test per edge case on the scanner: `\{`, `\\{`, unclosed `{`,
  nested braces in string literals — replacing the escape-contract pins
  currently scattered across three suites (markupLineParser/invariant-formatting
  for runtime, lineIds/shadow tests for YS0043, typeCheck behaviour tests).
- All four consumers inherit the pins.

## Constraints

- No ADR tension.
- Per the grilling round: `inlineExpressionSpans` becomes a named module —
  propose the CONTEXT.md glossary wording at resolution (it feeds the **line
  parser**'s substitution stage).
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.

## Answer

`inlineExpressionSpans(text)` lives in `src/runtime/interpolate.ts` — the
runtime composer is the escape contract's authority, so the scanner lives
beside it. Returns `{ start, end, source }[]`. The contract, stated once
in the module header: `\{`/`\}` are the only escapes (any other backslash
is literal — there is no `\\` escape, so `\\{expr}` is a literal
backslash then an escaped brace); a span runs from `{` to the *next* `}`
(expressions are not brace-balanced — a `}` in a string literal closes the
span, exactly as delivery reads it); an unclosed `{` composes literally.

Consumers:
- **expandSubstitutions** keeps the compose-side escape transform
  (`\{`→`{` — that is its output shape, not a classification) but rides
  the scanner for span positions. The ticket's "keep evaluating during
  the scan" caveat dissolved: evaluated values compose into the output
  and are never rescanned, so consuming precomputed spans is safe.
- **blankInlineExpressions** (compileSource) blanks the span contents.
- **hasInlineExpression** (stringTable) is `spans.length > 0`.
- **collectInlineExpressionVars** (typeCheck) parses/checks each span's
  source.

**Drift fixed** (compile-side now classifies exactly what delivery
evaluates; all fixtures and the golden corpus pass unchanged — the old
divergences lived in shapes no pin covered):
- `\x{expr}`: the old blanking skipped two chars after any backslash and
  still blanked the span (same result), but the type checker's loop and
  blanking disagreed with the runtime on `\\{expr}` — the old scanners
  classified it as a span (backslash-skip) where the runtime composes a
  literal backslash then an escaped brace (no evaluation). A variable
  inside `\\{...}` was type-checked but never evaluated at runtime; now
  both agree: not an expression.
- The old type-check loop *broke out* of the whole scan at an unclosed
  `{`; the runtime keeps scanning — a later closed span still evaluates.
  The checker now matches delivery.

`expandSubstitutions` exported (module-internal tier — interpolate.ts is
not in the package surface) so the composition pins can live beside the
scan pins. New `src/tests/inlineExpressionSpans.test.ts`: escaped braces,
escaped backslash, backslash-before-other-chars, unclosed, brace-in-
string-literal, inner-brace, and the composition table. Suite 599 (598
pass, 1 mirrored skip), lint clean, ts-check clean, demo build green.

**Glossary (per the grilling round — applied):** CONTEXT.md's language
section gains **Inline-expression spans**, named alongside the line
parser's substitution stage, with the scan contract and the
"compile-side classifiers consume the same spans" clause.
