# yarnspinner-typescript

TypeScript parser, compiler, and runtime for Yarn Spinner 3.x. Framework-agnostic: hosts own their UI against `Dialogue`/`Transcript` directly.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Releasing

Two packages ship in lockstep — `yarnspinner-typescript` and `yarnspinner-vite-plugin` — and `scripts/check-versions.mjs` gates both publishes. See `docs/releasing.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
Coding standards: `CODING_STANDARDS.md` (repo root) — binding for agents and humans; use the `CONTEXT.md` glossary vocabulary in all outputs.
