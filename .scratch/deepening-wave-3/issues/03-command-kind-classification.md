# Ticket 03 — One classification of internal `<<command>>` kinds

Type: task
Status: open

## Question

Which command names are internal lives in two lists that must agree but are
enforced nowhere: `lowerCommand` (`src/compile/compiler.ts` ~649–697: knows
`set`, `declare`, `stop`, `return`) and `runCommand` (`src/runtime/vm.ts`
~960–1017: knows `set_saliency`, `set`, `declare`, `call`). A mismatch is an
observable event-stream divergence that survives only because both lists were
written together. Ticket 05 fixed this shape for `<<set>>`/`<<declare>>`
*grammar* (`stateStatement.ts`); this is the same move one level up, for the
dispatch.

## Settled design (grilling round, 2026-09-04)

- One classification in `src/runtime/commands.ts` (which owns `parseCommand`):
  `commandKind(name) → "set" | "declare" | "call" | "setSaliency" | "stop" | "return" | "host"`.
- `lowerCommand` and `runCommand` both dispatch on it. Each driver keeps its
  own per-kind **policy** (lowering vs runtime effect) — only the naming
  knowledge becomes single-source.
- The known compile↔runtime asymmetry on `call` (compiler keeps it raw;
  VM executes it internally) becomes explicit in the dispatch instead of
  hidden across two name lists.
- Per-kind policy tables stated in the module header as the lockstep
  obligation, replacing today's implicit one.
- Note: `set_saliency` is compiler-*generated*, never authored — the
  classifier still names it so the VM's arm has a kind to dispatch on.

## Work item

1. Add `commandKind` + the union type to `src/runtime/commands.ts`.
2. Rewire `lowerCommand` and `runCommand` to dispatch on kinds.
3. Behavior identical: goldens, conformance corpus, and all event-stream pins unchanged.

## Tests

- New classification table pins (module-tier): every internal command classified; every classified kind handled by both driver sides (a "handled by both" pin per kind).
- Existing end-to-end command pins unchanged.
