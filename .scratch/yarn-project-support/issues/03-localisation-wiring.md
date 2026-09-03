# 03: Localisation wiring — project map to text provider

**What to build:** the project's `localisation` map drives localised play
end-to-end: from a loaded project, each declared locale's strings CSV (the
upstream 8-column interchange format) resolves through the existing
string-table/strings-file surface (tickets 50/51) into a text provider, and a
`Dialogue` running with that provider emits lines in the chosen locale, with
language switching working per the runtime's language surface. The project's
`assets` directories are surfaced to the host as configured paths — the
library never loads assets. Missing strings files were already diagnosed by
the loader's validation (ticket 02); this ticket owns the happy path and the
provider glue.

**Blocked by:** 02 (loader core — the validated `localisation` map)

Type: task

**Status:** resolved

- [x] `localisation` map → per-locale CSV string tables via the existing
      strings-file surface
- [x] Provider glue: a project-configured text provider runs `Dialogue` in a
      non-base locale; language switching works
- [x] `assets` directories surfaced as configured paths, not loaded
- [x] Suite green: tests drive `Dialogue` events in a translated locale
      (ticket 51's CSV provider tests are the prior art)

## Landing notes (ticket 03)

- **Core**: `src/compile/projectLocalisation.ts` — pure (§2):
  `loadLocalisations({ project, stringTable }, fileSystem)` resolves the
  project's `localisation` map (read each declared locale's strings CSV
  through the injected file system, `parseCSV` + `csvEntriesToTable` filtered
  to the declaring locale) and `createProjectTextProvider(localisation)` glues
  the tables into a `StringTableTextProvider` (base table = the compile
  result's string table minus shadow lines; one translation table per
  declared locale). Works on both `loadProject` and `loadYarnProject` results;
  both exported from the main entry.
- **Assets surfaced, never loaded**: `localisation.assets` is a verbatim
  language → configured-path map (spec story 15); a nonexistent assets path
  is not an error. Every declared locale appears in `translations` — an
  assets-only locale or an unreadable strings file yields an empty table, so
  playback falls back to the base language (the read-time counterpart of
  ticket 02's YP0006 validation warning; the read failure reuses YP0006,
  warning severity, locale dropped, compile unaffected).
- **Language switching** stays on the runtime surface: the provider starts in
  the base language; `Dialogue.setLanguage(lang | null)` swaps locales
  mid-conversation. `areLinesAvailable` checks the active table directly (no
  fallback) per the ticket-51 Rust-reference contract — a partially
  translated locale reports unavailable lines even though playback falls
  back.
- **Tests**: 14 in `src/tests/projectLocalisation.test.ts` — per-locale table
  resolution, locale filtering + empty-id skip, base-language-as-locale,
  missing-at-read-time YP0006, assets surfacing (including a locale with
  assets only and a nonexistent path), failed-load shape, shadow-line
  exclusion from the base table, and the acceptance path: `Dialogue` events
  in German through the project-configured provider (translated line with a
  live substitution, translated option text, empty-row base fallback,
  `setLanguage` switching, availability signal), plus a Node tmpdir
  end-to-end against real files. Suite 444/444, lint clean.
- **Docs**: README loader section (the two new functions), CONTEXT.md
  YarnProject entry (localisation resolution + assets-not-loaded), and the
  `YarnProject` interface comments that deferred to this ticket.
