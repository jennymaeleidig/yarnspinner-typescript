# 02: YarnProject loader

**What to build:** a library module that turns a `.yarnproject` into a
`compile()` call — parse and validate the JSON (v4 schema:
<https://schemas.yarnspinner.dev/yarnproject.schema.json>; accept
`projectFileVersion` 2 like upstream, reject 3 as the dead dev version),
resolve `sourceFiles` / `excludeFiles` glob patterns relative to the project
file's location, and feed the resulting `{name, source}` files to `compile()`
(ticket 49 seam). Map `compilerOptions` onto this compiler's options where an
equivalent exists (`requireVariableDeclarations` has none yet — surface the
gap as a diagnostic or ticket note, don't silently ignore); surface unknown
fields as diagnostics per the schema's `additionalProperties: false`.

The seam must be injectable: file access goes through a narrow interface
(list/read by path), with Node `fs` as the default provider — the core never
imports `fs`, so the loader works under Vite/Next/SvelteKit via a custom
provider. Include a `listSources()` debug helper (upstream `ysc list-sources`
equivalent) used by the tests. The project's `localisation` map should
plumb into the CSV text-provider surface from ticket 51 (`strings` CSV paths,
`assets` dirs), and `definitions` (.ysls.json) is explicitly deferred.

**Blocked by:** — (independent of the 53 release wave; no breaking surface)

**Status:** ready-for-agent

- [ ] Parse + validate v4 (and legacy v2) project files with diagnostics
- [ ] Glob resolution behind an injectable file-access seam; Node default
- [ ] Resolved files feed `compile()`; `compilerOptions` mapped or diagnosed
- [ ] `localisation` map wires into the CSV text provider path
- [ ] `listSources()` helper + suite green
- [ ] Acceptance: loads the vendored upstream fixture
  `test/fixtures/upstream/YarnSpinner/Tests/Projects/Space/Space.yarnproject`
  (the only upstream-style project in the corpus) — `sourceFiles` resolve to
  `Sally.yarn` + `Ship.yarn` and the project compiles; its `localisation`
  references `../German.csv`, which was not vendored, so the loader must
  diagnose the missing strings file rather than fail silently — that
  diagnostic is part of the acceptance.
