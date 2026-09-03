# 54 — ParseFailures validation wave (delete MUST_FAIL_ALLOWLIST)

Type: task
Status: resolved
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

Parity-completeness items (no vendored fixture covers them; found by the
final review pass, 2026-09-03):

- A bare `<<call>>` (no call expression) compiles with zero diagnostics;
  upstream's grammar requires a call expression there.
- A same-line trailing `///` after a declaration (upstream
  `allowCommentsAfter`, Compiler.cs) is silently dropped here; upstream
  attaches it to the declaration.

## Comments

### 2026-09-03 — multi-stage review

Found by the ys32-parity spec-vs-impl review (finding A5): ticket 23's
"allowlist gone" acceptance and the phase-1 exit criterion were traced
unmet at HEAD. Ticketed rather than rushed into 0.2.0: each validation
needs the registry's exact code and message, and a wrong false-positive
diagnostic would break valid content — worse than the recorded gap.

### 2026-09-03 — resolved

All 12 fixtures now fail with exactly their upstream codes; the
`MUST_FAIL_ALLOWLIST` is empty and deleted. The codes were pinned by
building and running the upstream v3.2.2 compiler against the corpus
(not inferred from the registry docs): newline-in-command → YS0006;
`<<declare>>`/`<<set>>` without a value → YS0006 when the command is
truncated after the variable (upstream's unclosed-command heuristic) and
YS0005 when truncated inside the expression; indentation and `when:`
header → YS0005; jump-target, operator, and assignment typing → YS0050;
inference → YS0029 (untypeable expression + target) and YS0014 (implicit
function arity conflict, "called elsewhere" message). Both
parity-completeness items landed: a bare `<<call>>` is YS0005 (upstream's
grammar requires a call expression — upstream itself crashes there with a
null-ref, so the collect-don't-throw rendering is a syntax diagnostic),
and a trailing `///` on a declaration line overrides preceding doc lines
as the description (upstream `allowCommentsAfter`).

Implementation notes:

- Parse failures now carry their registry code (`ParseError.code`); the
  seam reports YS0006 verbatim and keeps the `"Syntax error: {0}"`
  template for codeless errors.
- The type checker gained upstream's constraint-solving essentials:
  implicit function return/arity inference from the first typed use,
  operator pinning of unknown variable operands (`$a + 1` → $a is
  Number), bool-constrained condition operands, string-constrained jump
  targets, and post-walk resolution of undetermined set/declare sites and
  inline `{expr}` uses — so nothing false-positives on content the
  upstream solver would resolve.
- Also corrected to the registry: YS0014 messages carry the
  `"Invalid function call: {0}"` template prefix, and YS0029 was missing
  from the project's registry (added; error severity). The Boolean type
  now displays as "Bool" in messages, matching upstream.
- Tests: `src/tests/parseFailureValidations.test.ts` (31 tests, one per
  family plus clean-case false-positive guards). Docs updated:
  compatibility.md known-issue removed, future-work.md struck through,
  CHANGELOG entry.
- Adjacent coverage fix bundled in: `once ... else >>` else-bodies were
  never walked by the type checker; they now are (flagged by review as
  scope creep — kept, documented here instead of reverting to a known
  unchecked branch).

Landed in this branch's ticket-54 commit.

### 2026-09-03 — final review wave

Ticket-54's commit (d396c2c) only emptied `MUST_FAIL_ALLOWLIST`; the actual
deletion of the allowlist and its dead self-clean assertion machinery landed
in the final-review wave, 6452978 (module docblock corrected — no
must-fail allowlist promised; ParseFailures codes now point to
`parseFailureValidations.test.ts`). "Empty and deleted" is true at HEAD.
