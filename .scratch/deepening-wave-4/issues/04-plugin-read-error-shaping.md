# Plugin read-error shaping on both branches

Type: task
Status: open

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

(when resolved)