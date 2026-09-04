# Ticket 07 — One inline-expression span scanner

Type: task
Status: open
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
