// SPDX-License-Identifier: CC0-1.0
/**
 * Culture-independence port of the upstream conformance loop
 * (YarnSpinner.Tests: `DialogueTests` runs numeric formatting across 14
 * cultures). The library must produce identical, dot-decimal composed text
 * regardless of host locale.
 *
 * Ported as an invariant check: the culture-sensitive APIs are patched to
 * throw, then numeric stories are driven through the public seam
 * (parseYarn → compile → Dialogue). If the library ever touches a
 * culture-sensitive formatter, the run fails — no matter what locale the
 * host machine uses.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYarn } from "../parse/parser.js";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";

function withCultureSensitiveApisBlocked<T>(fn: () => T): T {
  const boom = () => {
    throw new Error("culture-sensitive API used by the runtime");
  };
  const numberToLocale = Number.prototype.toLocaleString;
  const stringToLocale = String.prototype.toLocaleString;
  const origNumberFormat = Intl.NumberFormat;
  const guardedNumberFormat = function (
    ...args: Parameters<typeof Intl.NumberFormat>
  ) {
    if (args.length === 0 || args[0] == null) {
      throw new Error("Intl.NumberFormat used without an explicit locale");
    }
    return new origNumberFormat(...args);
  } as unknown as typeof Intl.NumberFormat;

  Number.prototype.toLocaleString = boom;
  String.prototype.toLocaleString = boom;
  Intl.NumberFormat = guardedNumberFormat;
  try {
    return fn();
  } finally {
    Number.prototype.toLocaleString = numberToLocale;
    String.prototype.toLocaleString = stringToLocale;
    Intl.NumberFormat = origNumberFormat;
  }
}

function runStory(source: string): string[] {
  const program = compileOk(source);
  const dialogue = new Dialogue(program, { startAt: "Start" });
  return runUntilCompleteEvents(dialogue)
    .filter(
      (event): event is Extract<DialogueEvent, { type: "line" }> =>
        event.type === "line" && !!event.text,
    )
    .map((event) => event.text);
}

const NUMERIC_STORY = `title: Start
---
<<declare $amount = 0.5 as number>>
<<declare $count = 1000000 as number>>
<<set $amount to $amount * 2>>
Line one {$amount} and {$count}
<<set $total to 1.25 + 2.5>>
Total is {$total}
Up to {$total * 4}
===
`;

test("numeric composed text is culture-invariant (no locale-sensitive APIs)", () => {
  const lines = withCultureSensitiveApisBlocked(() => runStory(NUMERIC_STORY));
  // Dot decimal separator, no grouping, exact upstream rendering.
  assert.deepEqual(lines, [
    "Line one 1 and 1000000", // 0.5 * 2 → integer-valued float renders "1"
    "Total is 3.75",
    "Up to 15",
  ]);
});

test("boolean rendering is culture-invariant and upstream-exact", () => {
  const story = `title: Start
---
<<declare $flag = false>>
<<if $flag>>
yes
<<else>>
Flag is {$flag}
<<endif>>
<<set $flag to true>>
Now {$flag}
===
`;
  const lines = withCultureSensitiveApisBlocked(() => runStory(story));
  assert.deepEqual(lines, ["Flag is False", "Now True"]);
});
