# Instruction-stream VM over the tree IR

The fork compiled `.yarn` to a custom tree-shaped IR whose conditions were re-evaluated from strings at runtime. Every upstream-conformance feature we adopted (saliency candidates, opt-in line hints, visit tracking on node return, detour return stacks, once-state as generated variables) assumes VM machinery a tree IR can only fake. We decided the compiler emits a TS-idiomatic instruction-stream stack VM program with upstream-equivalent observable semantics, and the tree IR retires (the AST remains the front-end representation). We rejected bug-for-bug opcode mirroring because compiled-artifact compatibility with upstream's protobuf `Program` is explicitly out of scope — the conformance contract is behavior (the event stream), not bytecode.

## Considered options

- **Bug-for-bug mirror of upstream's instruction stream** — buys nothing without artifact compatibility, and drags protobuf shape into the codebase.
- **Extend the tree IR** — would fake every VM feature the parity decisions assumed; the outlier design among all three implementations.

## Consequences

Expressions compile to bytecode (the string evaluator becomes the compiler's expression codegen); jumps are instruction indices with labels resolved in a compiler pass.
