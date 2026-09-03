# 49: Multi-file compile + external declarations + four modes

**What to build:** hosts compile collections of files — `compile(files)` with `{name, source}` entries, no globs or filesystem I/O in the library — with an external declarations API (variables/functions/enums; conflicts produce YS diagnostics), all four compilation modes (full, strings-only, declarations-only, type-check-only which also emits the string table), a compile-time Library for signature checking, and the upstream camelCased result shape. Exercised by the upstream `Projects/Basic` and `Space` projects (`.ysls` included) and the vendored `Duplicates/` fixtures.

**Blocked by:** 41 (host-defined enums feed the declarations path), 46 (program format settled).

**Status:** resolved

## Landing notes

- [x] Upstream multi-file projects compile and their plans run
- [x] All four modes observable at the compile seam
- [x] Declaration conflicts produce YS diagnostics
- [x] Full suite green (362/362, up from 340)

## Implementation notes (ticket 49)

- **`compile(files, opts)` is the public seam** (`src/compile/compileSource.ts`):
  `{name, source}` entries, no I/O (§2). `compileSource(source, opts)` stays
  as the single-file convenience wrapper from ticket 23 (same CompileResult).
  The AST-level compiler entry is renamed `compileDocument` (its old name
  `compile` collided with the new seam).
- **Result shape** mirrors upstream `CompilationResult` camelCased:
  `{ program, stringTable, declarations, diagnostics, fileTags,
  containsImplicitStringTags, userDefinedTypes }`. Upstream fields kept out
  of scope (LSP-oriented): `ProjectDebugInfo`, `ParseResults`, `NodeMetadata`.
- **Modes** verified against upstream `Compiler.Compile` (not the docs):
  `stringsOnly` stops after string-table registration (no program, no
  declarations, **no fileTags**, containsImplicitStringTags computed);
  `typeCheckOnly` returns declarations + userDefinedTypes + fileTags **and
  the string table** (upstream 3.2.1+ behavior) with
  `containsImplicitStringTags` hardcoded false; `declarationsOnly` is the
  obsolete upstream alias (3.2 renamed the enum member). Node-structure and
  jump validation run in every mode (upstream validates before the
  StringsOnly stop).
- **String table** (`src/compile/stringTable.ts`): upstream `StringInfo`
  shape (text/nodeName/lineNumber/fileName/isImplicitTag/metadata/
  shadowLineID) + `containsImplicitStringTags` (shadow entries excluded,
  per upstream). IDs are assigned in one pass over all files **in the
  compiler's lowering order** (nodes grouped by title via the shared
  `groupNodesByTitle`, option tags before option bodies, mirroring
  `lowerOptions`) and written back into the AST so the program and the
  table always agree — the golden bytecode tag assertions pin this. YS0018
  fires here for duplicate explicit `#line:` tags: DuplicateLineTags.yarn
  self-cleaned from MUST_FAIL_ALLOWLIST.
- **Deliberate divergences / boundaries:**
  - Implicit line IDs remain the fork's per-compile counter, and shadow
    entries keep their text (no YS0042/43/44, no text-nulling): that is
    ticket 50's CRC32 + shadow-validation scope, and the Duplicates/ lipsum
    fixtures (2 MB each, implicit-tag collision tagging) are ticket 50/51
    fixtures — not vendored here.
  - Upstream nulls `Program` on error diagnostics; this fork still returns
    the lowered program alongside the diagnostics (collect-don't-throw, §3;
    several bytecode golden tests assert lowering fallbacks under type
    errors). Recorded here as the deliberate choice; revisit if a ticket
    needs upstream's null-on-error.
  - Compile-time `Library` signatures are host-supplied
    (`registerFunction(name, fn, signature?)` — plain TS functions carry no
    reflection), not derived from the callable; without a signature a
    function is unchecked at compile time, exactly like today's
    `declarations.functions` path. `declarations.functions` entries take
    precedence over library signatures (upstream: first registration wins).
  - File tags: `#tag` lines preceding a file's first node (upstream
    `file_hashtag`); multiple tags per line split on whitespace.
- **External variables** join `ExternalDeclarations` (upstream variable
  `Declaration`s in the job): they seed the type checker (enum-typed
  assignment checks get YS0050 for free) and appear in the result's
  declarations. Conflicts: in-script `<<declare>>` vs external or vs any
  earlier in-script declaration → YS0039 (both occurrences when the
  original file is known, per upstream ExitDeclare_statement). YS0040 enum
  redeclaration now works across files via the combined document.
- **New/changed files:** `src/compile/stringTable.ts` (new),
  `src/compile/compileSource.ts` (rewritten), `src/compile/compiler.ts`
  (rename + shared grouping), `src/compile/typeCheck.ts` (external
  variables, YS0039, file attribution, signature types moved to
  `runtime/library.ts`), `src/parse/parser.ts` (file hashtags, line
  numbers on Line/Option), `src/model/ast.ts` (+`sourceFile`,
  `lineNumber`, `fileTags`), `src/runtime/library.ts` (signatures),
  `src/tests/multiFileCompile.test.ts` (new, 21 tests).
- CONTEXT.md: Compilation result / Compilation mode refreshed, `File tags`
  added, Library entry notes compile-time signatures.

## Comments

### Code review (two-axis, post-implementation)

Standards: 5 met / 2 hard / 5 judgement smells. Spec: no missing requirements,
no scope creep, 2 partials, 2 nits. All hard findings addressed before commit:

- **§7 stale README (hard)**: README still documented the old
  `compile(doc): IRProgram` signature. Fixed: `compileDocument` /
  `compile(files)` / `compileSource` documented; examples updated.
- **CONTEXT.md corruption (hard)**: the External declaration / Diagnostic
  glossary bullets had been fused onto one line. Fixed.
- **YS0039 same-file both-occurrences (spec partial)**: the second
  diagnostic now emits whenever the original occurrence's file is known
  (upstream `ExitDeclare_statement`), not only cross-file; test upgraded to
  assert 2 diagnostics in both cases.
- **YS0040 cross-file claim untested (spec partial)**: added a test
  (`<<enum Fish>>` redeclared across files → YS0040).
- **Smells**: `registerLine` data clump bundled into one `entry` object and
  the dead `isImplicit`/`void isImplicit` channel removed; the duplicated
  YS0039 emit arms merged; fused import line in compileSource.ts split;
  files that fail to parse now still get a `fileTags` key (empty array).
- Pre-existing (not this ticket, left alone): unused-vars lint errors in
  `src/markup/lineParser.ts` / `src/runtime/interpolate.ts`; the
  `.scratch/` bookkeeping edits in the working tree are the human's.
