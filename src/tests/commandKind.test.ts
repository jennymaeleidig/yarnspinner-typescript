// SPDX-License-Identifier: CC0-1.0
/**
 * Pins for the one classification of command names (src/runtime/commands.ts
 * `commandKind`) — module tier, the seam's single home since both drivers
 * that branch on command names (the compiler's `lowerCommand`, the VM's
 * `runCommand`) dispatch on it. The table pins the classification itself,
 * case-insensitivity, and the host fall-through; each driver's per-kind
 * policy is pinned end-to-end by the conformance corpus and vm-runtime /
 * full_featured suites (the module header's policy table is the stated
 * lockstep obligation).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { commandKind } from "../runtime/commands.js";

test("the classification table: every authored internal command has a kind", () => {
  assert.equal(commandKind("set"), "set");
  assert.equal(commandKind("declare"), "declare");
  assert.equal(commandKind("call"), "call");
  assert.equal(commandKind("set_saliency"), "setSaliency");
  assert.equal(commandKind("stop"), "stop");
  assert.equal(commandKind("return"), "return");
});

test("the classification is case-insensitive, like both drivers' old comparisons", () => {
  assert.equal(commandKind("SET"), "set");
  assert.equal(commandKind("Set"), "set");
  assert.equal(commandKind("DECLARE"), "declare");
  assert.equal(commandKind("Stop"), "stop");
  assert.equal(commandKind("SET_SALIENCY"), "setSaliency");
});

test("every other name is host — the fall-through both drivers deliver", () => {
  assert.equal(commandKind("walkTo"), "host");
  assert.equal(commandKind("custom_command"), "host");
  assert.equal(commandKind(""), "host");
});
