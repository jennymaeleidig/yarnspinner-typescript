# 05: SvelteKit host

**What to build:** the Next.js host's story with zero React anywhere — the
strongest proof the runtime is framework-agnostic: project load via the
loader (ticket 02), `Dialogue`'s continue loop rendered natively in Svelte,
variable-storage reset demonstrated. Same acceptance-harness role, same
minimalism — one dialogue flow from the authored examples content, an example
app rather than package surface.

**Blocked by:** 02 (loader core)

Type: task

**Status:** ready-for-agent

- [ ] Project load via the loader; native Svelte rendering of the continue
      loop, no React in the tree
- [ ] Variable-storage reset demonstrated
- [ ] Builds clean in CI; server-rendered dialogue output asserted through
      `Dialogue`
- [ ] README documents framework support as demonstrated across both hosts
