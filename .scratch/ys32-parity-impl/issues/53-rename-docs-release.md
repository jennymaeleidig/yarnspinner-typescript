# 53: Dialogue rename + docs rewrite + 0.2.0

**What to build:** the 0.2.0 "3.2 parity" breaking wave — `YarnRunner` → `Dialogue` (and `useYarnRunner` → `useDialogue`) with a one-release deprecated alias (ticket 17 folded in), docs rewritten to reality (stale compatibility checklist replaced, ternary folklore claim deleted, removed extensions documented as migration notes, retired terms reconciled with shipped names), existing suite fully on the new public API, and release prep: re-check upstream for point releases >3.2.2 and record the targeted version in the release notes.

All breaking changes land together in this one release — no staged deprecation windows.

**Blocked by:** 52 (adapter migrated — rename touches every consumer last).

**Status:** resolved

- [x] Renamed exports with deprecated aliases; docs and glossary agree
- [x] Docs rewritten to reality; migration notes complete
- [x] Upstream version re-checked and recorded
- [x] Full suite green; package ready for 0.2.0

## Answer

Landed in: (this commit — the 0.2.0 release wave)

- **Renames (ticket 17)**: `src/react/useYarnRunner.tsx` →
  `useDialogue.tsx` (`useDialogue`, `UseDialogueOptions`,
  `UseDialogueResult`); deprecated exact aliases `useYarnRunner` + the
  `UseYarnRunner*` types kept for one release. `YarnRunner` const/type alias
  of `Dialogue` exported from `src/runtime/dialogue.ts` (also
  `YarnRunnerOptions`). New `src/tests/deprecatedAliases.test.ts` pins the
  alias contract (identity + interchangeable types + runtime equivalence).
  `DialogueView`, `index.ts`, the Next.js host comments, and
  `examples/react/` shim migrated; the shim also re-exports the alias.
- **Docs to reality**: `docs/compatibility-checklist.md` (stale ✅/❌ grid
  describing long-fixed gaps) replaced by `docs/compatibility.md` — parity
  statement, conformance-corpus contract, recorded divergences. README:
  ternary folklore example deleted (verified in-session: a ternary in
  `<<declare>>` parses without diagnostics but silently evaluates to
  nothing — upstream has no ternary; example now branches with `<<if>>`),
  bare-variable examples `$`-prefixed, `IRProgram` → `Program`, "AST → IR"
  → instruction-stream program, dead `css-attribute.md` link removed,
  missing docs links (line groups, saliency, shadow lines, migration
  notes, compatibility, changelog) added. `docs/markup.md` `TextResult`
  → `LineEvent`/`OptionsEvent`; `jumps.md`/`typing-animation.md`
  "runner" → `Dialogue`. CONTEXT.md overview now says `useDialogue()`;
  Retired terms records the one-release alias policy.
- **Migration notes complete**: new §5 — `YarnRunner` → `Dialogue`,
  `useYarnRunner` → `useDialogue`, with the alias-only-for-0.2.0 note.
- **Release prep**: upstream re-checked at release time — `v3.2.2` is
  still the newest tag (no 3.2.3/3.3.0; 3.3 announced, unshipped); targeted
  version recorded in the new `CHANGELOG.md` 0.2.0 section. Package
  version `0.1.5-c` → `0.2.0`.
- **Verification**: suite 461/461 (3 new alias tests), lint clean,
  `ts-check` clean, `demo:build` + `host:build` + `sveltekit:build` all
  green (CI parity, superseding the ticket-52 in-session note).

### Code review (two-axis) resolutions

- **@deprecated tags (fixed, both axes)**: the three type aliases
  (`YarnRunner`, `YarnRunnerOptions`, `UseYarnRunnerOptions`,
  `UseYarnRunnerResult`) now carry `@deprecated` JSDoc, so editor tooling
  strikes them — prose alone wouldn't.
- **Ternary mis-parse (fixed, standards §1/§7)**: recorded as a Known issues
  entry in `docs/compatibility.md` (not as a "deliberate divergence" — it's
  a tracked bug), pointing at the `<<if>>` branch pattern and
  `.scratch/future-work.md`.
- **markup.md mojibake (fixed)**: the U+FFFD in the source-citation line is
  an em dash again; added the adapter-side `DialogueViewResult` note while
  in the file.
- **Adapter `advance`/`onStoryEnd` names (kept, deliberate)**: these live in
  the React adapter's hook-result/component props — surface shipped by
  tickets 43/52 ("no adapter feature work"), not part of ticket 53's rename
  scope (`YarnRunner`→`Dialogue`, `useYarnRunner`→`useDialogue` only).
  Renaming adapter props needs its own adapter-resurfacing ticket with a
  glossary pass.
- **Alias-pattern duplication (kept, judgement call)**: the alias blocks
  are three one-liner pairs; extracting a shared "deprecated alias" helper
  would add machinery that dies next release anyway.
- **future-work ternary entry (kept)**: accepted scope note — recorded
  discovery, not behavior change.
