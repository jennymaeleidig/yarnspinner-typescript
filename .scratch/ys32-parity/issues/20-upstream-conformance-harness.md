# 20 — Upstream conformance harness (spec phase 0)

Status: resolved (retroactive)
Landed in: a0fe16a
Retroactive: created after the work landed, before any ticket was written — see map.md note.

## Scope (as implemented)

Spec phase 0 "conformance foundation", executed from spec.md Testing Decisions and
wayfinding ticket 01:

- Vendor `YarnSpinner@v3.2.2` (tag 5b3a4ff) `Tests/` corpus under
  `test/fixtures/upstream/YarnSpinner/` with provenance/citation; 6 MB
  `Duplicates/` lipsum excluded (phase-3 surface per ticket 01 inventory).
- Hand-written `.testplan` parser for the current grammar (backticks, `---` runs,
  hashtags, `[disabled]`, 1-indexed select, set/node/saliency steps). Rust reader
  NOT ported (obsolete pre-backtick format, per ticket 01).
- TestBase port: step-locked event-stream runner over parse → compile → YarnRunner,
  composed-text comparison, hashtag assertions, shared-state runs; documented
  adaptations for fork-era runtime gaps.
- Driver tests: 33 ParseFailures must-fail + DuplicateLineTags; 32 compile-clean;
  32 plan runs (21 green, 11 allowlisted pending the diagnostics channel); Example smoke.

## Deviations / follow-ups

- Ticket 01's "must-fail" claim was corrected during review: only 1/33 ParseFailures
  fails naturally; the rest are allowlisted pending the diagnostics channel (ticket 23,
  spec phase 1). Allowlist must be deleted when diagnostics land.
- package.json `files` allowlist keeps fixtures out of the npm package.

## Acceptance

Driver tests run over the vendored corpus; 21/32 plans green; provenance recorded.
