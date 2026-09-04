# Ticket 05 — One grammar module for `<<set>>` / `<<declare>>`

Type: task
Status: resolved
Blocked by: 04

## Question

The state-statement grammar — `set $var (to|=) expr`, `set $var (+=|-=|*=|/=|%=)
expr`, `declare $var = expr (as TYPE)?` — is hand-parsed four times with four
different mechanisms (regexes, tokenizer output re-sliced, regex). The copies
already disagree in the margins, and the compiler carries a lockstep comment
for one pair.

## Evidence

- `src/compile/typeCheck.ts` — regexes (:1009, :1052) for declare/set/compound/`as TYPE`
- `src/runtime/commands.ts` — `executeStateStatement` (:110–190): arg slicing,
  `to`/`=` stripping, its own compound-op table (:131–135)
- `src/compile/compiler.ts` — `lowerSet` (:700–726): the *same* `to`/`=` strip
  and a parallel `COMPOUND_OPS` table (:694), with the lockstep comment "the
  fallback shape for uncompilable expressions must stay in lockstep with this one"
- `src/compile/smartVariables.ts` — `parseDeclareCommand` (:18–25): the declare
  regex + `as` postfix again
- Marginal disagreements already present: typeCheck's `<<set>>` regex accepts
  `\$(\w+)` while commands.ts/compiler.ts accept `[A-Za-z_][A-Za-z0-9_]*` via
  parseCommand.
- The "$ prefix optional" rule is repeated in commands.ts, compiler.ts, vm.ts
  (constructor's `variables` normalization), and useDialogue's docs.

## Work item

One `parseStateStatement(content)` module returning
`{ kind: "set" | "declare", name, expression, compoundOp?, declaredType? }` —
small interface, all four grammars' worth of behaviour:

- typeCheck consumes it for checking
- compiler's `lowerSet` consumes it for codegen
- `executeStateStatement` consumes it for the runtime fallback
- smartVariables consumes it for classification

Pick the authoritative identifier/`$`-prefix rule deliberately (the stricter
read mirrors upstream) and record the choice — do not silently preserve the
loosest behaviour. Note any spelling that changes classification in the ticket
answer.

## Tests

- A table-driven test on the parse module: every spelling (`to` vs `=`, each
  compound op, quoted expressions, `as` postfix, `$`-prefix presence/absence) —
  a suite that today has no single module to attach to.
- The fallback path (uncompilable `<<set>>` → raw command →
  `executeStateStatement`) gains explicit pins: all four consumers structurally
  agree because they share the parse.
- Existing vm-runtime codegen-fallback tests and `variables_flow_cmds.test.ts`
  unchanged.

## Constraints

- **ADR 0003 holds**: the raw command text still rides the instruction for the
  fallback path — no program-format change.
- No ADR tension otherwise.
- Per the grilling round: `parseStateStatement` becomes a named module —
  propose the CONTEXT.md glossary wording at resolution.
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.

## Answer

`src/parse/stateStatement.ts` is the one grammar module:
`parseStateStatement(content)` returns
`{ kind, name, expression, assignment?, compoundOp?, declaredType? }`, and
`compoundOperatorToStackOp` is the one compound-operator → stack-op
mapping (compiler's `COMPOUND_OPS` and commands.ts's ternary both
deleted). The parse lives in the parse tier (compile already imported
it; runtime now does too — one tier closer than runtime→compile).

Consumers rewired:
- **typeCheck.ts**: the declare regex, compound regex, and set regex
  (three hand-rolled matchers, two identifier rules) replaced by the one
  `parseStateStatement` + kind guards; the `as TYPE` postfix handling
  collapses into the module.
- **compiler.ts**: `lowerSet` takes the content string and parses through
  the module; the lockstep prose comment ("must stay in lockstep with
  this one") is deleted — the runtime fallback consumes the same parse
  structurally. `collectInitialValues` uses the module;
  `parseDeclareCommand`/`DeclareCommand` are deleted from
  smartVariables.ts.
- **commands.ts**: `executeStateStatement` restructured over the parse;
  the unused `parsed?: ParsedCommand` parameter is dropped from its
  interface (the vm.ts call site updated) — the interface shrinks.
- **parser.ts's YS0006/YS0005 shape validation deliberately stays
  separate** (recorded per the module's header): it reports the *malformed*
  truncation shapes this parser rejects, with looser regexes by design so
  it can name what went wrong; folding it in would couple diagnostic
  shape parity to the parse result.

Deliberate convergence recorded (both stricter, both upstream-correct):
- Identifier rule: `[A-Za-z_][A-Za-z0-9_]*` everywhere — the type
  checker's old `$\w+` accepted `$1abc`; a pin in the grammar test now
  locks the upstream rule.
- `set $x to += 1` (operator after the assignment word): the old runtime
  and compile paths double-stripped and treated it as compound, while the
  type checker diagnosed it — the shared grammar treats it as a plain set
  of expression `+= 1` (an evaluation error at runtime, YS0005-class at
  compile), matching upstream's token order (operator directly after the
  variable reference). Garbage input now agrees across all consumers.

New `src/tests/stateStatement.test.ts`: the spelling table (to/=, all
five compound ops spaced and attached, declare with/without postfix,
`as` inside quotes not the postfix, identifier rule, null shapes, the
stack-op mapping). Suite 588 (587 pass, 1 mirrored skip), lint clean,
ts-check clean, demo build green.

**Glossary proposal (per the grilling round):** none —
`parseStateStatement` is implementation (the state-statement grammar is
already covered by CONTEXT.md's language entries; the module is its
mechanism).

**Wave-end review addition (spec axis):** the Tests item "the fallback
path gains explicit pins: all four consumers structurally agree" was
flagged partial — agreement was only indirect (ticket 03's xor pin). Two
explicit pins now live in vm-runtime.test.ts: an uncompilable `<<set>>
with a word alias (`$n xor true` — checker validates, codegen defers per
ADR 0005's recorded gap, stateStatement parses, evaluator applies) and an
uncompilable `<<set>>` with trailing garbage (best-effort landing, no
crash). The declare branch needs no fallback pin: declares hoist to
initial values and never reach the runtime through the compile seam.
