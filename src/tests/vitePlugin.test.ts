// SPDX-License-Identifier: CC0-1.0
// The emitted-module seam for the Vite plugin: drive it the way Vite does —
// load on real file ids, handleHotUpdate on content edits — then evaluate the
// emitted code and run a Dialogue against it.
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";

const DEMO = `title: Start
---
Narrator: Hi
-> Opt A
    Narrator: A chosen
-> Opt B
    Narrator: B chosen
===
`;

const plugin = yarnSpinnerVitePlugin();

// Vite wraps hooks as {handler} | fn; call them the way Vite would.
const callHook = (hook: unknown, thisArg: unknown, ...args: unknown[]): unknown => {
  const fn = typeof hook === "function" ? hook : (hook as { handler?: unknown }).handler;
  ok(typeof fn === "function", "hook missing");
  return (fn as (...a: unknown[]) => unknown).call(thisArg, ...args);
};
// Vite always supplies a plugin context on hook calls; the seam mirrors that.
const viteCtx = (): { warn: () => void } => ({ warn: () => {} });

const importEmitted = async (code: string) =>
  import(`data:text/javascript,${encodeURIComponent(code)}`);

const makeHotCtx = (file: string, sent: unknown[]) => ({
  file,
  server: { ws: { send: (msg: unknown) => sent.push(msg) } },
  modules: [] as unknown[],
  read: async () => DEMO,
  timestamp: 0,
});

test("a .yarn import emits a module whose default export is a Program a Dialogue executes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-plugin-"));
  try {
    const story = join(dir, "story.yarn");
    writeFileSync(story, DEMO);
    const code = await callHook(plugin.load, viteCtx(), story);
    ok(typeof code === "string" && code.length > 0, "load produced no module code");

    const mod = await importEmitted(code as string);
    const dialogue = new Dialogue(mod.default, { startAt: "Start" });
    const lines = (events: DialogueEvent[]) =>
      events
        .filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line")
        .map((e) => e.text);
    strictEqual(lines(dialogue.continue())[0], "Hi");

    const optionsEvent = dialogue
      .continue()
      .find((e): e is Extract<DialogueEvent, { type: "options" }> => e.type === "options");
    strictEqual(optionsEvent?.options.length, 2);
    dialogue.selectOption(0);
    ok(lines(dialogue.continue()).includes("A chosen"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("load bails on query-carrying ids and non-.yarn ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-plugin-"));
  try {
    const story = join(dir, "story.yarn");
    writeFileSync(story, DEMO);
    strictEqual(await callHook(plugin.load, viteCtx(), `${story}?url`), undefined);
    strictEqual(await callHook(plugin.load, viteCtx(), join(dir, "notes.txt")), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a content edit triggers a full page reload in dev", () => {
  const sent: unknown[] = [];
  const result = callHook(plugin.handleHotUpdate, {}, makeHotCtx("/proj/story.yarn", sent));
  deepStrictEqual(result, []);
  deepStrictEqual(sent, [{ type: "full-reload" }]);
});

test("a .yarnproject edit reloads too, before its import contract exists", () => {
  const sent: unknown[] = [];
  const result = callHook(plugin.handleHotUpdate, {}, makeHotCtx("/proj/project.yarnproject", sent));
  deepStrictEqual(result, []);
  deepStrictEqual(sent, [{ type: "full-reload" }]);
});

test("handleHotUpdate ignores files the plugin does not own", () => {
  const sent: unknown[] = [];
  strictEqual(callHook(plugin.handleHotUpdate, {}, makeHotCtx("/proj/story.txt", sent)), undefined);
  deepStrictEqual(sent, []);
});
