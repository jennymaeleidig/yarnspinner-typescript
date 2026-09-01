# 53: Dialogue rename + docs rewrite + 0.2.0

**What to build:** the 0.2.0 "3.2 parity" breaking wave — `YarnRunner` → `Dialogue` (and `useYarnRunner` → `useDialogue`) with a one-release deprecated alias (ticket 17 folded in), docs rewritten to reality (stale compatibility checklist replaced, ternary folklore claim deleted, removed extensions documented as migration notes, retired terms reconciled with shipped names), existing suite fully on the new public API, and release prep: re-check upstream for point releases >3.2.2 and record the targeted version in the release notes.

All breaking changes land together in this one release — no staged deprecation windows.

**Blocked by:** 52 (adapter migrated — rename touches every consumer last).

**Status:** ready-for-agent

- [ ] Renamed exports with deprecated aliases; docs and glossary agree
- [ ] Docs rewritten to reality; migration notes complete
- [ ] Upstream version re-checked and recorded
- [ ] Full suite green; package ready for 0.2.0
