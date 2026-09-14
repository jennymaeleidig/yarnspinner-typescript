#!/usr/bin/env node
// SPDX-License-Identifier: CC0-1.0
//
// Publish gate for the two packages that ship in lockstep:
// `yarnspinner-typescript` (repo root) and `yarnspinner-vite-plugin`
// (`packages/vite-plugin`). Three things must hold before either reaches the
// registry — the two versions agree, the plugin's peer range admits the root
// version published alongside it, and CHANGELOG.md carries a heading for that
// version. The peer range is what makes publish *order* matter: the plugin's
// range names a root version, so publishing the plugin first would put a range
// on the registry that nothing satisfies yet.
//
// Run via `npm run check:versions`, from both packages' prepublishOnly hooks,
// and from src/tests/publishMetadata.test.ts. Problems are collected and
// returned rather than thrown, so the test can assert on them.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT_PACKAGE = "yarnspinner-typescript";
export const PLUGIN_PACKAGE = "yarnspinner-vite-plugin";
export const PLUGIN_DIR = "packages/vite-plugin";

export const parseVersion = (text) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Comparators the manifests in this repo use — caret, tilde, exact, `>=`, `*`
// — joined with `||`. A form outside that set returns null, which the gate
// reports as unsupported rather than treating as a pass: a range this script
// cannot read must never look satisfied.
const satisfiesAlternative = (version, alternative) => {
  if (alternative === "" || alternative === "*") return true;

  const match = /^(\^|~|>=|=)?(\d+)\.(\d+)\.(\d+)$/.exec(alternative);
  if (!match) return null;

  const target = [Number(match[2]), Number(match[3]), Number(match[4])];
  const ordering = compare(version, target);

  switch (match[1] ?? "") {
    case "^":
      // npm's caret pins the major, and for 0.x also the minor (0.0.x the patch).
      if (version[0] !== target[0]) return false;
      if (target[0] === 0 && version[1] !== target[1]) return false;
      if (target[0] === 0 && target[1] === 0 && version[2] !== target[2])
        return false;
      return ordering >= 0;
    case "~":
      return (
        version[0] === target[0] && version[1] === target[1] && ordering >= 0
      );
    case ">=":
      return ordering >= 0;
    default:
      return ordering === 0;
  }
};

export const satisfiesRange = (version, range) => {
  let unsupported = false;

  for (const alternative of String(range).split("||")) {
    const result = satisfiesAlternative(version, alternative.trim());
    if (result === null) unsupported = true;
    else if (result) return true;
  }

  return unsupported ? null : false;
};

const hasChangelogHeading = (changelog, version) =>
  changelog
    .split("\n")
    .some(
      (line) => line === `## ${version}` || line.startsWith(`## ${version} `),
    );

export function checkPublishMetadata(repoRoot) {
  const problems = [];

  const readText = (relative) => {
    try {
      return readFileSync(join(repoRoot, relative), "utf8");
    } catch (error) {
      problems.push(`cannot read ${relative}: ${error.message}`);
      return null;
    }
  };

  const readPackage = (relative) => {
    const text = readText(relative);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      problems.push(`${relative} is not valid JSON: ${error.message}`);
      return null;
    }
  };

  const root = readPackage("package.json");
  const plugin = readPackage(join(PLUGIN_DIR, "package.json"));
  if (!root || !plugin) return problems;

  const version = parseVersion(root.version);
  if (!version) {
    problems.push(
      `package.json version "${root.version}" is not major.minor.patch`,
    );
  }

  if (root.version !== plugin.version) {
    problems.push(
      `${PLUGIN_PACKAGE} is ${plugin.version} but ${ROOT_PACKAGE} is ${root.version} — the two ship in lockstep`,
    );
  }

  const range = plugin.peerDependencies?.[ROOT_PACKAGE];
  if (typeof range !== "string") {
    problems.push(
      `${PLUGIN_PACKAGE} declares no peer dependency on ${ROOT_PACKAGE}`,
    );
  } else if (version) {
    const satisfied = satisfiesRange(version, range);
    if (satisfied === null) {
      problems.push(
        `unsupported comparator in peer range "${range}" — extend satisfiesRange() in scripts/check-versions.mjs`,
      );
    } else if (!satisfied) {
      problems.push(
        `plugin peer range "${range}" does not admit ${ROOT_PACKAGE}@${root.version}`,
      );
    }
  }

  const changelog = readText("CHANGELOG.md");
  if (changelog !== null && !hasChangelogHeading(changelog, root.version)) {
    problems.push(`CHANGELOG.md has no "## ${root.version}" heading`);
  }

  return problems;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  // Resolved from this script's own path, not the cwd: the plugin's
  // prepublishOnly runs this from packages/vite-plugin.
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const problems = checkPublishMetadata(repoRoot);

  if (problems.length > 0) {
    console.error("Publish metadata check failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    "Publish metadata OK: versions agree, the plugin's peer range admits the root version, CHANGELOG.md has a heading for it.",
  );
}
