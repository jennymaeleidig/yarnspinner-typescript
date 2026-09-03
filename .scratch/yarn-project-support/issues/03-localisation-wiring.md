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

**Status:** ready-for-agent

- [ ] `localisation` map → per-locale CSV string tables via the existing
      strings-file surface
- [ ] Provider glue: a project-configured text provider runs `Dialogue` in a
      non-base locale; language switching works
- [ ] `assets` directories surfaced as configured paths, not loaded
- [ ] Suite green: tests drive `Dialogue` events in a translated locale
      (ticket 51's CSV provider tests are the prior art)
