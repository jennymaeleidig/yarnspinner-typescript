# 04: Next.js host

**What to build:** a worked app-router example proving the end-to-end story
in Next.js: the YarnProject loader runs server-side — the injected
file-access seam earning its keep, no Node APIs in the client path — and a
client component runs `Dialogue`'s pull-based continue loop natively.
Demonstrates variable-storage reset. Mirrors the browser demo's role as an
acceptance harness: minimal, one dialogue flow from the authored examples
content. No adapter abstraction — this is an example app, not package
surface.

**Blocked by:** 02 (loader core)

Type: task

**Status:** resolved

- [x] Server-side project load via the loader; client `Dialogue` loop with no
      Node APIs in the client path
- [x] Variable-storage reset demonstrated
- [x] Builds clean in CI (npm run target alongside `demo:build`); SSR-style
      render test mirroring the ticket 52 demo harness
- [x] README documents the host

## Landing notes (ticket 04)

- **App**: `examples/nextjs-host/` — app router, two components.
  `app/page.tsx` (server) runs `loadYarnProject()` over the app's own
  authored content (`content/project.yarnproject` + `content/crossroads.yarn`:
  a crossroads/Rogue flow with `<<declare>>` seeds, a gold-priced option, a
  conditional `<<jump>>`, and a walk-on path) through the Node provider; the
  compiled program crosses the RSC boundary as a plain serializable object.
  `app/DialogueHost.tsx` (client) imports only the package's browser-safe
  main entry — the first pull runs in the useState initializer so the opening
  line is in the SSR output; Continue delivers one `continue()` batch; option
  buttons plus a `noOptionSelected` fall-through; Reset demonstrates
  variable-storage reset (a fresh `Dialogue` is a fresh storage, §4).
- **Resolution**: the host imports `yarn-spinner-runner-ts` by package name;
  Node and Next's bundler resolve the root package.json's `exports`
  self-reference to the built `dist/` — the truest consumer story (the host
  consumes the built artifact, and the `./node` subpath split is exercised
  for real: `node:` builtins appear only in the node subpath bundle).
- **CI target**: `next` (14.2.x — React 18-compatible; no React 19 churn for
  the library's toolchain) added to root devDependencies; npm targets
  `host:build` (npm run build + next build; the whole page statically
  prerenders, so the server-side load runs at build time) and `host:start`
  alongside `demo:build`. The build was verified in-session; ticket 53 owns
  wiring it into actual CI.
- **Tests**: 7 in `src/tests/nextjsHost.test.tsx` (ticket-52 harness shape,
  content files as single source of truth, client-pull logic mirrored in-test
  since tests compile from src only — no package surface for a one-app
  example): server-side load, program JSON round-trip (the RSC boundary
  claim), main-entry bundle node-free vs `./node` (§2 verified on the built
  artifacts), SSR opening-line render, the buy-the-map flow to
  DialogueComplete with variable assertions, reset replay, walk-on path,
  `noOptionSelected` fall-through. Suite 451/451, lint clean.
- **Docs**: README Next.js Host section, `examples/nextjs-host/README.md`.
- **Two-axis code review**: Standards 7 met / 0 missing; Spec 3 partial (CI
  wiring is ticket 53's — same disclosure as ticket 52's demo:build; the SSR
  test exercises the first pull through a mirrored harness since tests
  compile from src only; the node-free assertion now checks both halves and
  both specifier styles), 0 missing. Resolutions: the client component's
  render-time adjustment now follows the useYarnRunner house pattern exactly
  (idempotent ref guard; StrictMode's double render is a no-op) instead of
  an impure useState initializer; diagnostics cross the RSC boundary
  structured, not string-flattened; the UI text says `loadYarnProject()`
  (what the page calls); `pump` renamed `pull` (glossary: Continue is the
  pull operation); `EMPTY_TRANSCRIPT` frozen; the §6 trade-offs (internal
  nodeProjectFs import per ticket-02 prior art; built-artifact grep for
  bundle safety, which has no behavioral seam) disclosed in the test header.
  Not acted on: lockfile churn (npm pruned stale vitest/chai entries while
  adding next), the content's two-branch flow (one flow, as asked — branches
  demonstrate the loop).

### Final spec-vs-impl review (yarn-project-support close-out)

Reviewer flagged story 13 partial: the "Builds clean in CI" checkbox was
checked while the CI workflow ran only `npm test` — the `host:build` target
was verified in-session but never wired into CI, contradicting the ticket.
Resolved in close-out rather than deferring to ticket 53: the root workflow
(`.github/workflows/npm-publish-github-packages.yml`) now runs
`demo:build`, `host:build`, and `sveltekit:build` on every push to main, after
`npm test`. All three targets verified passing locally in the same pass.
