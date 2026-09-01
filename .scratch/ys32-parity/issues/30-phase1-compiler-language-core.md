# 30 — Phase 1: compiler & language core

Type: task
Status: superseded (see below)
Blocked by: 23 *(diagnostics channel must land first — compiler work emits through it)*

## Goal (spec phase 1)

Exit criterion: **all 32 fixture `.yarn` files compile with expected diagnostics**
(adoption-phasing step 3: ParseFailures corpus asserts exact YSxxxx codes; delete
the ticket-20 allowlist).

## Scope (spec Implementation Decisions)

- Syntax removals (breaking, with migration notes): option `[if expr]` suffix,
  inline `{if}{else}{endif}` blocks, `&css{}`.
- `$`-prefix strictness with bare-variable diagnostic; escapable `:`;
  `subtitle` header + YS0032-style group-duplicate check.
- Full enums (uniform raw values, auto-numbering, `.Case`, same-enum
  `==`/`!=` restriction) + host-defined enums via external declarations path.
- Full smart variables (read-only YS0030, recompute-on-access, cycle detection
  YS0045, `tryGetSmartVariable`).
- First-tranche YS-codes wired into the channel (ticket 10's ~22 adoptable).

## Not in this phase

Runtime API reshape / VM (ticket 31); localisation (ticket 32).

## Superseded

Replaced by the vertical-slice decomposition: tickets 40–53. See the slice mapping:
30→40+41+42, 31→43+44+45+46+47+48, 32→49+50+51, 33→52+53.
