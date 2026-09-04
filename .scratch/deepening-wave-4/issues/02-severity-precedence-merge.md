# One severity-precedence implementation — loadProject owns the merge

Type: task
Status: resolved

## Problem

The same conceptual operation — layer a host-supplied severity map over the
project file's own map — has two implementations with different semantics:

- `loadProject` (src/compile/yarnProject.ts:652):
  `project.compilerOptions?.diagnosticsSeverity ?? opts.diagnosticsSeverity`
  — replace semantics; the project map wins wholesale.
- `compileYarnProjectModule` (packages/vite-plugin/src/compileProjectModule.ts:42–56)
  — merges `{...projectMap, ...opts}` per-code (host wins) and applies
  `applySeverityOverrides` as a second final pass over already-final
  diagnostics. The re-pass exists only because `loadProject`'s `??` cannot
  express the documented merge.

The documented contract (CONTEXT.md "Direct import": project file's map
first, then the plugin option, most specific wins) is true at the plugin but
false for a direct `loadProject` caller.

## Decision

`loadProject` composes `{...project.compilerOptions?.diagnosticsSeverity,
...opts.diagnosticsSeverity}` (per-code, host wins) and applies it once.
`compileYarnProjectModule` stops merging and deletes its compensating re-pass;
it passes its opts straight through. The precedence contract gets one home.

Behavior change: a direct `loadProject` caller passing both maps now gets the
per-code merge instead of replace-wholesale. Standalone ticket.

## Tests

- New pin: direct `loadProject` call with a project map and a host
  `diagnosticsSeverity` map — host entries win per-code, project entries for
  other codes still apply, compile result reflects the merged map.
- Existing plugin precedence tests (vitePluginProject) stay green unchanged —
  the merge order is already pinned there.

## Constraints

- `applySeverityOverrides` stays the one application pass
  (src/compile/diagnostics.ts); this ticket moves the *layering decision*,
  finishing a0d82d8's own logic (the extraction shared the application, not
  the layering).
- CONTEXT.md "Direct import" and the plugin docs are synced at landing (the
  merge-order claim then holds for both entry points).

## Answer

Landed. `loadProject` (src/compile/yarnProject.ts) composes
`{...project.compilerOptions?.diagnosticsSeverity, ...opts.diagnosticsSeverity}`
(per-code, host wins) and applies it once via `compile()`'s shared pass;
`compileYarnProjectModule` passes `opts.diagnosticsSeverity` straight through
and its merge + compensating re-pass are deleted (with the now-unused
`applySeverityOverrides`/`DiagnosticSeverity` imports). `CompileOptions
.diagnosticsSeverity`'s JSDoc states the host-layer framing. CONTEXT.md
"Direct import" and docs/direct-import.md now say the per-code merge is the
loader's own semantics — direct `loadProject` callers get the documented
precedence without the plugin.

New pin: yarnProject.test.ts "severity precedence: the host option merges
per-code over the project's own map" — project downgrade alone, host
re-escalation of the shared code, merged maps composing both ways
(YS0011/YS0031), host downgrade with no project map. One probe finding
recorded: a parse-failure file (missing `---`) yields a null program
regardless of severity, so the pin uses a validate-level code.

Suite 633 pass / 0 fail / 1 skip, lint and ts-check clean.