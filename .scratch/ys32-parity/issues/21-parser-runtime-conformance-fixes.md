# 21 — Parser/runtime conformance fixes (spec phases 1–2, partial, early)

Status: resolved (retroactive)
Landed in: a0fe16a, reviewed/corrected in 1f551e3
Retroactive: implemented alongside ticket 20 without a ticket or tier review —
scope was chosen unilaterally by the implementer against spec phases 1–2.

## Scope (as implemented)

Behavior slices from spec Implementation Decisions pulled forward while making the
harness run:

- Parser: enum-block INDENT loop, INDENT/DEDENT transparency (unified in
  `skipIndentTransparency`), `//` comment stripping, trailing-space trim,
  `#line:` hashtag colons, option-group blank-line separation (upstream grammar
  YarnSpinnerParser.g4:147-149).
- Runtime: `setNode()`, working `<<stop>>` halt, `<<return>>` detour unwind,
  jump unwinds return stack with per-node visits, braced jump/detour destinations,
  `{expr}` command expansion, True/False bool interpolation, compound assignment
  (`+= -= *= /= %= %=`-family) with upstream value rendering (`stringifyOperand`
  as single renderer), string concatenation, implicit-default variable comparisons
  (spec's recorded pre-diagnostics adaptation), `tracking:` header.
- Review pass (1f551e3): jump/detour/command handling deduplicated into
  `performJump`/`beginDetour`/`runCommandState`; dead `executeBlock` removed;
  implementation notes added to docs/commands.md, flow-control.md, jumps.md,
  logic-and-variables.md.

## Caveats

- Not the full phase-1/2 scope: no syntax removals, no enums/smart variables,
  no pull-based API reshape, no IR/VM redesign. Those remain tickets 30/31.
- Maintainer never reshuffled tiers before this landed (map working-style rule) —
  recorded here as the process lesson that motivates the retroactive trail.

## Acceptance

Included in ticket 20's driver runs; full suite 135/135 at 1f551e3.
