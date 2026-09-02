# 46: VM completion — tree IR retires

**What to build:** everything the fork's runner does today works on the VM — once-state and visit counts as generated variables in storage, detour/`<<return>>` as a call stack of return addresses (jump inside detour clears it), `tracking:` header, command expansion and value rendering — so the full suite and all 32 testplan pairs run on the VM alone and the tree IR is deleted (contract step).

**Blocked by:** 45 (VM core).

**Status:** done

- [x] All 32 testplan pairs run on the VM alone (the conformance harness no longer has a tree-IR path)
- [x] Every pair the tree driver ran green is green on the VM (incl. the four driver-only pairs: Detours, VisitCount, Visited, NodeGroupVisitTracking)
- [x] The statement-level gaps that belong to no later ticket land here, and their pairs go green: Lines (line-level `<<if>>`/`<<once>>`/`<<once if>>`), Once (<<once if>>/<<else>> blocks, option `<<once>>`), ShortcutOptions (option-group parsing), VisitTracking (subtitle-qualified visit keys), Escaping (main-grammar escapes + line-parser escaped chars)
- [x] Full suite green with tree IR deleted (251/251)
- [x] No duplicated behavior between old and new execution paths (`src/compile/ir.ts` and `src/compile/emit.ts` deleted; `Dialogue` drives the VM only; `isInstructionStreamProgram` and the `ConformanceProgram` union are gone)

Implementation notes:

- Compiler merge: `compiler.ts` lowers AST → instruction streams directly (label pass for jumps/option destinations). `initialValues`/`smartVariables` are compiled `Instruction[]`; a multi-arg function-call fix in the expression tokenizer (`,`) fell out of the equivalence work.
- Once semantics (upstream 3.2.2): line `<<once>>` gate = `not($Yarn.Internal.Once.<lineID>)` AND condition, flag stores before `runLine`; option `<<once>>` availability likewise, flag stores at the body's first instruction (on selection); `<<once if>>` blocks gate the same way with an optional `<<else>>`.
- Visits: recorded on node return; a `subtitle:` member also records `Title.Subtitle`. Detour return frames carry the member index so group members record the right key.
- `<<stop>>`/`<<return>>` compile to dedicated ops; the VM's raw-command dispatch for them is gone (set/declare/call stay).
- Escaping: tier-2 unescape of `# < > / \` at parse; `\{ \}` unescape in `interpolate` (expression suppression + literal compose); `\[ \] \\` in the markup parser; `\:` unescapes to a literal colon in speaker-less lines; speaker split is escape-aware.
- Program format: `ProgramNode.subtitle?`; `runLine`/`addOption` carry the parsed `markup` (composition rebuilds segments around substitutions at delivery). Testplan hashtags are parsed but no longer asserted (upstream's assertion is dead code — lexer quirk).
- Allowlist now: FormatFunctions (48), LineGroups/NodeGroups/NodeGroupsContentQuerying (47), Once (line-group selection, 47) — all running on the VM. VisitTracking's entry self-cleaned (subtitle keys made it pass).
