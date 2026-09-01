# Spec roadmap & implementation ordering

Type: grilling
Status: resolved
Blocked by: —

## Question

The final map ticket: every area decision has landed (tickets 03–15). Decide the **implementation ordering the spec will prescribe** — the dependency-driven phases the parity work follows, and what "done" means for each (which fixture phases must pass). Inputs: all Decisions-so-far on [the map](../map.md); conformance phasing from [01](./01-upstream-conformance-fixtures.md) (vendor + must-fail → testplan runner → diagnostic codes); the IR/VM decision ([14](./14-ir-vm-redesign.md)) gating nearly everything runtime-side; the API migration ([05](./05-runtime-api-shape.md)) gating the demo/React hook update. Also decide: single "parity 1.0" release vs staged minor releases, and the re-check of Yarn Spinner point releases at spec time (map Notes).

## Answer

All recommendations confirmed by the maintainer:

1. **Five dependency-driven phases** adopted as the spec's ordering skeleton:
   - **0 — Conformance foundation**: vendor upstream `Tests/`, `.testplan` DSL parser, event-stream TestBase port, ParseFailures must-fail loop. Exit: harness runs, 33 must-fail files assert codes.
   - **1 — Compiler & language core**: parser additions, expression bytecode, instruction-stream JSON program, diagnostics channel + first YS tranche, string table + CRC32 line IDs + `#shadow:`. Exit: all 32 fixture `.yarn` files compile with expected diagnostics.
   - **2 — Runtime & VM**: stack VM, pull API (continue/events/Library/VariableStorage), LineParser + markup, saliency + `=>`, visit tracking. Exit: testplan runner green on the 32 pairs.
   - **3 — Compiler surface & localisation**: multi-file `compile()` + modes + external declarations; CSV strings + translation provider + line-tag generators.
   - **4 — Migration & ship**: React hook + demo migrated (demo green), docs rewritten (stale compatibility checklist, ternary claim), version release. Exit: demo + full suite green.
2. **Release: one 0.2.0 "3.2 parity" release** — breaking API lands together; no long half-migrated window; no external consumers to grandfather.
3. **Point-release re-check confirmed**: the spec session re-checks Yarn Spinner for releases >3.2.2 before writing and records the exact targeted version.

With this ticket the map is complete: every decision needed to write the 3.2 parity spec has been made.
