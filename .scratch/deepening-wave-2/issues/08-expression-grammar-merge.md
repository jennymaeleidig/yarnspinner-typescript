# Ticket 08 — One expression grammar, three consumers (research-gated)

Type: task
Status: resolved
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

## Answer

**Gate verdict: parity-relevant divergence → recorded-deferred**, per the
ticket's own rule. The full diff table lives in **ADR 0005**
(`docs/adr/0005-expression-grammars-deferred-merge.md`), written per the
grilling-round rule so future reviews don't re-suggest the merge blind.
Highlights:

| Rule | checker | codegen | evaluator |
| --- | --- | --- | --- |
| and/or/xor | one level, left-assoc | one level, left-assoc | one flat level (evaluateLogical) |
| equality vs relational | merged into one level | separate, equality above relational | comparison dispatch before logical; regex splits at the first comparison op |
| mixed `a == b && c` | `(a == b) && c` | `(a == b) && c` | `a == ((b) && (c…))` — **live divergence** |
| word aliases | 10 incl. `xor` | 9 — **no `xor`** (word-xor never compiles; rides fallback; found in ticket 03) | 10 incl. `xor` |
| unknown chars | skipped silently | throw | degrades to value lookup |
| trailing garbage | unchecked | throw | regexes match substrings |

The decisive divergence is live and verified: the fallback evaluator
returns `true` for `$a == 1 && $b > 2` (inline `{expr}` text composes
through it) where the checker's layering and upstream give `false`. A
shared parser could only *fix* that — i.e. change fallback behavior —
which is a parity fix, not a refactor. Per the wave's rule (ticket 03's
precedent) parity fixes never bundle with refactor work, and wiring three
structurally-divergent backends under one parser is a multi-session
rewrite. Deferred.

Outcomes:
- **ADR 0005** records the diff table, the deferral, and three reopening
  conditions (fourth consumer appears; divergence class grows past the
  known fix; fixtures cover mixed-precedence inline expressions).
- The live divergence is filed as its own standalone ticket in this
  tracker: **ticket 09** (`09-evaluator-mixed-precedence.md`, blocked by
  this one), the ticket-03 pattern — standalone parity fix against the
  checker's layering, no merge work attached.
- The codegen word-alias gap (`xor` missing from WORD_OPS — word-xor
  content never compiles and always rides the fallback) is recorded in
  the ADR's table. It is *masked* by correct behavior today (the fallback
  handles it) but is a checker/codegen asymmetry; folding it into ticket
  09's parity scope would tangle two grammars in one commit — it is
  recorded in ADR 0005's diff table instead, to be fixed alongside the
  merge or as its own parity ticket if it ever observably diverges.
- No code changed in this ticket — the gate's product is the record.

**Glossary proposal (per the grilling round):** none — the grammars stay
three (deferred); ADR 0005 carries the vocabulary (the reopening
conditions are the ADR's load-bearing content, not a domain term).
