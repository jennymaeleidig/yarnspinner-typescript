# IR/VM redesign decision

Type: grilling
Status: resolved
Blocked by: —

## Question

The fork's compiler emits a custom tree-shaped IR re-evaluated by string conditions at runtime; both official implementations (and the Rust port) use an instruction-stream VM. The runtime API decision ([05](./05-runtime-api-shape.md)) locked the pull-based `DialogueEvent[]` contract; the conformance harness (TestBase event-stream step-lock) and the census's VM details (saliency-candidate ops, visit tracking on node return, generated once-variables, smart variables at access time) all assume VM-ish machinery. Decide: does the TS compiler adopt an instruction-stream VM (upstream opcode shape, or a TS-idiomatic equivalent), or does the tree IR get extended to carry the same semantics (saliency candidates, line hints, generated variables)? Decide the jump/label model, how `PrepareForLines` lookahead is computed, and how detour/return interacts. Inputs: [repo audit](../research/repo-audit.md) (Architecture), [census §4](../research/ys322-census.md), [Rust study](../research/rust-reference-study.md) (kept the instruction-stream VM; prost-generated Program), [localisation mechanics](../research/localisation-mechanics.md) (text resolution split).

## Answer

All recommendations confirmed by the maintainer:

1. **TS-idiomatic instruction-stream stack VM** (option b) — upstream-equivalent observable semantics, own opcode design; tree IR **retires** (AST remains the compiler front-end); chosen over bug-for-bug mirroring (artifact compat out of scope) and over extending the tree IR (would fake every VM feature decisions 04–13 assumed).
2. **Expressions compile to bytecode** — the string-based evaluator becomes the compiler's expression codegen; smart variables, enum comparisons, and type diagnostics all land here.
3. **Program format: versioned JSON** with a `languageVersion` field (mirroring upstream 3.1's addition); documented schema, not protobuf.
4. **Jumps = instruction indices**, labels resolved in a compiler pass.
5. **VM machinery as decided elsewhere**: per-node line-ID table → opt-in `LineHints`; saliency candidates via dedicated VM ops (`AddSaliencyCandidateFromNode` equivalent); detour/return = call stack of return addresses, jump-inside-detour clears it; tracking/once/saliency state = generated variables in VariableStorage.
