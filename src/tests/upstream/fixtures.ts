// SPDX-License-Identifier: CC0-1.0
/**
 * Discovery helpers for the upstream conformance corpus, mounted as a git
 * submodule at `test/fixtures/upstream/YarnSpinner` (pinned: v3.2.2 — see
 * PROVENANCE.md next to it; bumps go through the bump-upstream skill).
 * Test-side filesystem access only; the library itself performs no I/O
 * (coding standard §2).
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/** Directory of the compiled test file (dist/tests/upstream/). */
const HERE = dirname(fileURLToPath(import.meta.url));

/** …/test/fixtures/upstream/YarnSpinner/Tests — three levels up from dist/tests/upstream. */
export const UPSTREAM_TESTS_DIR = join(
  HERE,
  "..",
  "..",
  "..",
  "test",
  "fixtures",
  "upstream",
  "YarnSpinner",
  "Tests",
);

/**
 * The corpus is a git submodule; a plain clone leaves the mount empty.
 * Fixture discovery hard-fails with the recovery command — never silently
 * skip conformance.
 */
export function ensureUpstreamSubmodule(): void {
  if (!existsSync(UPSTREAM_TESTS_DIR)) {
    throw new Error(
      `upstream fixture submodule missing at ${UPSTREAM_TESTS_DIR} — run \`git submodule update --init --recursive\` to restore it (conformance is never silently skipped)`,
    );
  }
}

export function listYarnFiles(dir: string): string[] {
  ensureUpstreamSubmodule();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yarn") && !f.endsWith(".upgraded.yarn"))
    .sort();
}

export function listTestCases(): string[] {
  return listYarnFiles(join(UPSTREAM_TESTS_DIR, "TestCases"));
}

export function listParseFailures(): string[] {
  return listYarnFiles(join(UPSTREAM_TESTS_DIR, "TestCases", "ParseFailures"));
}

export function readFixture(relPath: string): string {
  ensureUpstreamSubmodule();
  return readFileSync(join(UPSTREAM_TESTS_DIR, relPath), "utf8");
}
