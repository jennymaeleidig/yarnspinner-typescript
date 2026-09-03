# 01: Workspace editor project

**What to build:** a root `.yarnproject` (format version 4) so the Yarn
Spinner VS Code extension treats this workspace as a real project —
`sourceFiles` scoped to this repo's authored content (`examples/yarn/**/*.yarn`),
defensive `excludeFiles` for build output per the upstream troubleshooting
guidance, `baseLanguage` declared — plus a `.vscode/extensions.json`
recommending `SecretLab.yarn-spinner`, and a short README note so the setup is
discoverable. Vendored conformance fixtures (`test/fixtures/**`) stay out of
`sourceFiles` on purpose: they are byte-compared against upstream and must
never be flagged or auto-fixed by editor tooling.

Format reference: [project files docs](https://docs.yarnspinner.dev/write-yarn-scripts/yarn-spinner-editor/yarn-spinner-project-files),
schema: <https://schemas.yarnspinner.dev/yarnproject.schema.json>.

**Blocked by:** — (spun out of `future-work.md` ahead of ticket 53)

Type: task

**Status:** resolved

- [x] Root `.yarnproject`, v4 fields validated against the upstream schema
- [x] `.vscode/extensions.json` recommends `SecretLab.yarn-spinner`
- [x] README documents the editor setup

## Landing notes (ticket 01)

- **`yarn-spinner-runner-ts.yarnproject`** (repo root): `projectFileVersion: 4`,
  `sourceFiles: ["examples/yarn/**/*.yarn"]`, `excludeFiles` for
  `node_modules`/`dist`/`dist-demo` (defensive — the upstream docs'
  duplicate-node troubleshooting pattern), `baseLanguage: "en"`,
  `projectName` set. Fields checked field-by-field against
  `yarnproject.schema.json` (v4).
- **`.vscode/extensions.json`** recommends `SecretLab.yarn-spinner` (marketplace
  ID verified). **Heads-up:** `.gitignore` ignores `.vscode/` wholesale, so this
  file exists locally but is not committed. Other contributors get the setup
  via the README note; if the recommendation should be committed for everyone,
  `git add -f .vscode/extensions.json` (or narrow the ignore to
  `.vscode/*` + `!extensions.json`) — left to the maintainer, not forced.
- **README**: "Editing the Yarn scripts" subsection under Browser Demo —
  what the project file scopes, why fixtures are excluded, where the
  extension comes from.
- No code touched, no runtime surface changed; suite not run (config-only).

## Comments

- **User-verified in the field**: Yarn Spinner extension installed, workspace
  reopened — `.yarnproject` picked up automatically, error checking scopes to
  `examples/yarn/` as designed. (Ticket 01's acceptance was verified by use,
  not just config review.)
