# 09: Docs — direct import, loader contract, framework boundary

**What to build:** The docs tell the whole consumption story: every import shape with its result and options; the ambient-types reference path and the paste-in fallback; the generic loader contract (pure compile function + the webpack-loader path for Next.js webpack mode and Turbopack rules) with explicit guidance on when the SSR load path applies instead; and the framework boundary statement (Vite first-class including SvelteKit, webpack-loader path documented, Next SSR path unchanged). The React subpath import change is reflected wherever the README shows package imports.

**Blocked by:** 06 (types documented), 08 (acceptance harness demonstrates the story).

**Status:** ready-for-agent

- [ ] All import shapes documented with result shapes and the full options surface
- [ ] Editor-types reference path and paste-in fallback both documented
- [ ] Generic loader contract and Next.js/Turbopack guidance written
- [ ] Framework boundary statement present; React subpath reflected in all import examples
- [ ] Docs reviewed against the spec for drift
