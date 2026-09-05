# Framework-agnostic package boundary

The root package shipped React imports on its main surface, forcing non-React consumers to install `react`/`react-dom` and pull `react/jsx-runtime` into their bundles. We decided the root stays React-free: React moves behind a `./react` subpath export with `react`/`react-dom` as optional peer dependencies, and build-time content compilation moves to a separate companion package, `yarnspinner-vite-plugin`, which compiles `.yarn`/`.yarnproject` imports at build time via bundler-neutral compile functions (`compileYarnModule`, `compileYarnProjectModule`) so a webpack loader can reuse them verbatim.

## Considered Options

- Keep React at the root (simplest imports, but couples every consumer to React).
- Virtual modules inside one plugin (rejected: real-file ids in place, the mdx/svelte precedent, keeps source maps and HMR honest).

## Consequences

The companion plugin declares `yarnspinner-typescript` and `vite` as peerDependencies, not workspace/file dependencies: npm rejects `workspace:*` ranges, cannot link a workspace package to the root by name, and packs a `file:` dependency verbatim (the tarball would ship an uninstallable `file:../..`). All root-package exports carry dual ESM/CJS conditions (`build:cjs` + `scripts/postprocess-cjs.mjs`), so CJS consumers get the same surface; the companion plugin is ESM-only by design (Vite's Node API is ESM).

## Amendment (2026-09-04): the React adapter is removed

The `./react` subpath was a halfway house: it kept React imports out of
non-React bundles but still shipped a framework adapter — a UI layer the
package owned, with React as an optional peer dependency. The adapter is now
removed entirely: `src/react/`, the `./react` export, and the React peers
are gone, and no consumer-facing `react` dependency remains — no adapter, no
`./react` export, no optional peers (the repo's dev dependencies — used by
the example hosts — keep react as a development-only dependency, the
Next.js host being a React app by nature). The package root is
the whole story — a framework-agnostic core (`Dialogue`, `Transcript`, the
compile/loader/markup surfaces), with hosts owning their UI directly against
it. This completes the boundary this ADR drew rather than reversing it: the
root did not just stay React-free; there is no React (and no other
framework) surface behind it to keep out. The browser demo, Next.js host,
and SvelteKit host demonstrate the pattern in three frameworks on the same
root surface.
