// SPDX-License-Identifier: CC0-1.0
// The publish gate — scripts/check-versions.mjs — is the seam these tests pin.
// It guards both packages' prepublishOnly hooks and the suite, so a gate that
// passes vacuously, or that cannot read a range it is handed, would let two
// lockstep packages reach the registry with disagreeing versions. The real
// manifests must pass it; a flawed fixture must fail it with one message per
// fault; the range matcher must answer every comparator form npm accepts in
// this repo, and report the forms it cannot read rather than passing them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// dirname is dist/tests in the compiled run, so two levels up is the root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The gate is plain ESM outside src/, loaded by path: it sits between the
// manifests and the registry with no build step in between.
const gate: {
  checkPublishMetadata: (repoRoot: string) => string[];
  parseVersion: (text: string) => number[] | null;
  satisfiesRange: (version: number[], range: string) => boolean | null;
} = await import(
  pathToFileURL(join(ROOT, "scripts", "check-versions.mjs")).href
);

const ROOT_PACKAGE = "yarnspinner-typescript";
const PLUGIN_PACKAGE = "yarnspinner-vite-plugin";

interface Fixture {
  rootVersion: string;
  pluginVersion: string;
  peerRange: string | null;
  changelog: string;
}

/** A repo-shaped fixture: two manifests plus a changelog, nothing else. */
const writeFixture = (
  // node:test cleanup hooks take no arguments; the fixture dir is created here.
  t: { after: (fn: () => void) => void },
  fixture: Fixture,
): string => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-publish-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const pluginDir = join(dir, "packages", "vite-plugin");
  mkdirSync(pluginDir, { recursive: true });

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: ROOT_PACKAGE, version: fixture.rootVersion }),
  );
  writeFileSync(
    join(pluginDir, "package.json"),
    JSON.stringify({
      name: PLUGIN_PACKAGE,
      version: fixture.pluginVersion,
      ...(fixture.peerRange === null
        ? {}
        : { peerDependencies: { [ROOT_PACKAGE]: fixture.peerRange } }),
    }),
  );
  writeFileSync(join(dir, "CHANGELOG.md"), fixture.changelog);

  return dir;
};

const SOUND_FIXTURE: Fixture = {
  rootVersion: "1.2.0",
  pluginVersion: "1.2.0",
  peerRange: "^1.0.0",
  changelog: "# Changelog\n\n## 1.2.0 — current\n",
};

test("the manifests that ship pass the gate", () => {
  assert.deepEqual(gate.checkPublishMetadata(ROOT), []);
});

test("a sound fixture passes, so the failure tests below are not noise", (t) => {
  assert.deepEqual(
    gate.checkPublishMetadata(writeFixture(t, SOUND_FIXTURE)),
    [],
  );
});

test("version drift between the two packages is reported", (t) => {
  const dir = writeFixture(t, { ...SOUND_FIXTURE, pluginVersion: "1.1.0" });
  const problems = gate.checkPublishMetadata(dir);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /lockstep/);
  assert.match(problems[0], /1\.1\.0/);
  assert.match(problems[0], /1\.2\.0/);
});

test("a peer range that excludes the root version is reported", (t) => {
  const dir = writeFixture(t, {
    ...SOUND_FIXTURE,
    rootVersion: "2.0.0",
    pluginVersion: "2.0.0",
    peerRange: "^1.0.0",
    changelog: "# Changelog\n\n## 2.0.0 — current\n",
  });
  const problems = gate.checkPublishMetadata(dir);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not admit/);
});

test("a missing peer dependency is reported, not skipped", (t) => {
  const dir = writeFixture(t, { ...SOUND_FIXTURE, peerRange: null });
  const problems = gate.checkPublishMetadata(dir);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /no peer dependency/);
});

test("an unsupported comparator is reported rather than counted as satisfied", (t) => {
  const dir = writeFixture(t, { ...SOUND_FIXTURE, peerRange: ">1.0.0" });
  const problems = gate.checkPublishMetadata(dir);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /unsupported comparator/);
});

test("a version with no changelog heading is reported", (t) => {
  const dir = writeFixture(t, {
    ...SOUND_FIXTURE,
    changelog: "# Changelog\n\n## 1.1.0 — previous\n",
  });
  const problems = gate.checkPublishMetadata(dir);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /CHANGELOG\.md has no "## 1\.2\.0" heading/);
});

test("every fault is reported in one pass, not just the first", (t) => {
  const dir = writeFixture(t, {
    rootVersion: "1.2.0",
    pluginVersion: "1.1.0",
    peerRange: "^9.0.0",
    changelog: "# Changelog\n",
  });
  const problems = gate.checkPublishMetadata(dir);

  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /lockstep/);
  assert.match(problems.join("\n"), /does not admit/);
  assert.match(problems.join("\n"), /CHANGELOG\.md has no/);
});

test("manifest and changelog reads that fail are reported, not thrown", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-publish-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const problems = gate.checkPublishMetadata(dir);

  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /cannot read package\.json/);
  assert.match(
    problems.join("\n"),
    /cannot read packages\/vite-plugin\/package\.json/,
  );
});

test("the range matcher answers npm's comparator forms", () => {
  const cases: Array<[string, string, boolean | null]> = [
    ["1.2.3", "^1.0.0", true],
    ["1.0.0", "^1.0.0", true],
    ["2.0.0", "^1.0.0", false],
    ["0.9.0", "^1.0.0", false],
    // caret pins the minor under 0.x, and the patch under 0.0.x
    ["0.2.9", "^0.2.0", true],
    ["0.3.0", "^0.2.0", false],
    ["0.0.1", "^0.0.1", true],
    ["0.0.5", "^0.0.1", false],
    // unions, as the plugin's vite peer range uses
    ["5.4.3", "^5.0.0 || ^6.0.0 || ^7.0.0", true],
    ["6.0.0", "^5.0.0 || ^6.0.0 || ^7.0.0", true],
    ["8.0.0", "^5.0.0 || ^6.0.0 || ^7.0.0", false],
    ["1.0.0", "1.0.0", true],
    ["1.0.1", "1.0.0", false],
    ["1.0.9", "~1.0.0", true],
    ["1.1.0", "~1.0.0", false],
    ["2.0.0", ">=1.0.0", true],
    ["0.9.0", ">=1.0.0", false],
    ["1.0.0", "*", true],
    // a form the matcher cannot read is null — never a silent pass
    ["1.0.0", ">1.0.0", null],
    ["9.9.9", ">9.0.0", null],
    // …and an unreadable alternative does not veto a readable match beside it
    ["1.0.0", "^1.0.0 || >9.0.0", true],
    ["1.0.0", ">9.0.0 || ^1.0.0", true],
  ];

  for (const [version, range, expected] of cases) {
    const parsed = gate.parseVersion(version);
    assert.notEqual(parsed, null, `${version} should parse`);
    assert.equal(
      gate.satisfiesRange(parsed as number[], range),
      expected,
      `${version} satisfies "${range}"`,
    );
  }
});

test("a version that is not major.minor.patch is reported", (t) => {
  const dir = writeFixture(t, { ...SOUND_FIXTURE, rootVersion: "1.2" });
  const problems = gate.checkPublishMetadata(dir);

  assert.match(problems.join("\n"), /is not major\.minor\.patch/);
});
