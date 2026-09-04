# Ticket 04 — Companion package identity and structure

Type: grilling
Status: resolved
Blocked by: 02, 03

## Question

Decide the companion plugin's package identity and repo placement as spec text: npm name (e.g. `yarn-spinner-vite-plugin` vs scoped `@yarn-spinner/vite-plugin`), whether it lives in this repo (workspace) or a new one, whether it builds on `unplugin` or Vite-only, its exports map and peer-dep story (vite as peer? core package as peer or dependency, and which version range), and how it versions relative to the core package. Include the d.ts-for-virtual-imports decision if ticket 03 left it open.

## Answer

All six sub-decisions resolved (human accepted recommendations, 1 round). Fact: all candidate names verified available on the npm registry (checked 2026, via registry fetch — direct npm CLI unreachable from sandbox).

1. **npm name**: `yarn-spinner-vite-plugin` — unscoped, ecosystem-name-first, no org dependency (the `@yarn-spinner` scope belongs to upstream's namespace and stays unclaimed by us).
2. **Repo placement**: workspace package at `packages/vite-plugin/` in this repo; npm `workspaces` field added; plugin consumes core via `workspace:*`. Spec must note the packaging care: the repo root publishes itself today, so the workspaces addition must keep root publishing intact.
3. **unplugin vs Vite-only**: Vite-only plugin; the compile step extracted as a pure, bundler-agnostic function so the later webpack loader (Next webpack mode / Turbopack `turbopack.rules`) reuses it, not rewrites it.
4. **Dependencies**: core `yarn-spinner-runner-ts` as a regular `dependency` (`^` range, `workspace:*` in-repo); `vite` as `peerDependency`.
5. **Versioning**: lockstep with core at `0.x` — same version number = tested combo.
6. **d.ts home** (confirmed from tickets 02/03): plugin package ships `client.d.ts` exposed as a `./client` types subpath — ambient `declare module "*.yarn"`, `"*.yarn?raw"`, `"*.yarnproject"` matching ticket 03's export shapes; host opts in via `/// <reference types="yarn-spinner-vite-plugin/client" />`; zero-dependency paste snippet documented as fallback.
