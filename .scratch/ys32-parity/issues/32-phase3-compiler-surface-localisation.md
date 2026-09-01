# 32 — Phase 3: compiler surface & localisation

Type: task
Status: superseded (see below)
Blocked by: 31

## Goal (spec phase 3)

Compiler multi-file surface and the localisation layer (wayfinding tickets 15, 11, 12).

## Scope (spec Implementation Decisions)

- `compile(files: CompileFile[])` — `{name, source}` entries, no globs/IO in-library;
  exercised by upstream `Tests/Projects/Basic` and `Space` (`.ysls` included) and the
  `Duplicates/` fixtures (vendored in ticket 20, deferred).
- External declarations API (variables/functions/enums; conflicts → YS diagnostics).
- Four compilation modes: full, strings-only, declarations-only, type-check-only
  (emits string table); Library accepted at compile time for signature checking.
- Result shape `{program, stringTable, declarations, diagnostics, fileTags,
  containsImplicitStringTags, userDefinedTypes}`.
- Localisation: CRC32 implicit line IDs (replacing global counter), `#line:` verbatim,
  `#shadow:` validation (YS0042/43/44), string table as compile output.
- CSV module (8-column format, SHA-256 locks, hashtag-metadata comments) +
  strings-only mode; line-tag generator seam with Random/Descriptive built-ins;
  `tagLines(source, { generator })` utility; CSV-backed `setLanguage` provider
  over the text-provider seam.
- No `.yarnproject` equivalent (out of scope per spec).

## Superseded

Replaced by the vertical-slice decomposition: tickets 40–53. See the slice mapping:
30→40+41+42, 31→43+44+45+46+47+48, 32→49+50+51, 33→52+53.
