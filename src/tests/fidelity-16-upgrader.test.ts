// SPDX-License-Identifier: CC0-1.0
/**
 * Upstream fidelity ticket 16 — the syntax-upgrader surface, ported from
 * upstream YarnSpinner.Tests/UpgraderTests.cs (v3.2.2).
 *
 * Parity note: upstream 3.2.2 REMOVED the v1→v2 language upgrader
 * (CHANGELOG 2.4.1: "Removed the Yarn Spinner v1 to v2 upgrader"; the
 * TestUpgradingFiles theory is skipped upstream and the Upgrader/V1toV2
 * fixtures no longer exist). What remains upstream — and what this file
 * pins — is the LanguageUpgrader replacement machinery
 * (`LanguageUpgrader.ApplyReplacements`, `TextReplacement`) and an
 * `Upgrade` that throws for every upgrade type, exactly as upstream does.
 *
 * Every expectation mirrors the upstream tests' inputs and assertions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  languageUpgrader,
  type TextReplacement,
  type UpgradeType,
} from "../index.js";

function replacement(
  start: number,
  originalText: string,
  replacementText: string,
): TextReplacement {
  return { start, originalText, replacementText };
}

// ── UpgraderTests.TestTextReplacement ───────────────────────────────────────

test("port: TestTextReplacement — replacements apply in start order with offset tracking", () => {
  const text = "Keep delete keep\nreplace keep";
  const expectedReplacement = "Keep keep\nnew keep add";

  const replacements = [
    replacement(5, "delete ", ""),
    replacement(17, "replace", "new"),
    replacement(29, "", " add"),
  ];

  const replacedText = languageUpgrader.applyReplacements(text, replacements);

  assert.equal(replacedText, expectedReplacement);
});

// ── UpgraderTests.TestInvalidReplacementThrows ──────────────────────────────

test("port: TestInvalidReplacementThrows — a replacement whose expected text is absent throws", () => {
  const text = "Keep keep";

  const replacements = [
    // the replacement expects to see "delete " here, but it will see "keep"
    replacement(5, "delete ", ""),
  ];

  assert.throws(
    () => languageUpgrader.applyReplacements(text, replacements),
    RangeError,
  );
});

// ── UpgraderTests.TestOutOfRangeReplacementThrows ───────────────────────────

test("port: TestOutOfRangeReplacementThrows — a start past the text's length throws", () => {
  const text = "Test";

  const replacements = [
    // This replacement starts outside the text's length
    replacement(8, "Test", ""),
  ];

  assert.throws(
    () => languageUpgrader.applyReplacements(text, replacements),
    RangeError,
  );
});

// ── LanguageUpgrader.Upgrade: upstream removed the v1→v2 upgrader ───────────

test("Upgrade reports every upgrade type as unsupported, like upstream 3.2.2", () => {
  // Upstream 3.2.2's LanguageUpgrader.Upgrade has only a `default` branch:
  // "Upgrade type {type} is not supported." (the v1→v2 upgrader was removed
  // in upstream 2.4.1; the port keeps parity, not a re-invention).
  const types: UpgradeType[] = ["Version1to2"];
  for (const upgradeType of types) {
    assert.throws(
      () => languageUpgrader.upgrade({ upgradeType, files: [] }),
      (e: unknown) =>
        e instanceof Error &&
        e.message === `Upgrade type ${upgradeType} is not supported.`,
    );
  }
});
