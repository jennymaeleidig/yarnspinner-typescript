# Next.js host (yarn-project-support ticket 04)

A worked app-router example proving the end-to-end story in Next.js: the
YarnProject loader runs server-side, the client component runs `Dialogue`'s
pull-based continue loop natively. An example app, not package surface.

## Run it

```bash
npm run host:build   # builds the library (dist/), then `next build` the host
npm run host:start   # serves the built host on :3000
```

Run from the repo root: the server component resolves the content directory
relative to `process.cwd()`.

## How the story fits together

- **Server side** (`app/page.tsx`): `loadYarnProject()` loads this app's own
  authored project — `content/project.yarnproject` + `content/crossroads.yarn`
  — through the Node file-access provider (`nodeProjectFs`). This is the
  injected file-access seam earning its keep: the loader core never touches
  Node APIs, and all of the Node access stays here, in a server component.
- **The RSC boundary**: the only thing passed to the client component is the
  compiled program — a plain serializable object (ADR 0001) — plus loader
  context (project name, resolved sources, diagnostics).
- **Client side** (`app/DialogueHost.tsx`): imports the package's main entry
  only, which is browser-safe by construction (coding standard §2 — no
  `node:` builtins in the bundle). The first pull runs during the initial
  render, so the opening line is in the SSR output; Continue delivers one
  `continue()` batch; option sets render as buttons (plus a
  `noOptionSelected` fall-through); Reset demonstrates variable-storage
  reset — a fresh `Dialogue` is a fresh storage, so `<<declare>>` seeds
  reapply and the story replays from the top (coding standard §4).
- **Resolution**: the app imports `yarn-spinner-runner-ts` by package name;
  Node and the Next bundler resolve it through the root package.json's
  `exports` self-reference, to the built `dist/`. Build the library first
  (`host:build` does).

## Tests

`src/tests/nextjsHost.test.tsx` mirrors the ticket-52 demo-harness pattern:
the content files are the single source of truth (loaded through the same
server-side path the page uses), the client component's initial-pull logic is
mirrored in the test (tests compile from src only — no package surface for a
one-app example), and the reset story is asserted behaviorally through
`Dialogue`.
