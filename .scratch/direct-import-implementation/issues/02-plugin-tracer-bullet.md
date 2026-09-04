# 02: Plugin tracer bullet — `.yarn` import compiles to a `Program`, dev reloads on content edits

**What to build:** The companion plugin package exists as a workspace package in this repo under the locked npm identity (available, verified) with the locked dependency story (core as dependency via workspace protocol, Vite as peer dependency, lockstep versioning). Through the plugin, `import program from "./story.yarn"` compiles at build time and the emitted module's default export is a working **Program** — construct a `Dialogue` from it and run content. Saving a `.yarn` or `.yarnproject` file in the dev server triggers a full page reload. Verified by the emitted-module seam: drive `resolveId`/`load` the way Vite does, evaluate the emitted code, run a dialogue. This is the tracer bullet: one narrow but complete path through plugin → compile → emitted module → runtime.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Answer

Implemented and reviewed. One recorded deviation from the ticket's own wording, plus two recorded judgment calls:

- **Dependency wiring**: the ticket said `workspace:*` — that protocol is pnpm/yarn; npm rejects it (EUNSUPPORTEDPROTOCOL), and npm cannot link a workspace to the *root* package by name (root is not a workspace member; npm probes the registry). Verified further: npm packs a `file:` dependency **verbatim** (no publish-time rewrite), so a regular `file:` dependency would ship uninstallable. Final shape: core and Vite as **peerDependencies** of the plugin (core caret `^0.2.0` — hosts import `Dialogue` from core anyway, so the peer is always satisfied), and `file:../..` as a devDependency for dev-time symlink resolution. The spec's companion-package paragraph was updated to record this deviation from the locked decision.
- **No resolveId hook**: the ticket's "resolveId/load driven" wording anticipated virtual-module glue; the locked design compiles real file ids in place (mdx/svelte precedent), so Vite hands load the on-disk id directly. The seam suite drives `load` exactly as Vite would.
- **Throw at the bundler boundary**: the library's collect-don't-throw standard (§3) scopes to the library; a bundler plugin's job is converting compile failure into build failure. The throw is documented in the module; ticket 03 shapes it into a RollupError with loc/frame.

Also note: npm publish of the ROOT package still works with workspaces present (verified via pack --dry-run — zero packages/ files in the tarball).

- [x] Workspace package scaffolded; root package still publishes itself with the workspaces introduction intact (pack --dry-run: 330 files, zero from packages/)
- [x] The compile step exists as a pure, bundler-agnostic function (no Vite types in its signature) — compileYarnToModule(source, filename) → emitted module string
- [x] A `.yarn` import emits a module whose default export is a `Program` that a `Dialogue` executes end-to-end (line delivery, option set, selection, chosen line all asserted)
- [x] Emitted-module seam tests pass (load/handleHotUpdate driven the way Vite does, emitted code evaluated via data-URL import)
- [x] Content edits trigger full page reload in dev — .yarn and .yarnproject both send {type:"full-reload"}; non-owned files untouched
- [x] Full suite green; lint clean (lint widened to packages/*/src)
