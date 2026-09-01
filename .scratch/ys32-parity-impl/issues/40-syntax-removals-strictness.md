# 40: Syntax removals & strictness

**What to build:** Yarn Spinner 3.2.2's language, minus the fork's extensions — scripts using the dropped syntaxes fail compilation with YS-coded diagnostics through the channel, and the remaining 3.2 syntax (line-level `<<if>>`/`<<once>>`/`<<once if>>`, `<<call>>`, compound assignment, `<<return>>`+detours, `<<wait>>`/`<<stop>>`, escapable `:`, `subtitle` header, `$`-prefix strictness) parses and compiles cleanly against the fixture corpus.

Scope: drop option-condition `[if expr]` suffix, inline `{if}{else}{endif}` blocks, `&css{}` (migration notes for all three); bare-variable diagnostic; `subtitle` + YS0032-style group-duplicate check.

**Blocked by:** 23 (diagnostics channel).

**Status:** ready-for-agent

- [ ] All 32 fixture `.yarn` files compile with expected diagnostics
- [ ] Dropped-syntax scripts produce YS diagnostics, not parser crashes
- [ ] Migration notes for the three removals in docs
- [ ] Full suite green
