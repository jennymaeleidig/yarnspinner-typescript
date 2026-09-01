# 44: Instruction-stream program format (prefactor)

**What to build:** the compiler emits a TS-idiomatic instruction-stream stack-VM program — versioned JSON with `languageVersion`, expressions compiled to bytecode (the string evaluator becomes expression codegen), jumps as instruction indices with labels resolved in a compiler pass — verified by golden assertions over the emitted program, while the existing tree-IR runtime keeps working unchanged.

Prefactor/expand for the VM swap (tickets 45–46): make the change easy, then make the easy change.

**Blocked by:** 43 (suite ported once, so this stays internal).

**Status:** ready-for-agent

- [ ] Versioned JSON program emitted with languageVersion field
- [ ] Expressions compile to bytecode; jumps are resolved instruction indices
- [ ] Golden assertions over emitted programs
- [ ] Full suite green on the unchanged tree-IR runtime
