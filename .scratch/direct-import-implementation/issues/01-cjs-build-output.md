# 01: CJS build output for the export map

**What to build:** A CJS consumer can `require()` the package: every `require` condition in the export map (root, the React subpath, the Node subpath) resolves to a CommonJS artifact the build actually produces, with per-condition type declarations. A test resolves and executes each `require` condition, so the export map can never again name artifacts the build doesn't emit. The ESM build stays untouched.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Every `require` condition in the export map resolves to an existing file after a clean build
- [x] Each CJS entry executes and exposes the same public surface as its ESM counterpart
- [x] Per-condition type declarations resolve for CJS consumers in an editor (verified with a nodenext probe: require → .d.cts, type-matched against the ESM surface)
- [x] A test fails if the export map names an artifact the build does not produce (dist/tests/cjsExports.test.js — pins resolve+execute+surface-parity for all three subpaths)
- [x] Full suite green; no regression in ESM output (635 pass, 0 fail, 1 skipped; lint clean; ts-check clean)
