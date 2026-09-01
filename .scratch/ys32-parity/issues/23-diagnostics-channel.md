# 23 — Diagnostics channel (spec phase 1 slice; ticket 10 decision)

Status: claimed
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
