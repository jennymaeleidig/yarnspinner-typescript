// SPDX-License-Identifier: CC0-1.0
/**
 * Pluggable variable storage (glossary "variable storage"):
 * the persistence seam where all story state — story variables and
 * generated variables alike (coding standards §4) — lives in one
 * host-replaceable store.
 *
 * Tests go through the public seam only (coding standards §6): a host
 * storage implementation injected via `DialogueOptions.variableStorage`,
 * observed through `getVariables`/`getVariable` and the storage itself.
 */

import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueOptions } from "../runtime/dialogue.js";
import { InMemoryVariableStorage, type VariableStorage } from "../runtime/variableStorage.js";

function makeDialogue(source: string, opts?: DialogueOptions): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

const SCRIPT = `
title: Start
---
<<declare $gold = 0>>
<<set $gold to 5>>
<<once>> Mae: cameo
Mae: end
===
`;

/** In-memory storage that records every key a write touches. */
class RecordingStorage implements VariableStorage {
  readonly written: string[] = [];
  private readonly map = new Map<string, unknown>();

  has(name: string): boolean {
    return this.map.has(name);
  }
  get(name: string): unknown {
    return this.map.get(name);
  }
  set(name: string, value: unknown): void {
    this.written.push(name);
    this.map.set(name, value);
  }
  entries(): IterableIterator<[string, unknown]> {
    return this.map.entries();
  }
}

function drain(dialogue: Dialogue): void {
  for (let i = 0; i < 100; i++) {
    const batch = dialogue.continue();
    if (batch.length === 0 || batch[batch.length - 1].type === "dialogueComplete") return;
  }
}

test("story writes and generated state land in the injected storage", () => {
  const storage = new RecordingStorage();
  const dialogue = makeDialogue(SCRIPT, { variableStorage: storage });
  drain(dialogue);

  // The story variable write reached the host's storage (bare key, no `$`).
  strictEqual(storage.get("gold"), 5);

  // Generated variables (the <<once>> flag) live in the same storage under
  // the reserved namespace (resetting storage resets all
  // story state together).
  const generated = [...storage.entries()].filter(([key]) => key.startsWith("Yarn.Internal."));
  ok(generated.length > 0, "once-state should be a generated variable in the injected storage");

  // Snapshots stay story-only: generated keys are not host-visible state.
  deepStrictEqual(
    Object.keys(dialogue.getVariables()).filter((key) => key.startsWith("Yarn.Internal.")),
    [],
  );
});

test("generated state in the injected storage persists across a fresh Dialogue", () => {
  const storage = new RecordingStorage();
  const first = makeDialogue(SCRIPT, { variableStorage: storage });
  drain(first);
  ok(first.getVariables()["gold"] === 5);

  // A fresh Dialogue over the same storage inherits its state: the once-line
  // is suppressed (its flag is stored state, not runtime state) and the
  // story variable survives — persistence is the host's storage.
  const second = makeDialogue(SCRIPT, { variableStorage: storage });
  const texts: string[] = [];
  for (let i = 0; i < 100; i++) {
    const batch = second.continue();
    for (const event of batch) {
      if (event.type === "line") texts.push(event.text);
    }
    if (batch.length === 0 || batch[batch.length - 1].type === "dialogueComplete") break;
  }
  ok(!texts.some((text) => text.includes("cameo")), "once-state must survive in the injected storage");
  ok(texts.some((text) => text.includes("end")));
  strictEqual(second.getVariables()["gold"], 5);
});

test("declare-default seeding skips names the injected storage already holds", () => {
  // Restored host state: $gold saved as 50 while the script declares 0.
  const restored = new InMemoryVariableStorage();
  restored.set("gold", 50);

  const dialogue = makeDialogue(SCRIPT, { variableStorage: restored });
  strictEqual(dialogue.getVariable("gold"), 50, "a restored value must survive construction");

  // Names the storage does NOT hold are still seeded from the declares.
  const partial = new InMemoryVariableStorage();
  const dialogue2 = makeDialogue(SCRIPT, { variableStorage: partial });
  strictEqual(dialogue2.getVariable("gold"), 0);
});

test("host-provided `variables` still override after seeding (with injected storage)", () => {
  const storage = new InMemoryVariableStorage();
  const dialogue = makeDialogue(SCRIPT, { variableStorage: storage, variables: { $gold: 99 } });
  strictEqual(dialogue.getVariable("gold"), 99);
});

test("the in-memory default keeps current behaviour when nothing is injected", () => {
  const dialogue = makeDialogue(SCRIPT);
  drain(dialogue);
  strictEqual(dialogue.getVariables()["gold"], 5);
});
