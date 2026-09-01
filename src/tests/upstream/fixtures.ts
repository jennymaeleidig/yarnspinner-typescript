/**
 * Discovery helpers for the vendored upstream conformance corpus at
 * `test/fixtures/upstream/YarnSpinner/Tests` (pinned: v3.2.2 — see the
 * PROVENANCE.md next to the fixtures). Test-side filesystem access only;
 * the library itself performs no I/O (coding standard §2).
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/** Directory of the compiled test file (dist/tests/upstream/). */
const HERE = dirname(fileURLToPath(import.meta.url));

/** …/test/fixtures/upstream/YarnSpinner/Tests — three levels up from dist/tests/upstream. */
export const UPSTREAM_TESTS_DIR = join(HERE, "..", "..", "..", "test", "fixtures", "upstream", "YarnSpinner", "Tests");

export function listYarnFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
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
  return readFileSync(join(UPSTREAM_TESTS_DIR, relPath), "utf8");
}
