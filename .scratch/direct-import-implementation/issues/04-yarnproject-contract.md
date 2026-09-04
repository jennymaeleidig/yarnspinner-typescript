# 04: `.yarnproject` import contract

**What to build:** `import project from "./project.yarnproject"` resolves to the full project-load result — compiled program, per-locale string tables, localisation metadata, diagnostics — shaped so a host hands it to the project text-provider factory and runs localised dialogue with no runtime file access. The plugin reads the project file, resolves source globs, and reads strings CSVs at build time on the Node side; the `YarnProjectFileSystem` seam stays out of the browser story. Verified on the emitted-module seam: the evaluated import feeds the text-provider factory and a `Dialogue` delivers localised text.

**Blocked by:** 02 (plugin tracer bullet).

**Status:** ready-for-agent

- [ ] A project import emits the full load result: program plus per-locale string tables plus localisation metadata
- [ ] The evaluated import feeds the text-provider factory; a `Dialogue` delivers base-language and localised text
- [ ] Source globs and strings CSVs are resolved at build time; no runtime file access remains in the emitted module
- [ ] Unknown keys in the project file are tolerated per the core loader's semantics
- [ ] Full suite green
