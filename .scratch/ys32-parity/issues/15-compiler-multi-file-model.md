# Compiler multi-file model

Type: grilling
Status: resolved
Blocked by: —

## Question

Graduated fog (unblocked by the localisation and diagnostics decisions). Upstream's compiler entry is a `CompilationJob`: a set of files, external `Declarations` (variables/functions/enums the host provides), a `Library`, and a `CompilationType` (FullCompilation / StringsOnly / DeclarationsOnly / type-check-only — StringsOnly already decided in [12](./12-localisation-scope.md)). The fork compiles a single document. Decide the TS compile API: does `compile()` accept multiple files/files-globs? Does it accept external declarations (and how do they interact with `<<declare>>` — upstream: external declarations vs script declarations)? Do the type-check-only and DeclarationsOnly modes earn their keep for a TS consumer? How does the Library (ticket 05) relate to the job (upstream allows both)? Inputs: [census §3](../research/ys322-census.md), [localisation mechanics](../research/localisation-mechanics.md), [diagnostics decision](./10-diagnostics-decision.md).

## Answer

All recommendations confirmed by the maintainer:

1. **`compile(files: CompileFile[])`** — array of `{ name, source }`; no globs/IO inside the library; the host reads files.
2. **External declarations API included** (variables/functions/enums known to the type checker without `.yarn` presence); in-script `<<declare>>` conflicts produce YS-table diagnostics.
3. **All four CompilationTypes included**: FullCompilation, StringsOnly (ticket 12), DeclarationsOnly, type-check-only (which also emits the string table, 3.2.2) — thin mode flags once type checking + declaration extraction exist.
4. **`Library` accepted in compile options for signature checking** (incl. variadic arity); runtime keeps its own instance — same type, two uses.
5. **Result shape mirrors upstream camelCased, minus Unity-only concerns**: `{ program, stringTable, declarations, diagnostics, fileTags, containsImplicitStringTags, userDefinedTypes }`, with `program` the versioned JSON (ticket 14).
