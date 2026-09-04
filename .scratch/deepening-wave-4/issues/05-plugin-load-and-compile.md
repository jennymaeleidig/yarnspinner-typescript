# One load-and-emit path in the plugin's load hook

Type: task
Status: resolved
Blocked by: 04

## Problem

The two branches of the plugin's `load` hook each hand-roll
read → compile → emit: the warn closure is written twice,
`emitModule` carries five positional parameters, and the next plugin option
(per-import `definitions`-style) would be pasted twice. Modest friction — the
plugin is young — but the branch split is where the next option lands twice.

## Decision

One local `loadAndCompile(id, file, query, warn)` owning: the read (with
`fileReadError` shaping on both branches, per ticket 04), the compile-step
choice by file kind + pin, and the single `this.warn` closure; `emitModule`
folds into it. The compile steps (`compileYarnModule` /
`compileYarnProjectModule`) stay untouched — they are the bundler-agnostic
seam (ADR 0006). The plugin's hook interface shrinks to:
split query → filter → load-and-emit.

## Tests

- Existing plugin suites stay green unchanged (the seam suite drives
  load/handleHotUpdate the way Vite does).

## Constraints

- Refactor, no behavior change beyond ticket 04's (already landed).
- Vite-side plumbing only; nothing bundler-neutral moves.

## Answer

Landed. One `loadAndCompile(id, file, warn)` in packages/vite-plugin/src/index.ts
owns the read (fileReadError shaping on both branches), the compile-step
choice by file kind + pin, and the single warn closure; `emitModule` is folded
into it and the five-positional-parameter signature is gone. The `load` hook
shrinks to split query → filter → load-and-emit. The now-unused `YARN_FILE`
regex and `CompiledYarnModule` type import died with the branch split. The
compile steps (`compileYarnModule`/`compileYarnProjectModule`) are untouched —
bundler-agnostic per ADR 0006. One deliberate evaluation-order note: the
project branch now reads before compiling (previously the args evaluated
compile first, read second) — same observable outcome, the read failure wins
in both orders.

All plugin suites green unchanged (the seam suite drives load/
handleHotUpdate the way Vite does; ticket 04's read-error pin covers both
branches post-collapse). Suite 634 pass / 0 fail / 1 skip, lint and ts-check
clean.
## Comments

2026-09-04 two-axis review: the review's one actionable finding — the two
branches still repeated the warn/emit tail (Duplicated Code, a judgement
call) — is fixed by an `emit` closure inside `loadAndCompile` owning the
shared tail once. The spec axis's two partials stand as recorded: the landed
`(id, file, warn)` signature drops the Decision's unused `query` param
(better shape; the Decision text was written before the collapse), and the
evaluation-order note is the only behavior delta, deliberate and recorded in
the Answer.
