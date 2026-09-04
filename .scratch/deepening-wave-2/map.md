# Deepening wave 2 — grammar & semantics locality

Architecture review 2026-09-03 (HTML report in session temp, findings transcribed
into the tickets below). Seven deepening candidates, ordered per the grilling
round: cheap test-facing wins first, the live xor bug next, structural grammars
after, the parity-risky grammar merge last behind a research gate.

## Tickets

| # | Ticket | Candidate | Status |
|---|--------|-----------|--------|
| 01 | [01-events-shaped-drain.md](issues/01-events-shaped-drain.md) | Events-shaped drain in the Transcript module (review #6) | resolved |
| 02 | [02-derived-view-option.md](issues/02-derived-view-option.md) | Derive DialogueViewOption from DialogueOption (review #7) | resolved |
| 03 | [03-xor-fallback-parity-fix.md](issues/03-xor-fallback-parity-fix.md) | Standalone xor fallback-path parity fix (review #3, fix half) | resolved |
| 04 | [04-operand-semantics-module.md](issues/04-operand-semantics-module.md) | One operand-semantics module (review #3, deepening half) | resolved |
| 05 | [05-state-statement-grammar.md](issues/05-state-statement-grammar.md) | One grammar module for `<<set>>`/`<<declare>>` (review #2) | resolved |
| 06 | [06-statement-walker.md](issues/06-statement-walker.md) | One statement walker for the compile seam (review #1) | open |
| 07 | [07-inline-expression-spans.md](issues/07-inline-expression-spans.md) | One inline-expression span scanner (review #4) | open, blocked by 05 |
| 08 | [08-expression-grammar-merge.md](issues/08-expression-grammar-merge.md) | One expression grammar, three consumers (review #5) — research-gated | open, blocked by 04, 05 |

Frontier order = ticket number (matches the grilling round: 6→7→3→3→2→1→4→5).

## Decisions-so-far

- **Ticket 05 (resolved)**: `src/parse/stateStatement.ts` — one
  `parseStateStatement` + `compoundOperatorToStackOp`; four consumers
  rewired (typeCheck's three regexes, compiler's lowerSet +
  collectInitialValues, commands' executeStateStatement whose unused
  `parsed?` param is dropped, smartVariables' parseDeclareCommand
  deleted); lockstep prose deleted. Convergences recorded: upstream
  identifier rule everywhere (`$1abc` rejected), `to += 1` garbage
  converges on the checker's reading. parser.ts's YS0006/YS0005 shape
  validation deliberately separate (records malformed shapes).
- **Ticket 04 (resolved)**: `src/runtime/operands.ts` — applyBinaryOp/
  applyUnaryOp own every operator rule; VM's 14 binary cases collapsed to
  one dispatch; the evaluator's private `toNumber` duplicate and unused
  `deepEquals` deleted; commands.ts's third compound-op copy replaced
  (deliberate alignment: non-numeric `+=` now surfaces a runtime
  diagnostic per toNumberOperand, not silent NaN — recorded). Public
  surface unchanged via evaluator.ts re-export. Operator table test added.
- **Ticket 03 (resolved)**: the string evaluator's `evaluateLogical` now
  splits on `^` and applies VM-mirroring bool-xor; xor in content is
  correct end-to-end again. Reachability finding recorded for ticket 08:
  codegen's `WORD_OPS` lacks the `xor` word alias (the checker's has it),
  so word-xor content always rides the fallback path. Both regression
  pins stash-proven to fail pre-fix.
- **Ticket 02 (resolved)**: `DialogueViewOption = DialogueOption` (derived,
  the `TranscriptLine` treatment); `reshapeView`'s options field-copy
  deleted; `text` branch left explicit (spreading would add `lineId` to
  the view object). Host builds green — fog discharged. Glossary: none.
- **Ticket 01 (resolved)**: `runUntilCompleteEvents(dialogue, selectOption?)`
  in the transcript module; one guard policy (1 000 pulls) that **throws**
  past the cap instead of silently returning a partial stream; 12 drain
  sites migrated; `upstream/testBase.ts` stays (step-locked conformance
  harness — a different, upstream-mirrored contract). Glossary: the
  **stopping point** entry's orchestration family extended by one clause,
  no new term.

- **Scope (grilling Q1)**: all seven candidates enter the wave as tickets;
  ticket 08 (review #5) carries a research gate — the first work item is a
  careful diff of the three expression grammars (typeCheck ExprParser,
  expressionCodegen, evaluator). If the diff shows parity-relevant divergence,
  the ticket resolves as "recorded, deferred" with the divergence documented —
  the merge is not forced.
- **Order (grilling Q2)**: 6→7→3→2→1→4→5 from the review, mapped to tickets
  01→08. Cheap wins warm up the harness; xor lands third; the grammar merge
  last.
- **Xor fix split (grilling Q3)**: the parity correction is a standalone commit
  (ticket 03) before the operand-semantics refactor (ticket 04) — a parity fix
  and a refactor do not share a commit.
- **Vocabulary (grilling Q5)**: naming decisions surface per ticket — a
  one-line CONTEXT.md glossary proposal at each ticket's resolution (new terms:
  the events-shaped drain function extends the **stopping point** contract;
  `parseStateStatement` (05) and `inlineExpressionSpans` (07) become named
  modules). Glossary never drifts silently.
- **Wave-end review (grilling Q6)**: a two-axis review (standards + spec) runs
  when all tickets resolve — four tickets touch parity-relevant code.

## Notes

- Already deep enough, do not re-explore (review's negative findings):
  compileSource as the compile seam, Transcript/runUntilStopped, string table
  manager, saliency strategy seam, variable storage, markup line parser, the
  config/live split, the DialogueRunner/DialogueView split.
- ADRs 0001–0004 are settled; every ticket was checked against them and none
  re-litigates. Ticket 04 explicitly preserves the op set and bytecode (golden
  corpus pins it); ticket 05 keeps the raw command text riding the instruction
  (ADR 0003); ticket 08's merge keeps per-consumer error modes at the consumers.
- The prior deepening wave (Transcript module, config/live split, headless
  view split) is excluded from this wave's scope.
- xor divergence evidence, verified live against dist (2026-09-03):
  `true xor false → false`, `1 xor 0 → false` in the string-evaluator fallback
  path. Full evidence per ticket below.

## Fog

- **Ticket 08's grammar-diff outcome** — whether the three expression parsers
  can merge without observable divergence, or resolve as recorded-deferred.
  Discharged by ticket 08's gate work item.
- **Ticket 02's build fallout** — DISCHARGED (ticket 02 answer):
  demo/next/sveltekit builds green against the derived alias.
