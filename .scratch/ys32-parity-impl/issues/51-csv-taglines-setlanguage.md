# 51: CSV module + tagLines + setLanguage

**What to build:** hosts can localise — read and write upstream 8-column CSV strings files (`language,id,text,file,node,lineNumber,lock,comment`; `lock` = first 8 hex SHA-256 of base text; `comment` = hashtag metadata), generate line tags via a pluggable seam with Random (default) and Descriptive built-ins and the `tagLines(source, {generator})` utility, and switch runtime language with a CSV-backed provider over the injectable text-provider seam (`setLanguage`). No `.yarnproject` equivalent.

**Blocked by:** 50 (string table + line IDs are the CSV keys).

**Status:** resolved

- [x] Ported inline CSV tests green (no fixture coverage — inventory fact)
- [x] tagLines round-trips with both built-in generators
- [x] setLanguage swaps rendered text from a CSV strings file
- [x] Full suite green (409/409, up from 376)

## Landing notes (ticket 51)

- **CSV module** (`src/compile/stringsFile.ts`, new): the upstream 8-column
  interchange contract, ported from YarnSpinner-Unity (CITATION.cff updated):
  `StringTableEntry` shape + `parseCSV`/`createCSV` (RFC 4180 quoting, CRLF
  records, named-column lookup with TryGetField's missing-field defaults),
  `stringTableToEntries` (upstream `YarnProjectImporter.GetStringTableEntries`:
  shadow entries with `text === null` excluded, `lock` = first 8 lowercase hex
  of SHA-256 of the base text, `comment` = `GenerateCommentWithLineMetadata` —
  `Line metadata: ` + hashtags joined by spaces with `line:`-prefixed entries
  removed, empty string when nothing remains), and `csvEntriesToTable` (the
  id → text shape the text-provider seam consumes; empty translations skipped
  so missing lines fall back to base). Lock vectors are cross-checked in-test
  against `node:crypto` SHA-256 (an implementation independent of the
  repo's). The hash itself is `src/compile/sha256.ts` (new) — a pure-TS
  FIPS 180-4 implementation, keeping the package browser-safe (§2: no
  `node:crypto` in library code). No I/O anywhere: hosts read/write the
  files. No `.yarnproject` equivalent, per scope.
- **tagLines** (`src/compile/tagLines.ts`, new): a port of upstream
  `Utility.TagLines` + `ILineTagGenerator` — `tagLines(source, {generator,
  excludedLineIDs, tagAbortBehaviour, fileName})` returns
  `{modifiedSource, lineIds, tagExceptions}` (upstream's tuple as data;
  §3). Lines, line-group items, and shortcut options lacking a `#line:`/
  `#shadow:` tag get one appended (` #tag ` after the line's content,
  trailing whitespace preserved); a parse error returns the source unchanged
  (upstream bails before tagging); the returned `lineIds` is the known-ID
  set the run accumulated — excluded IDs plus generated IDs (upstream's
  `KnownLineIDs`: pre-existing tags flow to the generator via
  `PrepareForLines` but never into this set — verified against Utility.cs). Generator failures are data: upstream's
  `LineTaggingException` and internal `InvalidOperationException` guards
  (empty/duplicate/`line:`-prefixed violations) all demote to returned
  exceptions carrying upstream's message texts, with ` // ERROR: …` comments
  left at the offending line and the `TagAbortBehaviour` honored
  (`currentNode` default — the failed node's tags are discarded;
  `currentLine`; `entireTagging` — no tags apply anywhere). Read as a
  deliberate demotion: upstream lets the non-`LineTaggingException` guards
  escape `TagLines` as raw exceptions. Two throw paths remain, mirroring
  upstream: an unexpected (non-`ParseError`) error from the parser rethrows
  (a bug, not a problem report), and the generator objects themselves throw
  `LineTaggingError` when called outside their contract (skipped
  `prepareForLines`, out-of-range index) — upstream's generators throw
  `LineTaggingException` identically; the `tagLines()` pipeline converts
  every tagging failure inside it to data.
- **Random generator** (the default): `line:` + 7 lowercase hex of a value
  below 0x1000000 (upstream `{0:x7}`), collision-checked against excluded +
  existing + generated IDs. **Recorded divergence (§2)**: upstream aborts on
  a 500 ms stopwatch — the library reads no clocks — so the same exception
  ("Unable to tag the line due to running out of time.") fires after a
  1000-attempt cap instead.
- **Descriptive generator**: a faithful port of upstream's
  `DescriptiveLineTagGenerator` — `line:<node>_<NNNN>` (4-digit, 100-step
  indices; midpoint insertions `diff/(insertions+1)` rounded to 5s;
  dense-packing fallback that forces `_gN` generations via the
  generations map; descending existing tags raise the upstream message,
  preceeding-dialogue typo verbatim; the speaker's character name appended
  from the line's parsed `character` markup attribute). The node key is the
  **unique title** (upstream `TryGetNodeTitle`/`GetNodeUniqueName`): the
  plain title, `Title.Subtitle` for subtitle-carrying node-group members,
  else `Title.<crc32(fileName + title + startLine)>`. This needed the node's
  first source line — `YarnNode.startLine` (new, parser-set from the first
  header token; upstream `nodeContext.Start.Line`). The RoundFactor quirk
  (a new line between 0 and 12 getting 10) is upstream's, kept.
- **Text-provider seam + setLanguage** (`src/runtime/textProvider.ts`, new):
  `TextProvider` mirrors the Rust reference's trait — optional
  `acceptLineHints`, `getText`, `setLanguage`, `areLinesAvailable` — and
  `StringTableTextProvider` is the default implementation (base table +
  per-language translations, `getText` falling back to base for lines a
  translation lacks; `areLinesAvailable` checks the *active* table without
  fallback — that's the signal's point). `Dialogue` accepts
  `textProvider` and exposes `setLanguage(language | null)` (null = base;
  reports a diagnostic when no provider was injected). The VM resolves
  line and option text through the provider **at delivery** — by the
  canonical line ID, falling back to the program's own text when the
  provider (or the provider's language) lacks the line, so an empty
  provider changes nothing and all pre-existing behavior holds;
  substitutions and markup still compose at delivery, so translated text
  keeps `{expr}` live. `acceptLineHints` runs on node entry whether or not
  the opt-in `LineHints` event is enabled (Rust `accept_line_hints` feeds
  availability tracking).
- **Event lineId shape change (deliberate)**: `LineEvent.lineId` and
  `LineHintsEvent.lineIds` now carry the **full `line:`-prefixed canonical
  ID** (upstream `Line.ID`) — they previously stripped the prefix (one
  pinned assertion in saliency.test.ts updated; no other test or adapter
  code consumed the stripped shape). The provider seam, string-table keys,
  and the CSV `id` column must be one canonical string for
  setLanguage-from-CSV to work without host-side stripping.
- **Tests**: `src/tests/stringsFile.test.ts` (7 — CSV round-trips, quoting,
  lock/comment/lineNumber columns, shadow exclusion, language filtering),
  `src/tests/tagLines.test.ts` (17 — both generators' shapes, the upstream
  doc examples (0100/0200/0300/0400, Node.Subtitle, 0150 midpoint, 0101_g1
  generation), descending/exclusion exceptions, all three abort behaviours,
  exclusion plumbing, parse-error bail, second-run stability, and
  round-trips through compile + the runtime for both generators),
  `src/tests/textProvider.test.ts` (7 — provider unit behavior and the
  end-to-end CSV workflow: compile → base CSV → "translate" → provider →
  setLanguage swaps rendered line and option text). Ported inline upstream
  tests: TagTests.cs `TestCommentsArentTagged` (escaped text tags and
  recompiles clean); the CSV/tagger paths have no upstream fixture coverage
  (inventory fact) — the rest are ported-shaped inline tests. 409/409.
- **Docs**: README's Runtime section gains `setLanguage` and the
  `textProvider` option. CONTEXT.md needed no changes — the Text provider,
  Line-tag generator, and Line ID glossary entries already described this
  surface. CITATION.cff: YarnSpinner-Unity entry added (StringTableEntry.cs,
  YarnProjectImporter.cs, YarnImporter.cs); YarnSpinner notes extended for
  the tagLines port.
