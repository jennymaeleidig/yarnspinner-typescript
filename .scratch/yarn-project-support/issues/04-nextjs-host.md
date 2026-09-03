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

**Status:** ready-for-agent

- [ ] Server-side project load via the loader; client `Dialogue` loop with no
      Node APIs in the client path
- [ ] Variable-storage reset demonstrated
- [ ] Builds clean in CI (npm run target alongside `demo:build`); SSR-style
      render test mirroring the ticket 52 demo harness
- [ ] README documents the host
