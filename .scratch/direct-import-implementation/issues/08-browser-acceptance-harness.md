# 08: Browser demo as acceptance harness + examples cleanup

**What to build:** The browser demo consumes the published package: the package-name source alias is gone, imports resolve through the build output (root and the React subpath), and dialogue content loads via direct import through the plugin from the shared demo project — no inline template strings, no manual compile calls. A test builds the browser demo end-to-end through the real plugin and asserts success, making it the acceptance harness for the public surface and the plugin at once. The vestigial re-export stubs and the orphaned scene asset are deleted.

**Blocked by:** 02 (plugin exists), 04 (project import contract), 07 (shared content exists).

**Status:** ready-for-agent

- [ ] No source aliasing: the demo resolves the package name through the published surface
- [ ] Dialogue runs from the shared content loaded via plugin direct import
- [ ] End-to-end test builds the demo through the real plugin and asserts success
- [ ] Re-export stubs and the orphaned scene asset are deleted with no dangling references
- [ ] Demo build and full suite green
