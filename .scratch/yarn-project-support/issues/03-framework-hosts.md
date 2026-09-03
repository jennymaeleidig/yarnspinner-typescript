# 03: Framework hosts — Next.js + SvelteKit

**What to build:** worked reference hosts proving the end goal — this library
runs outside React. Two example apps, mirroring the browser demo's role as
acceptance harness:

- **Next.js**: app-router example compiling the `examples/yarn` project via
  the YarnProject loader (ticket 02) server-side, running `Dialogue` in a
  client component; demonstrates the loader under bundling (no Node `fs` in
  the client path — the injectable file-access seam earns its keep here).
- **SvelteKit**: the same story with zero React anywhere — the strongest proof
  that the runtime's framework-agnostic claim is real.

Both are example apps (`examples/next/`, `examples/sveltekit/`), not package
surface; no adapter abstraction is built until a second real consumer forces
the shape (React adapter stays the only in-package adapter). Keep each app
minimal: one dialogue flow, the pull-based `continue()` loop rendered
framework-natively, variable storage reset, one text-provider locale switch
if the localisation plumbing from ticket 02 is ready.

**Blocked by:** 02 (loader must exist for the apps to consume projects).

**Status:** ready-for-agent

- [ ] Next.js example: server-side project load, client `Dialogue` loop
- [ ] SvelteKit example: same flow, no React in the tree
- [ ] Both build clean in CI (`npm run` targets alongside `demo:build`)
- [ ] README documents framework support as demonstrated, not claimed
