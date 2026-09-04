# 01: Own the severity-consolidation cluster

**Type:** task

**What this is:** The un-ticketed working-tree changes two review axes independently flagged: a new exported `applySeverityOverrides` in `src/compile/diagnostics.ts` (the severity-override pass extracted so core and plugin share one implementation — direct-import's `compileProjectModule.ts` duplication smell dies here), `compileSource.ts` delegating to it, the plugin consuming it, the removed `baseLanguage ?? "en"` default (`baseLanguage` is a required project field per YP0003 — the default masked a malformed project), async `asBuildError` with diagnostic-file loc + `asWarning` file:line:col format, new pins in the plugin suites, and the `pluginHarness.lineTexts` helper.

**Resolution (human ruling: "fix all" — the cluster is kept, not reverted):** the cluster predates drop-react-adapter, fixes a recorded review smell, and carries its own new pins. It is accepted as intentional work, owned by this ticket.

**Status:** resolved

## Answer

Accepted into the codebase as recorded above. Verification for the executor of tickets 02–05: the cluster's pins ride the existing plugin suites (`vitePlugin.test.ts`, `vitePluginProject.test.ts`); the full suite was 626 pass / 0 fail at the time of acceptance. `applySeverityOverrides` becomes package surface of the core (exported from `src/compile/diagnostics.ts`, which the root re-exports) — glossary-accurate naming already holds. The `compileSource.ts` local wrapper (alias-then-forward, the review's Middle Man call) is ticket 05's to inline.

## Comments
