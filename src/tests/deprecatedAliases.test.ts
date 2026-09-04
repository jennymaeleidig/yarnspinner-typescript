// SPDX-License-Identifier: CC0-1.0
import { test } from "node:test";
import { strictEqual } from "node:assert";
import { Dialogue, YarnRunner } from "../index.js";
import { compileOk } from "./compileOk.js";

/**
 * The 0.2.0 breaking wave: `YarnRunner` → `Dialogue` ships with a
 * one-release deprecated alias. These tests pin the alias contract — the
 * alias IS the new name (same value, same identity), so nothing can
 * accidentally fork behavior between them. The alias is removed in the
 * release after 0.2.0. (`useYarnRunner` → `useDialogue` shared this
 * contract until the React adapter was deleted.)
 */

test("YarnRunner is a deprecated alias of Dialogue (same value)", () => {
  strictEqual(YarnRunner, Dialogue);
});

test("the YarnRunner alias runs dialogue exactly like Dialogue", () => {
  const program = compileOk(`title: Start
---
Narrator: Hi
===
`);
  // Cast through the alias's documented type to prove it is usable as the
  // runtime in old consumer code.
  const runner: YarnRunner = new YarnRunner(program, { startAt: "Start" });
  const events = runner.continue();
  strictEqual(events[0].type, "nodeStart");
  strictEqual(events.some((e) => e.type === "line" && e.text === "Hi"), true);
});
