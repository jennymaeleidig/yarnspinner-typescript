# One severity-precedence implementation — loadProject owns the merge

Type: task
Status: open

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

(when resolved)