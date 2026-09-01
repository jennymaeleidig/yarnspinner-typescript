# Upstream fixture provenance

Source: [YarnSpinnerTool/YarnSpinner](https://github.com/YarnSpinnerTool/YarnSpinner)

- **Tag**: `v3.2.2`
- **Commit**: `5b3a4ff2d24e4f727e3f90fee5d8ce637474c305` ("Update changelog for v3.2.2 release")
- **Vendored**: `Tests/` and `YarnSpinner.Tests/TestPlan/YarnSpinnerTestPlan.g4`

## Exclusions

- `Tests/TestCases/Duplicates/` (lipsum1–3.yarn, ~6 MB of generated duplicate
  content): used only by upstream's multi-file project-merge tests, which need
  the multi-file `compile()` surface (roadmap phase 3). Re-copy from the
  pinned tag when adopting that phase.
- `Tests/Upgrader/` fixtures (referenced by `UpgraderTests`): out of scope —
  we target Yarn 3.x only.
- Generated ANTLR parser/lexer sources for the testplan grammar: we
  hand-write the parser instead (see `src/tests/upstream/testPlan.ts`); the
  `.g4` grammar is vendored as the normative reference.

## Refresh

```
git clone --depth 1 --branch v3.2.2 https://github.com/YarnSpinnerTool/YarnSpinner.git
cp -R YarnSpinner/Tests <this dir>/YarnSpinner/Tests
cp YarnSpinner/YarnSpinner.Tests/TestPlan/YarnSpinnerTestPlan.g4 <this dir>/YarnSpinner/
```

## License

The vendored files are from Yarn Spinner, © Yarn Spinner Pty. Ltd., Secret Lab
Pty. Ltd., and Yarn Spinner contributors, licensed under the MIT License (see
`YarnSpinner/LICENSE.md`). They are unmodified except for the exclusions above.

Upstream remains the source of truth for conformance behavior (see
`docs/coding-standards.md` §1): refresh from the pinned tag, never edit the
vendored files by hand.
