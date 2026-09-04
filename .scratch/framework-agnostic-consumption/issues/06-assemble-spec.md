# Ticket 06 — Assemble the spec

Type: task
Status: resolved
Blocked by: 03, 04, 05

## Question

Assemble `.scratch/framework-agnostic-consumption/spec.md` from the resolved decisions: packaging (root React-free, `./react` subpath, optional peers — already executed, recorded as fact), the virtual-module contract, the companion package, example consolidation, the generic loader contract for non-Vite bundlers, and the fog items resolved along the way (CJS build story, HMR, d.ts strategy — whichever tickets resolved). The spec is reviewable by a human who read none of the tickets: self-contained, cross-referenced to `CONTEXT.md` vocabulary, with an explicit out-of-scope section mirroring the map's.

## Answer

Spec published at [`spec.md`](../spec.md) via the to-spec skill, synthesizing tickets 01–05 (no new interviews). Testing seams confirmed by the human before publication: one new seam (the plugin's emitted-module contract, driven through resolveId/load and evaluated), its failure half (RollupError transport + severity overrides), and existing seams extended (host-conformance tests, browser demo as end-to-end acceptance harness, plus a new resolve-every-require-condition test born from the CJS ruling).

The last fog item is ruled at assembly: **the CJS build story folds into the spec** — the export map's `require` conditions (including the ones this effort's `./react` subpath added) name artifacts no build step produces, so the effort's own packaging is only correct once the CJS output exists. Scope addition flagged in the spec's Implementation Decisions and user story 25.

With this ticket resolved, the map is complete: every decision needed before implementation is recorded, fog is empty, and the spec carries the `ready-for-agent` label for hand-off.
