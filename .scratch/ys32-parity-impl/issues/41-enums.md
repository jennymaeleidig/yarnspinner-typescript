# 41: Enums end-to-end

**What to build:** a 3.2 script using enums compiles and runs identically to upstream — uniform raw values, auto-numbering, `.Case` shorthand, same-enum `==`/`!=` restriction enforced at compile time — and hosts can register their own enum types from TypeScript, which flow through the external declarations path into compile-time checking and `userDefinedTypes` in the compile result.

**Blocked by:** 23 (diagnostics channel).

**Status:** resolved

## Landing notes

Landed on the impl branch in one commit (see git history for this effort).

- Enum semantics verified against upstream source (`TypeCheckerListener.cs`,
  `LiteralValueVisitor.cs`, `EnumTypeBuilder.cs`), not just the docs page:
  auto-numbering only when NO case has a raw value (0-based); if any case has
  one, ALL must — for numeric enums too; uniform raw value type; unique case
  names and raw values; integer-only number raws.
- Runtime representation is the case's RAW value (upstream contract);
  `program.enums` is now enum → case → raw value. The fork's old
  `"Enum.Case"` string storage and `resolveEnumValue`/`getEnumTypeForVariable`
  were removed (0.2.0 breaking wave). `.Case` shorthand resolves at compile
  time (rewrite to full member access) — recorded in ADR 0004.
- Compile-time checks: YS0035 (declaration errors), YS0037 (non-constant raw
  values), YS0038 (missing member), YS0050 (unknown type, cross-enum
  ==/!=, non-convertible enum arg), YS0014 (arity), YS0028 (ambiguous
  shorthand), YS0040 (type redeclaration).
- Host enums: `EnumTypeBuilder` (upstream mirror; throws on construction
  misuse like upstream's ArgumentExceptions) → `compileSource({ declarations
  : { enums, functions } })` → compile-time checking, runtime registry, and
  `userDefinedTypes`; `declarations` now carries `<<declare>>` metadata.
  Function signatures ride the same declarations path (quest stubs in the
  conformance harness).
- Lexer: full-line commands may carry trailing `// comments` (upstream
  lexer behavior; needed by the ParseFailures fixtures).
- Allowlists shrunk: 10 enum MUST_FAIL entries + Inference-MemberReferences
  MustBeUnambiguous + PLAN_RUN Enums.yarn all self-cleaned.
- New: `src/compile/enums.ts`, `src/compile/typeCheck.ts`,
  `src/tests/enums.test.ts` (35 tests), ADR 0004; docs/enums.md extended.
  Full suite green (193 tests).

- [x] Upstream enum fixtures compile and their plans run
- [x] Host-defined enums accepted and checked at compile time
- [x] Enum metadata appears in compile-output declarations
- [x] Full suite green
