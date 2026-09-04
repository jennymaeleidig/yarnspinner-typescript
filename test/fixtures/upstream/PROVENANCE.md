# Upstream fixture provenance

The conformance corpus is the upstream
[YarnSpinnerTool/YarnSpinner](https://github.com/YarnSpinnerTool/YarnSpinner)
repo, mounted as a git submodule at `test/fixtures/upstream/YarnSpinner/`.

- **Pin**: tag `v3.2.2` — commit
  `5b3a4ff2d24e4f727e3f90fee5d8ce637474c305` ("Update changelog for v3.2.2
  release").
- **Full repo, no trimming**: `Tests/`, the C# source, `Duplicates/`
  (~6 MB, unused until the multi-file `compile()` phase) and the Yarn 2.x /
  Upgrader fixtures all ride along. The harness reads `Tests/`,
  `YarnSpinner.Diagnostics/Definitions/` (the authoritative per-code YS00xx
  registry) and `YarnSpinner.Tests/TestPlan/YarnSpinnerTestPlan.g4` (the
  normative testplan grammar).
- **Fresh clone**: `git clone --recurse-submodules`; existing clone:
  `git submodule update --init --recursive`. The suite hard-fails with this
  recovery command when the submodule is absent — conformance is never
  silently skipped.

## Bumping the pin

Run the project's `bump-upstream` skill (`.pi/skills/bump-upstream/SKILL.md`):
it fetches inside the submodule, checks out the target ref, runs the
conformance suite and triages every failure into gap tickets. Never edit
submodule files by hand; upstream remains the source of truth (see
`docs/coding-standards.md` §1).

## License

The submodule's files are from Yarn Spinner, © Yarn Spinner Pty. Ltd., Secret
Lab Pty. Ltd., and Yarn Spinner contributors, licensed under the MIT License
(see `LICENSE.md` inside the submodule).
