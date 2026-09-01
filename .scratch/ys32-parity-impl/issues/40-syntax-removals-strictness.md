# 40: Syntax removals & strictness

**What to build:** Yarn Spinner 3.2.2's language, minus the fork's extensions — scripts using the dropped syntaxes fail compilation with YS-coded diagnostics through the channel, and the remaining 3.2 syntax (line-level `<<if>>`/`<<once>>`/`<<once if>>`, `<<call>>`, compound assignment, `<<return>>`+detours, `<<wait>>`/`<<stop>>`, escapable `:`, `subtitle` header, `$`-prefix strictness) parses and compiles cleanly against the fixture corpus.

Scope: drop option-condition `[if expr]` suffix, inline `{if}{else}{endif}` blocks, `&css{}` (migration notes for all three); bare-variable diagnostic; `subtitle` + YS0032-style group-duplicate check.

**Blocked by:** 23 (diagnostics channel).

**Status:** resolved

## Landing notes

- The three fork-era extensions are removed and rejected with YS0005
  diagnostics through the channel (not crashes): option-condition `[if expr]`
  suffix, inline `{if}{else}{endif}` blocks, `&css{}` (headers, lines, and
  options). Each message carries a pointer to `docs/migration-notes.md`.
- Upstream option-line `<<if expr>>` conditions are now parsed into
  `Option.condition` and filter at runtime; the expression-less `<<if>>`
  (upstream ParseFailures `OptionConditions-MustHaveExpressions`) fails with
  YS0005 — one MUST_FAIL_ALLOWLIST entry deleted. Smileys.yarn's plan run now
  passes on the extracted conditions — one PLAN_RUN_ALLOWLIST entry deleted;
  ShortcutOptions.yarn's citation updated (only `<<once>>`/`<<once if>>`
  options remain unsupported there).
- `$`-prefix strictness: `<<set>>`/`<<declare>>` targets must start with `$`;
  bare names yield YS0005 with a migration message.
- `subtitle` + the YS0032 group-duplicate check landed with ticket 23 and are
  covered by `src/tests/diagnostics.test.ts`; nothing further owed here.
- css plumbing removed end-to-end (AST, IR, compiler, runtime results,
  DialogueView, demo content). React adapter changes are removal-only; the
  full API migration stays with ticket 52.
- Docs: new `docs/migration-notes.md` (the three removals + `$` strictness);
  deleted `docs/css-attribute.md`; fixed flow-control/logic-and-variables/
  enums/typing-animation/README examples that taught the removed syntax.
  `docs/compatibility-checklist.md` left as-is — already marked superseded in
  CONTEXT.md, deletion owned by ticket 53.
- Acceptance: all ParseFailures/compile-clean fixture assertions green (102
  conformance cases), full suite green (157 tests), tsc + eslint clean.

- [ ] All 32 fixture `.yarn` files compile with expected diagnostics
- [ ] Dropped-syntax scripts produce YS diagnostics, not parser crashes
- [ ] Migration notes for the three removals in docs
- [ ] Full suite green
