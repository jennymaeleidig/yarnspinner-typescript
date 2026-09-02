# 44: Instruction-stream program format (prefactor)

**What to build:** the compiler emits a TS-idiomatic instruction-stream stack-VM program — versioned JSON with `languageVersion`, expressions compiled to bytecode (the string evaluator becomes expression codegen), jumps as instruction indices with labels resolved in a compiler pass — verified by golden assertions over the emitted program, while the existing tree-IR runtime keeps working unchanged.

Prefactor/expand for the VM swap (tickets 45–46): make the change easy, then make the easy change.

**Blocked by:** 43 (suite ported once, so this stays internal).

**Status:** resolved

- [x] Versioned JSON program emitted with languageVersion field
- [x] Expressions compile to bytecode; jumps are resolved instruction indices
- [x] Golden assertions over emitted programs
- [x] Full suite green on the unchanged tree-IR runtime

## Comments

**Resolution (ticket 44).** The compiler now emits the instruction-stream program alongside the tree IR:

- `src/compile/program.ts` — the format: versioned JSON (`programLanguageVersion = 1`, ADR 0003) with `Program`/`ProgramNode`/`ProgramNodeGroup`/`Instruction`. Op names mirror upstream instruction concepts in camelCase (coding standards §5): `runLine`, `runCommand`, `addOption`/`showOptions`, `pushString`/`pushNumber`/`pushBool`/`pushNull`, `pushVariable`/`popVariable`, `callFunction`, `jumpTo`/`jumpIfFalse`/`jumpIfTrue`, `runNode`/`detour`/`return`/`stop`, and the arithmetic/comparison/logic ops. Lines and commands keep authored text (the runtime line parser owns substitutions/markup, per the spec's runtime split); only conditions and assignments compile to bytecode.
- `src/compile/expressionCodegen.ts` — expression codegen: recursive-descent parser with upstream's operator layering (or → and → equality → relational → additive → multiplicative → unary → primary) and the upstream word aliases; enum member access folds to the case's raw value at compile time (ADR 0004); `$name` and bare identifiers read as variables.
- `src/compile/emit.ts` — the lowering pass, tree IR → `Program`. Labels are resolved to intra-node instruction indices here (jump/option-destination references are patched at the end of each node's lowering); no label fields survive in the artifact. Option groups lower to condition-guarded `addOption`s, one `showOptions`, and inline bodies each ending in a `jumpTo` past the construct — selection runs the body then resumes after the options block, and the no-option-selected fall-through is the pc after `showOptions`; nested groups work because `showOptions` delivers and clears the accumulated set. `<<once>>` lowers to generated-variable reads/writes using the shared key contract in `src/runtime/generatedVariables.ts` (extracted from dialogue.ts; no behavior change). `<<declare>>` compiles to no instruction — initializers live in `initialValues` as bytecode (upstream); smart variables compile in `smartVariables`. Node groups and `when`/`scene`/`tracking` headers carry over verbatim (`when` stays evaluator strings until ticket 47 compiles saliency).
- `src/compile/compileSource.ts` — the compile seam returns the new artifact as `bytecode: Program | null` next to the tree-IR `program`; `src/index.ts` exports the format types. The current `Dialogue` is untouched apart from the key-contract extraction; nothing consumes the bytecode until ticket 45.
- `src/tests/bytecode.test.ts` — golden assertions through the public seam: exact deep-equal programs for state statements, if/elseif/else, options (incl. nested groups), once, node groups/headers; expression-coverage cases (precedence, aliases, enum folding, callFunction); per-op field whitelists plus in-range index checks over a kitchen-sink program; and codegen-failure fallbacks pinned (`pushBool false` for uncompilable conditions — the evaluator's catch→false; raw `runCommand` for uncompilable sets; `pushNull` for uncompilable smart initializers).

**Decision note for tickets 45–46 (deliberate, per coding standards §1):** the codegen parser implements upstream's precedence layering, which differs from the string evaluator's dispatch-order quirks — the evaluator's comparison split swallows logical operators to its right (e.g. `$a == 1 && $b == 2` evaluates false there) and its `&&`/`||` fold flat at one level. The upstream conformance corpus passes under both (its compound conditions were authored for upstream's compiler), so no pinned expectation flips today; the VM tickets inherit the codegen's upstream-faithful semantics and should reconcile any stray evaluator-dependent expectation deliberately if one surfaces. The runtime `ExpressionEvaluator` is unchanged — the tree-IR runtime's behavior is bit-identical.

Full suite: 239/239 green (14 new golden tests + the existing suite incl. the vendored upstream corpus), on the unchanged tree-IR runtime.
