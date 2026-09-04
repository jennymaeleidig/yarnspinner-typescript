# 05: Plugin options surface

**What to build:** The plugin accepts its full option shape: a `project` option that pins an explicit `.yarnproject` as compilation context for `.yarn` imports (base language, definitions, compiler options flow into the compilation job — no upward discovery); `definitions` accepting `.ysls.json`-shaped files or inline objects so build-time signature checking sees the host's `Library` surface; compiler-options passthrough; and `include`/`exclude` filters layered over extension matching. Verified through the emitted-module seam: a pinned import compiles with project context, a declared host function passes signature checking, and an undeclared one produces the expected diagnostic.

**Blocked by:** 04 (`.yarnproject` contract — project loading must exist to pin).

**Status:** ready-for-agent

- [ ] A pinned `.yarn` import compiles with the project's base language and compiler options
- [ ] Inline-object definitions reach the compilation job; an undeclared host function surfaces the expected diagnostic
- [ ] `.ysls.json`-shaped file definitions behave identically to inline objects
- [ ] Include/exclude filters include and exclude as configured
- [ ] Unpinned imports remain standalone (no upward discovery)
- [ ] Full suite green
