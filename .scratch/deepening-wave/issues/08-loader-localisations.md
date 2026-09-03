# 08: Localisation folded into loadProject

**What to build:** collapse the four-call dance —
`loadYarnProject(path)` → `loadLocalisations(result, fs)` (re-passing the
same fs and result) → `createProjectTextProvider(localisation)` →
`new Dialogue(program, {textProvider})` — into the loader.

Files: `src/compile/yarnProject.ts`, `src/compile/projectLocalisation.ts`,
tests `src/tests/projectLocalisation.test.ts` (375 ln, re-performs the
dance at ~7 sites).

**Decisions (binding):**
- **Always-on, no flag** (Q8): when the project declares locales,
  `loadProject` resolves localisations itself; the result gains
  `textProvider` + `assets` unconditionally. No opt-in flag with a union
  return, no sibling function — both widen the interface to avoid work the
  loader should just do. The tests show the default path IS the common
  path.
- **`ProjectLocalisation` stays exported** as the documented escape hatch
  for custom `TextProvider`s; a host that wants one ignores
  `result.textProvider`. `createProjectTextProvider` is a pass-through
  (deletion test) — it folds into the loader, unless the hatch needs it
  (record the call).
- **YP0006 gets one emission site** — today the missing-strings check fires
  twice (`resolveSources` "not found" / `loadLocalisations` "could not be
  read") with two wordings to keep in sync.
- The base table stops being re-derived by hand from `stringTable` minus
  shadow lines — reuse `stringTableToEntries`' export contract.
- Read-time failure behaviour is unchanged: YP0006 warning, drop that
  locale, base-language compile unaffected.
- `nodeProjectFs` is untouched — it is the positive control (a real seam,
  two adapters: Node + in-memory test fs).
- This is the wave's only freely parallel lane (no shared files).

**Blocked by:** None

Type: task

**Status:** open

- [ ] `LoadProjectResult` gains `textProvider` + `assets`; localisations
      resolved unconditionally for declared locales
- [ ] `createProjectTextProvider` folded or explicitly kept for the hatch
      (recorded); `ProjectLocalisation` still public
- [ ] YP0006: one emission site, one wording
- [ ] Host examples + tests updated; no per-test dance left
- [ ] README loader section updated; suite green, lint clean
