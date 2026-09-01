# 31 — Phase 2: runtime & VM

Type: task
Status: superseded (see below)
Blocked by: 30

## Goal (spec phase 2)

Exit criterion: **testplan runner green on the 32 plan pairs** — no allowlist.

## Scope (spec Implementation Decisions)

- IR/VM redesign (wayfinding ticket 14, ADR 0001/0003): tree IR retires;
  TS-idiomatic instruction-stream stack VM; expressions compile to bytecode;
  program = versioned JSON with `languageVersion`; jumps as instruction indices.
- Pull-based runtime API (ADR 0002): `continue() → DialogueEvent[]` with camelCased
  event vocabulary; `advance()` removed; `selectOption(index | noOptionSelected)`
  fall-through; `setNode()`/`stop()`; Library-style registry replaces
  functions-map/handleCommand split; built-in conformance (`random_range` int,
  variadic floor family, `has_any_content`, `format`).
- Saliency full machinery: complexity scoring, four strategies (Random BLRV
  default), two-method strategy interface, `<<set_saliency>>`, node-group
  conformance errors, query APIs; saliency history as generated variables.
- Detour/return as call stack of return addresses (jump inside detour clears it);
  per-node line-ID table for opt-in `LineHints`.
- Ported markup tests against the runtime line-parser module (seam 2).

## Note

Parts of this phase landed early and retroactively (tickets 21/22) on the old
tree-IR runner; this ticket rebuilds them on the VM.

## Superseded

Replaced by the vertical-slice decomposition: tickets 40–53. See the slice mapping:
30→40+41+42, 31→43+44+45+46+47+48, 32→49+50+51, 33→52+53.
