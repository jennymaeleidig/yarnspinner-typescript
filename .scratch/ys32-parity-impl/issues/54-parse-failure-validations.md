# 54 — ParseFailures validation wave (delete MUST_FAIL_ALLOWLIST)

Type: task
Status: open
Blocked by: — (independent slices; follows the 0.2.0 wave)

## Scope

Ticket 23's acceptance line ("ParseFailures corpus passes with expected
diagnostic codes, allowlist gone") is unmet at 0.2.0: 12 vendored upstream
ParseFailures fixtures still compile clean where upstream requires them to
fail. Each entry below is one validation the compiler must gain, emitting
the exact upstream YS-code from the vendored per-code registry
(`test/fixtures/upstream/YarnSpinner/Diagnostics/Definitions/`); the
fixture self-cleans from `MUST_FAIL_ALLOWLIST`
(`src/tests/upstream-conformance.test.ts`) when its validation lands.
Found by the multi-stage ys32-parity spec-vs-impl review (2026-09-03);
recorded in `docs/compatibility.md` Known issues and
`.scratch/future-work.md` until then.

Validation families (fixture → missing check):

- Newline inside a command — `Commands-NewlinesNotPermittedInCommands.yarn`
- `<<declare>>`/`<<set>>` must have a value —
  `Declarations-MustHaveValues.yarn`, `SetStatements-MustHaveValues.yarn`
- Indentation validation (indented lines following options must have
  content) —
  `IncorrectIndentation-IndentedLinesFollowingOptionsMustHaveContent.yarn`
- `when:` headers must have an expression —
  `Notes-WhenHeadersMustHaveExpressions.yarn`
- Jump-target expressions must be strings —
  `Jumps-ExpressionsMustBeStrings.yarn`
- Operator typing (`+` requires numbers or strings) —
  `Operators-AdditionsRequireNumbersOrStrings.yarn`
- Assignment type conflicts —
  `Variables-CannotBeAssignedConflictingTypes.yarn`
- Type inference (functions/variables) —
  `Inference-FunctionsAndVarsCannotBeSolelyImplicit.yarn`,
  `Inference-FunctionsCannotChangeType.yarn`,
  `Inference-FunctionsMustHaveSameNumberOfParams.yarn`,
  `Variables-MustBeAbleToInferDefinition.yarn`

## Acceptance

`MUST_FAIL_ALLOWLIST` is empty; every former entry's fixture fails
compilation with exactly its upstream code (per-code registry); full suite
and lint green. Slice-sized PRs welcome — one validation family at a time;
no batch "make the fixtures fail" passes (coding standards §1: upstream is
the source of truth for each code and message).

## Comments

### 2026-09-03 — multi-stage review

Found by the ys32-parity spec-vs-impl review (finding A5): ticket 23's
"allowlist gone" acceptance and the phase-1 exit criterion were traced
unmet at HEAD. Ticketed rather than rushed into 0.2.0: each validation
needs the registry's exact code and message, and a wrong false-positive
diagnostic would break valid content — worse than the recorded gap.
