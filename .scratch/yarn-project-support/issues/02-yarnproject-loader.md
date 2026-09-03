# 02: YarnProject loader core

**What to build:** point the loader at an upstream-style `.yarnproject` and
get a compiled result in one call — parse and validate the project file
(v4 schema: <https://schemas.yarnspinner.dev/yarnproject.schema.json>; accept
`projectFileVersion` 2 like upstream, reject 3 as the dead dev version),
resolve `sourceFiles`/`excludeFiles` globs relative to the project file's
location behind an injectable file-access seam (Node `fs` ships only as the
default provider; the core never imports `fs`), and feed the resolved
`{name, source}` files to `compile()` (ticket 49 seam). Map `compilerOptions`
onto this compiler's options where an equivalent exists
(`requireVariableDeclarations` has none yet — surface the gap as a diagnostic
or ticket note, don't silently ignore); unknown fields produce diagnostics per
the schema's `additionalProperties: false`. Referenced localisation strings
files that don't exist are diagnosed as part of project validation. Include a
`listSources()` debug helper (upstream `ysc list-sources` equivalent) used by
the tests. `definitions` (.ysls.json) is explicitly deferred.

**Blocked by:** None (can start immediately)

Type: task

**Status:** ready-for-agent

- [ ] Parse + validate v4 (and legacy v2) project files with diagnostics; v3 rejected
- [ ] Glob resolution relative to the project location behind an injectable
      file-access seam; Node default provider
- [ ] Resolved files feed `compile()`; `compilerOptions` mapped or diagnosed;
      unknown fields diagnosed
- [ ] Referenced-but-missing strings files diagnosed during validation
- [ ] `listSources()` helper + suite green
- [ ] Acceptance: loads the vendored upstream Space project fixture — its
      `sourceFiles` resolve to the two `.yarn` scripts and the project
      compiles; its unvendored `German.csv` reference exercises the
      missing-strings diagnostic
