# Framework-agnostic package boundary

The root package shipped React imports on its main surface, forcing non-React consumers to install `react`/`react-dom` and pull `react/jsx-runtime` into their bundles. We decided the root stays React-free: React moves behind a `./react` subpath export with `react`/`react-dom` as optional peer dependencies, and build-time content compilation moves to a separate companion package, `yarn-spinner-vite-plugin`, which compiles `.yarn`/`.yarnproject` imports at build time via bundler-neutral compile functions (`compileYarnModule`, `compileYarnProjectModule`) so a webpack loader can reuse them verbatim.

## Considered Options

- Keep React at the root (simplest imports, but couples every consumer to React).
- Virtual modules inside one plugin (rejected: real-file ids in place, the mdx/svelte precedent, keeps source maps and HMR honest).

## Consequences

The companion plugin declares `yarn-spinner-runner-ts` and `vite` as peerDependencies, not workspace/file dependencies: npm rejects `workspace:*` ranges, cannot link a workspace package to the root by name, and packs a `file:` dependency verbatim (the tarball would ship an uninstallable `file:../..`). All published exports carry dual ESM/CJS conditions (`build:cjs` + `scripts/postprocess-cjs.mjs`), so CJS consumers get the same surface.