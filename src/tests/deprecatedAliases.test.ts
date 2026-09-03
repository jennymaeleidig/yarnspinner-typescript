import { test } from "node:test";
import { strictEqual } from "node:assert";
import { parseYarn, compileDocument, Dialogue, YarnRunner } from "../index.js";
import {
  useDialogue,
  useYarnRunner,
} from "../react/useDialogue.js";
import type {
  UseDialogueOptions,
  UseDialogueResult,
  UseYarnRunnerOptions,
  UseYarnRunnerResult,
} from "../react/useDialogue.js";

/**
 * Ticket 53 (the 0.2.0 breaking wave): `YarnRunner` → `Dialogue` and
 * `useYarnRunner` → `useDialogue` ship with one-release deprecated aliases.
 * These tests pin the alias contract — the aliases ARE the new names (same
 * value, same identity), so nothing can accidentally fork behavior between
 * them. The aliases are removed in the release after 0.2.0.
 */

test("YarnRunner is a deprecated alias of Dialogue (same value)", () => {
  strictEqual(YarnRunner, Dialogue);
});

test("useYarnRunner is a deprecated alias of useDialogue (same value)", () => {
  strictEqual(useYarnRunner, useDialogue);
});

test("the YarnRunner alias runs dialogue exactly like Dialogue", () => {
  const program = compileDocument(
    parseYarn(`title: Start
---
Narrator: Hi
===
`),
  );
  // Cast through the alias's documented type to prove it is usable as the
  // runtime in old consumer code.
  const runner: YarnRunner = new YarnRunner(program, { startAt: "Start" });
  const events = runner.continue();
  strictEqual(events[0].type, "nodeStart");
  strictEqual(events.some((e) => e.type === "line" && e.text === "Hi"), true);
});

// Type-level: the option/result aliases must remain interchangeable with the
// new names (compile-time contract, asserted by these assignments).
const _optionsAliasCheck: UseDialogueOptions = {} as UseYarnRunnerOptions;
const _resultAliasCheck: UseYarnRunnerResult = {} as UseDialogueResult;
void _optionsAliasCheck;
void _resultAliasCheck;
