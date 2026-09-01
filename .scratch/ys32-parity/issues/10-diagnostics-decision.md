# Diagnostics decision

Type: grilling
Status: resolved
Blocked by: 09

## Question

Using the [diagnostics catalog](./09-diagnostics-catalog.md): decide the TS diagnostics contract — do diagnostics **collect** (upstream: `CompilationResult.Diagnostics`, compile continues) or **throw** (current fork behavior), or both via a strictness option? What is the diagnostic object shape (code, severity, message, file/range, context)? Which YS codes make the first spec (with the catalog's adopt/N-A mapping)? Do parse-time markup diagnostics fold into the same channel (3.2.1 behavior)? How do diagnostics surface in the runtime (upstream `LogErrorMessage`/`LogDebugMessage`)?

## Answer

All recommendations confirmed by the maintainer:

1. **Collect by default** — compile continues, diagnostics returned with the result; optional **strict flag throws on first error** (fail-fast consumers). Serves the fixture corpus's 33 ParseFailures expected-code assertions.
2. **Diagnostic shape: upstream `Diagnostic` adopted** — `{ code, severity: 'error'|'warning'|'info', message, file, range {startLine, startCol, endLine, endCol}, context? }` (YS0005; fixes the fork's missing line/column bug).
3. **First-spec target: the 22 adoptable codes** (12 as-is + 10 adjusted triggers), explicitly including YS0005, YS0030, YS0031, YS0012, YS0032, YS0045, YS0050, YS0063; the 10 deferred codes join automatically as their features land; 14 N-A dropped.
4. **Authoritative source: the 3.2.2 per-code markdown registry** in the upstream repo (docs page is stale/wrong on severities); vendored diagnostic definitions double as exact-code golden tests.
5. **Runtime surface: `logError` / `logDebug` option callbacks** — diagnostics, not dialogue events.
