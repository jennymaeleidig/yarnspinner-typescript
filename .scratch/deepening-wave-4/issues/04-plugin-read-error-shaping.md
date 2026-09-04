# Plugin read-error shaping on both branches

Type: task
Status: resolved

## Problem

The plugin's `load` hook (packages/vite-plugin/src/index.ts:225–245): the
project branch wraps its read in `.catch(fileReadError)` (index.ts:240) but
the standalone-`.yarn` branch does not — an unreadable `.yarn` escapes as a
raw ENOENT instead of the `YarnBuildError` shape. The contract ("a
compilation file the plugin cannot read must fail the build naming the
file") is stated but holds on one branch only.

## Decision

Behavior change, standalone with its own pin: the `.yarn` branch's read gets
the same `fileReadError` shaping. Both branches fail the build with the same
legible error for an unreadable file.

## Tests

- New pin: an unreadable standalone `.yarn` import fails the load with a
  `YarnBuildError` naming the file (not a raw ENOENT).

## Constraints

- Ticket 05 (loadAndCompile plumbing) builds on this; the shaping is in
  place before the plumbing moves. The bundler-neutral compile steps are
  untouched (ADR 0006).

## Answer

Landed. The `.yarn` branch's read in the plugin's load hook now wraps in
`.catch(fileReadError)` (packages/vite-plugin/src/index.ts), matching the
project branch. The `?raw` query branch deliberately keeps the raw read —
that is Vite's raw-asset contract, not a compilation file.

New pin in vitePlugin.test.ts: an unreadable `.yarn` AND an unreadable
`.yarnproject` both fail the load with the YarnBuildError shape naming the
file — no raw Node error (errno/syscall) escapes, no loc (nothing was read).
Discriminator note recorded: the shaped message legitimately names the ENOENT
cause, so the pin asserts the shape, not the absence of the string.

Suite 634 pass / 0 fail / 1 skip, lint and ts-check clean. (Plugin dist
rebuilds under pretest; standalone tsx runs over the plugin suites need
`npm run build -w yarn-spinner-vite-plugin` first.)