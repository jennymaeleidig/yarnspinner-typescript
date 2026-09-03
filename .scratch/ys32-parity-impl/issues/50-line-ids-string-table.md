# 50: Line IDs + string table

**What to build:** the compile output carries the upstream string-table contract — implicit line IDs via CRC32(file+node+count) replacing the fork's global counter, explicit `#line:` verbatim, `#shadow:` compile-time validation (YS0042/43/44), shadow lines in the table, hashtag metadata attached — observable at the compile seam.

**Blocked by:** 49 (multi-file model defines file+node identity).

**Status:** resolved

- [x] String table matches upstream shape for the fixture corpus
- [x] Implicit IDs CRC32-based; `#shadow:` validation asserts YS0042/43/44
- [x] Full suite green (376/376, up from 362)

## Landing notes (ticket 50)

- **Implicit IDs are upstream's scheme** (`src/compile/crc32.ts`, new):
  `line:` + CRC32 over UTF-8 bytes of `fileName + nodeName + tableCount`
  formatted as **little-endian lowercase hex** (upstream C# `BitConverter`
  byte order — not conventional big-endian CRC hex), with a numeric suffix
  retried on collision; past upstream's 1000-attempt cap the manager
  reports YS0041 and keeps retrying (upstream throws its internal
  `DialogueException`; demoted per §3 so nothing ungated crosses the
  compile seam). Shadow lines get the `sh_` prefix. The `sh_` ID is
  written back into the AST like any implicit ID, so a shadow line's
  `runLine` carries its own ID — this also fixes the ticket-49
  program/table mismatch for shadow lines.
- **Registration order switched to upstream's**: files in input order,
  nodes in document order, statements depth-first (an option's line before
  its body). Ticket 49 used the compiler's *lowering* order (grouped by
  title) because agreement relied on matching orders; with write-back the
  program reuses whatever the table assigned, so the pass now reproduces
  upstream IDs exactly (the seed's table-wide count depends on order).
  `groupNodesByTitle` moved into `compiler.ts` — it is the lowering's
  grouping, no longer the string-table pass's.
- **Metadata is upstream's: the authored hashtag texts verbatim** —
  including an authored `#line:` tag (upstream `GetHashtagTexts` has no
  filter; the StringInfo XML doc claiming "besides the #line: hashtag" is
  contradicted by its own source, and §1 says source wins). Ticket 49's
  line:-filtering is dropped; its shape test updated. Plus the auto-added
  `lastline` metadata for the line immediately before an options block
  (upstream `LastLineBeforeOptionsVisitor`: direct adjacency in the same
  statement list, recursed into if-bodies and option bodies, **not** into
  `<<once>>` blocks — no once case upstream; always added, even over an
  authored `#lastline`). The fork-era program-level `lastline` tag in
  `lowerOptions` is untouched (separate channel, golden-pinned).
- **`#shadow:` resolves with the `line:` prefix prepended** — authors write
  the target without it (upstream `Substring("shadow:".Length)` + prefix);
  ticket 49 stored the raw suffix. Validation runs after all files register,
  before every mode stop (upstream runs it before the StringsOnly return):
  YS0042 unknown source → `continue` (text NOT stripped); YS0043 source has
  inline `{expr}` (escape-aware scan mirroring the runtime's expansion
  rules — the fork keeps raw text in the table, upstream stores
  placeholders, so the scan stands in for its parsed-expression check);
  YS0044 text differs; both fire without preventing the strip (upstream has
  no `continue` between them). Text strips to `null` in every 43/44 case.
- **YS0017/YS0062 multi-tag guards** (new to the registry, vendored
  definitions existed): >1 content-ID tag registers nothing — YS0017 per
  (line, shadow) pair, YS0062 per offending tag. Lines that bail keep no
  table entry (upstream bails too); the lowering's counter fallback still
  gives their `runLine` a stable ID so the program lowers.
- **YS0018 now reports both occurrences** (upstream `DuplicateLineID` on
  the duplicate and the original) and the duplicate no longer overwrites
  the first entry (upstream bails before registering). Ticket 49's test
  pinned one diagnostic; updated. The second diagnostic attributes to the
  original's file (upstream passes the *current* file with the original's
  context — read as an upstream slip; consistent with the YS0039
  both-occurrences shape ticket 49 landed).
- **Chained shadows** (a shadow of a shadow) hit the already-stripped
  source text: upstream throws an internal `InvalidOperationException`; the
  fork emits YS0041 with upstream's message text (which interpolates the
  referenced ID in both slots — verbatim) and leaves the entry untouched
  (collect-don't-throw, §3).
- **`containsImplicitStringTags` unchanged**: shadow-only implicit IDs
  don't count (upstream rule, already in ticket 49's shape).
- **Conformance**: the three `ShadowLines-Must*.yarn` fixtures self-cleaned
  from MUST_FAIL_ALLOWLIST — each now fails with exactly its upstream code
  (YS0044/YS0042/YS0043 verified per fixture); `ShadowLines.yarn` (clean
  fixture + plan) still compiles and runs.
- **New/changed files**: `src/compile/crc32.ts` (new; adapted from upstream
  `CRC32.cs`, MIT — citation block + root `CITATION.cff` added),
  `src/compile/stringTable.ts` (rewritten registration + validation),
  `src/compile/compiler.ts` (groupNodesByTitle moved in; ensureLineId is
  now the bail-line fallback), `src/compile/compileSource.ts` (manager
  wiring + docs), `src/compile/diagnostics.ts` (+5 codes),
  `eslint.config.cjs` (+TextEncoder global). Tests: `src/tests/lineIds.test.ts`
  (new, 14 — ID literals asserted against an in-test `zlib.crc32`
  recomputation, an implementation independent of this repo's), goldens
  re-pinned, ticket-49 tests updated, allowlist self-clean.
- CONTEXT.md: Shadow line glossary entry corrected (shadow lines do have a
  table entry — null text).

## Comments

### Code review (two-axis, post-implementation)

Spec: 9 met / 0 partial / 0 missing, no unrecorded scope creep. Standards:
2 hard findings, both addressed:

- **§3 ungated throw (hard)**: the manager's collision-exhaustion path
  threw past the public API regardless of strict mode. Fixed: the manager
  takes an optional `emit` (compileSource wires the diagnostics channel);
  past upstream's 1000-attempt cap it reports YS0041 once and keeps
  retrying — no throw crosses the seam.
- **§7 unverified claim (hard)**: the test header claimed a zlib
  cross-check that wasn't in the artifact. Fixed: lineIds.test.ts now
  recomputes the scheme in-test via `node:zlib`'s `crc32` and asserts the
  pinned literals equal it.
- Judgement calls left as-is, each mirroring upstream structure: the
  flag-lastline pre-pass is a second walker (upstream also has two:
  LastLineBeforeOptionsVisitor + the registration visitor); the YS0041
  chained-shadow message interpolates the referenced ID in both slots
  (upstream's literal text, §1); the lowering's counter fallback serves
  only YS0017/62 bail lines (commented, revisited if conformance needs it).
- Incident: a `git reset --hard HEAD` hit the shared working tree during
  the review round (visible in reflog; not the reviewers' intent — they
  were read-only briefs) and reverted all tracked working-tree changes.
  Untracked new files survived; everything was re-applied and re-verified
  (ts-check, lint, 376/376) before this commit. Committed promptly after
  to close the sweep window.
