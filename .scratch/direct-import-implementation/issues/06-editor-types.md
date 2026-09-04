# 06: Editor types via the `./client` types subpath

**What to build:** The plugin package ships an ambient declaration file exposed as a `./client` types subpath, declaring the three import shapes (`.yarn`, `.yarn?raw`, `.yarnproject`) to match the implemented contracts. A host enables it with a single triple-slash reference in an ambient types file, and all three imports type-check in an editor; the zero-dependency paste-in snippet is documented as the alternative. Verified by a type-level test (or type-check fixture) that exercises the reference path and the snippet path.

**Blocked by:** 03 (`.yarn` contract shapes), 04 (`.yarnproject` contract shapes).

**Status:** ready-for-agent

- [ ] `./client` types subpath resolves from the plugin package
- [ ] All three import shapes type-check via the triple-slash reference path
- [ ] The paste-in snippet type-checks standalone, without referencing the plugin package
- [ ] Declared shapes match the implemented runtime contracts exactly
- [ ] Full suite green
