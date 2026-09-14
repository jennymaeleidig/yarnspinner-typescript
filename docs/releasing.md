# Releasing

Two packages ship in lockstep from this repository: `yarnspinner-typescript`
(the root package — ESM, CommonJS, and declarations compiled from `src/`) and
`yarnspinner-vite-plugin` (`packages/vite-plugin` — ESM only, linked to the
core package by peer dependency). A release publishes both, in that order, and
tags the commit that carries the version bump.

Publishing is one-way in the ways that matter: a version can be unpublished
only within 72 hours of publishing, the number stays burned afterwards, and a
version anyone depends on cannot be removed at all (npm's
[unpublish policy](https://docs.npmjs.com/policies/unpublish)). Treat the
steps below as pre-flight, not ceremony.

## The gate

[`scripts/check-versions.mjs`](../scripts/check-versions.mjs) holds three
invariants a publish must satisfy:

- the two `package.json` versions agree;
- the plugin's `peerDependencies.yarnspinner-typescript` range admits the root
  version being published;
- [`CHANGELOG.md`](../CHANGELOG.md) carries a `## <version>` heading.

It runs from both packages' `prepublishOnly` hooks, from the test suite
([`src/tests/publishMetadata.test.ts`](../src/tests/publishMetadata.test.ts)),
and standalone as `npm run check:versions`. A peer range is what makes the
publish order below matter: publishing the plugin first would put a range on
the registry that no published version of the core package satisfies.

## Pre-flight

1. `npm run check:versions` — the gate, on its own.
2. `npm test` — `pretest` runs `format:check` and `build:all`, so this builds
   both packages before the suite runs.
3. `npm pack --dry-run` and `npm pack --dry-run -w yarnspinner-vite-plugin` —
   confirm what the tarballs carry. At 1.0.0 that was 291 files / 542 kB and
   15 files / 13.2 kB. npm adds `LICENSE` and `README.md` on its own.
4. Read the diff and the changelog heading. The changelog is the only
   release-notes source, and nothing generates it.

## Authentication

The account that owns both packages uses 2FA _auth-and-writes_, so a read-only
check can pass while a publish still fails:

```
npm whoami      → jennymaeleidig
npm publish     → 401 EOTP: This operation requires a one-time password
```

Two ways through:

- **Interactive**: `npm publish --otp=<6-digit code>`. OTPs live around 30
  seconds, so pre-build (`npm run build:all`) and publish with
  `--ignore-scripts` to keep the window short.
- **Unattended**: create a granular access token with _read and write_ on both
  packages and _bypass 2FA_ enabled, and place it in `~/.npmrc` as
  `//registry.npmjs.org/:_authToken=...`. Publishes then need no OTP.

npm's browser fallback replaces neither: it masks the auth URL
(`https://www.npmjs.com/auth/cli/***`) whenever stdout is not a TTY, so a
piped or agent-driven publish gets no usable link.

## Publishing

```bash
npm publish                              # core package first
npm publish -w yarnspinner-vite-plugin   # then the plugin
```

`prepublishOnly` re-runs the gate and the build, so a plain `npm publish` is
correct against a clean tree. `--ignore-scripts` skips the build — use it only
against a `dist/` that was just built.

Check each command's exit status on its own. Piping into `tail` reports the
filter's status, so a failed publish can look like a success.

## Verifying

Registry reads lag a publish by up to about a minute. Right after a successful
publish `npm view <name>` can still return `E404`; the packument is the honest
check:

```bash
curl -s https://registry.npmjs.org/yarnspinner-typescript | head -c 200
```

Then install the published artifact somewhere disposable and exercise the
export map — the surface the tarball actually promises:

```bash
D=$(mktemp -d) && cd "$D" && npm init -y && npm i yarnspinner-typescript@<version>
node --input-type=module -e "import { Dialogue } from 'yarnspinner-typescript'"
node -e "require('yarnspinner-typescript')"
node --input-type=module -e "import * as nodeFs from 'yarnspinner-typescript/node'"
```

## Tagging

```bash
git tag -a v<version> -m "<package> <version> — <headline>"
git push origin main v<version>
```

Confirm the push landed rather than trusting the exit code. An annotated tag
needs dereferencing to show the commit it marks:

```bash
gh api repos/jennymaeleidig/yarnspinner-typescript/git/refs/tags/v<version> --jq .object.sha
gh api repos/jennymaeleidig/yarnspinner-typescript/git/tags/<tag-object-sha> --jq .object.sha
```

The second SHA is the commit and must equal `git rev-parse HEAD`.

## Recovering

- **Wrong contents published**: `npm unpublish <name>@<version>` inside the
  72-hour window, then publish a corrected version under a **new** number —
  the burned number cannot be reused.
- **Version with dependents**: it cannot be unpublished. Add
  `npm deprecate <name>@<version> "<reason>"` and ship a patch.
- **Wrong tag pushed**: delete the remote tag, fix, re-tag.

## Known constraint

The GitHub repository is private (re-checked at the 1.0.0 release). Published
version metadata is immutable, so the `repository`, `homepage`, and `bugs`
fields shipped in 1.0.0 point at URLs that 404 for anonymous visitors. Making
the repository public resolves those links unchanged; otherwise correct the
three fields in the next version.
