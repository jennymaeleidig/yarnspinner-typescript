# Ticket 05 — One grammar module for `<<set>>` / `<<declare>>`

Type: task
Status: open
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
