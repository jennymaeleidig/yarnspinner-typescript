# 05: Plugin options surface

**What to build:** The plugin accepts its full option shape: a `project` option that pins an explicit `.yarnproject` as compilation context for `.yarn` imports (base language, definitions, compiler options flow into the compilation job — no upward discovery); `definitions` accepting `.ysls.json`-shaped files or inline objects so build-time signature checking sees the host's `Library` surface; compiler-options passthrough; and `include`/`exclude` filters layered over extension matching. Verified through the emitted-module seam: a pinned import compiles with project context, a declared host function passes signature checking, and an undeclared one produces the expected diagnostic.

**Blocked by:** 04 (`.yarnproject` contract — project loading must exist to pin).

**Status:** resolved

## Answer

All four option surfaces implemented on the plugin (each derived once at plugin creation, passed into both compile steps):

- **`project`**: pins an explicit `.yarnproject`; a `.yarn` import then emits the project's one-job result (program + localisation + metadata). Unpinned imports remain standalone — no upward discovery (asserted both ways on the seam).
- **`definitions`**: `.ysls.json` file paths or inline objects, converted once (`toDeclarations`) into external function signatures — commands return unconstrained (`any`), functions carry their declared return type. A declared function passes signature checking; a mis-typed call fails the build with the type checker's diagnostic (YS0050 — the type checker's code for a signature violation; YS0014 is the arity variant).
- **`compilerOptions`**: passthrough merged over the pinned project's own `compilerOptions` (plugin values win). Narrow on purpose: `diagnosticsSeverity` is the one upstream compiler option with compile-time effect in this compiler; the surface grows only when the core grows.
- **`include`/`exclude`**: glob-or-RegExp filters layered over extension matching — unanchored picomatch-style (`**` spans segments, `*`/`?` within one; RegExp tests the path; arrays OR-ed). Excluded files never load; with include set, only matches load.

The earlier deferred frame-source polish (project-path error frames quoting the project JSON) remains recorded for the docs ticket — the error path is unchanged and no criterion covers it.

- [x] A pinned `.yarn` import compiles with the project's base language and compiler options (project metadata asserted on the emitted module; standalone asserted bare)
- [x] Inline-object definitions reach the compilation job; a mis-typed call to a declared function surfaces the type checker's diagnostic and fails the build
- [x] `.ysls.json`-shaped file definitions behave identically to inline objects (same converter, one contract)
- [x] Include/exclude filters include and exclude as configured (unanchored globs, layered over extension matching)
- [x] Unpinned imports remain standalone (no upward discovery)
- [x] Full suite green — 656 tests, 655 pass, 0 fail, 1 skip; lint + ts-check clean
