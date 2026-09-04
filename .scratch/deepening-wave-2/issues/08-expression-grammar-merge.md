# Ticket 08 — One expression grammar, three consumers (research-gated)

Type: task
Status: open
Blocked by: 04, 05

## Question

The expression grammar exists three times, and two of the copies carry
explicit LOCKSTEP cross-references. Each parser is deep in behaviour, but the
grammar knowledge is not local — the upstream `ExpAndOrXor` one-level rule
lives only as comments, and the evaluators' copy (the weakest: a regex-dispatch
hybrid) is what lost xor (ticket 03).

**This ticket is gated**: its first work item is a careful diff of the three
grammars. If the diff shows parity-relevant divergence that a shared parser
cannot preserve, the ticket resolves as *recorded, deferred* — the merge is
not forced. The conformance corpus is the safety net either way.

## Evidence

- `src/compile/typeCheck.ts` — `ExprParser` + `tokenize` (:95–460); positions
  feed `.Case` rewrites — the reason the checker's parser exists at all;
  LOCKSTEP comment at :319
- `src/compile/expressionCodegen.ts` (367) — its own tokenizer + precedence
  climber; mirrored LOCKSTEP comment at :182 ("the codegen parser (parseOr)
  mirrors this rule and its operator order — change both together")
- `src/runtime/evaluator.ts` — regex-dispatch + ad-hoc recursive descent;
  the word-alias table restated three times (typeCheck `WORD_OPS`, codegen
  `WORD_OPS`, evaluator `preprocess`) with different encodings
- Known per-consumer divergences (deliberate, must survive the merge): the
  checker tolerates trailing garbage as YS0005; codegen throws
  `ExpressionCodegenError`; the evaluator is best-effort.

## Work item

**Gate first**: diff the three grammars — tokenizers, precedence levels,
word-alias handling, `=`-as-equality tolerance, position tracking, error
modes — and record the table in this ticket's Answer. Verdict:

- **Clean / reconcilable**: proceed to one shared grammar module (one
  tokenizer + one AST with token positions + one parser), consumed by
  (a) the type checker (diagnostics + `.Case` rewrites), (b) codegen (lowers
  to bytecode), (c) the runtime fallback evaluator. The deliberate
  per-consumer divergences stay at the consumers — that is what makes the
  shared parser deep rather than a leaky lowest-common-denominator.
- **Parity-relevant divergence a shared parser can't preserve**: resolve as
  recorded-deferred; document exactly which rules differ and where, so a
  future explorer doesn't re-suggest the merge blind.

## Tests (if the gate passes)

- One grammar conformance suite: precedence (the one-level and/or/xor rule),
  word aliases, `=` tolerance, positions — replacing lockstep-by-comment.
- The checker/codegen suites keep their semantic pins; the conformance corpus
  and golden bytecode tests are the net (bytecode must not move).

## Constraints

- **ADR 0004 holds** (raw values; `.Case` folding stays in the checker/codegen
  path). No ADR tension otherwise.
- If resolving as recorded-deferred with a load-bearing reason, offer an ADR
  per the grilling-round rule so future reviews don't re-suggest the merge.
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.
