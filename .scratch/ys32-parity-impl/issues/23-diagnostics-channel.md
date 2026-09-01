# 23 — Diagnostics channel (spec phase 1 slice; ticket 10 decision)

Status: resolved
Landed in: see .scratch/ys32-parity-impl (this effort's commit history)

## Landing notes

Scope was trimmed during implementation: the channel ships with the node-structure
validations the current front-end supports (YS0011 duplicate title — only for invalid
groups per the vendored definition, YS0031 missing when:, YS0032 duplicate subtitle,
YS0033 empty node, YS0012 undefined jump target as a warning, YS0052 double title with
first-title recovery, YS0005 syntax errors with 0-based half-open ranges from the
parser). Exact-code emission for set/declare values, enums, smart variables, and shadow
lines is owned by tickets 40–42; ParseFailures assertions there will delete the
remaining MUST_FAIL_ALLOWLIST entries (four already fell to this landing).
In flight: uncommitted `src/compile/diagnostics.ts`, `src/tests/diagnostics.test.ts`,
vendored `test/fixtures/upstream/YarnSpinner/Diagnostics/Definitions/` registry.

## Scope

Spec Implementation Decisions — diagnostics slice, per wayfinding ticket 10:

- `Diagnostic` shape `{ code, severity, message, file, range, context }`
  (upstream 3.2.2 shape; fixes missing line/col). 0-based ranges, inclusive
  start / exclusive end; `file`/`context` optional pre-multi-file.
- Collect by default (compile continues); strict flag throws on first error
  (coding standards §3 collect-don't-throw).
- Codes and default severities from the vendored per-code markdown registry
  (authoritative; docs page stale on severities; YS0001/YS0002 dead codes).
- Runtime surface: `logError`/`logDebug` option callbacks.

## Unblocks

- Deleting the ticket-20 ParseFailures allowlist (33 must-fail fixtures assert
  exact YSxxxx codes — spec Testing Decisions adoption phasing step 3).
- Phase-1 compiler core work (ticket 30).

## Acceptance

ParseFailures corpus passes with expected diagnostic codes, allowlist gone;
diagnostics observable at the compile seam; full suite green.
