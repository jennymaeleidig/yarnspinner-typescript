# 33 — Phase 4: migration & ship

Type: task
Status: superseded (see below)
Blocked by: 32

## Goal (spec phase 4)

Migration to the new public API and the one-shot 0.2.0 "3.2 parity" release.

## Scope (spec Implementation Decisions + Out of Scope)

- React adapter migrated to the new runtime API (demo stays green) + a
  node-group/saliency storylet demo exercising strategy switching. Scene/actor
  system unchanged; React stays in the package.
- Existing 46-case suite ported to the new public API.
- Docs rewritten to reality: stale compatibility checklist replaced, ternary
  folklore claim deleted, removed extensions documented as migration notes;
  retired terms reconciled with the shipped names.
- **Includes ticket 17** (`YarnRunner` → `Dialogue` rename with deprecated alias):
  fold it into this phase's breaking-API landing rather than doing it standalone.
- Release: all breaking changes together in 0.2.0; re-check upstream for point
  releases >3.2.2 first and record the targeted version in the release notes.

## Superseded

Replaced by the vertical-slice decomposition: tickets 40–53. See the slice mapping:
30→40+41+42, 31→43+44+45+46+47+48, 32→49+50+51, 33→52+53.
