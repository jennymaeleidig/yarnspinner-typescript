// SPDX-License-Identifier: CC0-1.0
// The emitted-module seam for the Vite plugin: drive it the way Vite does —
// load on real file ids, handleHotUpdate on content edits — then evaluate the
// emitted code and run a Dialogue against it.
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dialogue, type DialogueEvent } from "yarn-spinner-runner-ts";
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";
import { callHook, importEmitted, lineTexts, viteCtx } from "./pluginHarness.js";

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
    strictEqual(lineTexts(dialogue.continue())[0], "Hi");

    const optionsEvent = dialogue
      .continue()
      .find((e): e is Extract<DialogueEvent, { type: "options" }> => e.type === "options");
    strictEqual(optionsEvent?.options.length, 2);
    dialogue.selectOption(0);
    ok(lineTexts(dialogue.continue()).includes("A chosen"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable compilation file fails the load naming the file, on both branches", async () => {
  // The stated contract — a compilation file the plugin cannot read must
  // fail the build with its path, not a raw ENOENT — on the .yarn and the
  // .yarnproject branch alike.
  const dir = mkdtempSync(join(tmpdir(), "yarn-plugin-read-"));
  try {
    for (const missing of [join(dir, "missing.yarn"), join(dir, "missing.yarnproject")]) {
      const err = (await (
        callHook(plugin.load, viteCtx(), missing) as Promise<unknown>
      ).then(
        () => null,
        (e: unknown) => e,
      )) as { message: string; id: string } | null;
      ok(err, `the load fails for ${missing}`);
      ok(!("errno" in err && "syscall" in err), `no raw Node error escapes: ${JSON.stringify(err)}`);
      ok(err.message.startsWith("Cannot read "), `the read failure is named: ${err.message}`);
      ok(err.message.includes(missing), `names the file: ${err.message}`);
      strictEqual(err.id, missing);
      ok(!("loc" in err), "no location: nothing was read");
    }
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
