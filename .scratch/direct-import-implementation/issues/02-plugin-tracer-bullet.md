# 02: Plugin tracer bullet — `.yarn` import compiles to a `Program`, dev reloads on content edits

**What to build:** The companion plugin package exists as a workspace package in this repo under the locked npm identity (available, verified) with the locked dependency story (core as dependency via workspace protocol, Vite as peer dependency, lockstep versioning). Through the plugin, `import program from "./story.yarn"` compiles at build time and the emitted module's default export is a working **Program** — construct a `Dialogue` from it and run content. Saving a `.yarn` or `.yarnproject` file in the dev server triggers a full page reload. Verified by the emitted-module seam: drive `resolveId`/`load` the way Vite does, evaluate the emitted code, run a dialogue. This is the tracer bullet: one narrow but complete path through plugin → compile → emitted module → runtime.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Workspace package scaffolded; root package still publishes itself with the workspaces introduction intact
- [ ] The compile step exists as a pure, bundler-agnostic function (no Vite types in its signature)
- [ ] A `.yarn` import emits a module whose default export is a `Program` that a `Dialogue` executes end-to-end
- [ ] Emitted-module seam tests pass (resolveId/load driven, emitted code evaluated)
- [ ] Content edits trigger full page reload in dev
- [ ] Full suite green; lint clean
