// SPDX-License-Identifier: CC0-1.0
/**
 * Next.js host harness: the end-to-end
 * story proven by the example app at `examples/nextjs-host/` — the
 * YarnProject loader runs server-side (`loadYarnProject` over the app's own
 * authored content), the compiled program crosses the RSC boundary as a
 * plain serializable object, and the client component runs `Dialogue`'s
 * pull-based continue loop with variable-storage reset.
 *
 * Tests run from src only (no package surface for a one-app example). The pull loop the client component runs is the
 * package's own transcript-reduction module (`runUntilStopped`) — the same
 * shipped logic, imported, not mirrored. The content itself is NOT
 * mirrored either: the real `examples/nextjs-host/content/` files are the
 * single source of truth, loaded through the same server-side path the
 * host's page uses. The SSR story is asserted through the vanilla layer:
 * the render-time initial pull (fresh `Dialogue` + one `runUntilStopped`)
 * is what puts the opening line in the server-rendered markup. Two
 * disclosed §6 trade-offs, both precedent-backed: the test imports
 * `nodeProjectFs` from its internal path (yarnProject.test.ts does the
 * same) and asserts bundle-safety on the built artifacts — client-path
 * purity cannot be asserted behaviorally.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { Dialogue, noOptionSelected, runUntilComplete, runUntilStopped } from "../index.js";
import { loadYarnProject } from "../compile/nodeProjectFs.js";
import type { Program } from "../index.js";

/** Directory of the compiled test file (dist/tests/). */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The shared demo content — the same files the server component loads. */
const CONTENT_DIR = join(HERE, "..", "..", "examples", "content");

/** The built main entry — what the host's client bundle consumes. */
const DIST_INDEX = join(HERE, "..", "..", "dist", "index.js");

/** Load the host's project the way the server component does. */
function loadHostProject(): { program: Program; sources: string[]; projectName?: string } {
  const result = loadYarnProject(join(CONTENT_DIR, "project.yarnproject"));
  assert.ok(result.program, `host project must load: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  return { program: result.program, sources: result.sources, projectName: result.project?.projectName };
}

// ── Server-side load path (the host's page.tsx, minus the markup) ─────────

test("the host's project loads server-side through the Node provider", () => {
  const { sources, projectName } = loadHostProject();
  assert.deepEqual(sources, ["crossroads.yarn", "night_market.yarn", "storylets.yarn"]);
  assert.equal(projectName, "Wayside");
});

test("the compiled program is serializable across the RSC boundary", () => {
  const { program } = loadHostProject();
  // The server component hands the program to the client component as a
  // plain prop — it must survive a JSON round-trip unchanged (ADR 0001).
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("the client bundle's main entry carries no Node builtins (§2)", () => {
  // DialogueHost imports the package's main entry; the loader's Node access
  // lives only under the ./node subpath. The built artifacts prove the
  // split — both halves asserted: the main entry references no Node
  // builtins (either specifier style), and the ./node bundle is where
  // node:fs lives.
  const index = readFileSync(DIST_INDEX, "utf8");
  assert.ok(!index.includes("node:"), "dist/index.js must not reference node: builtins");
  assert.ok(!/\brequire\(["']fs["']\)/.test(index), "dist/index.js must not require fs");
  const nodeSubpath = readFileSync(join(HERE, "..", "..", "dist", "compile", "nodeProjectFs.js"), "utf8");
  assert.ok(nodeSubpath.includes("node:fs"), "the ./node subpath is where node:fs lives");
});

// ── The SSR story (vanilla): the render-time initial pull ─────────────────

test("the host's opening line is in the initial pull it renders (SSR story)", () => {
  // DialogueHost's first render runs one synchronous pull — a fresh
  // `Dialogue` reduced through `runUntilStopped` — so the opening line is
  // in the server-rendered markup with no effects or hydration. This runs
  // that exact pull.
  const { program } = loadHostProject();
  const { transcript } = runUntilStopped(new Dialogue(program));
  const opening = transcript.lines[0];
  assert.ok(opening, "the first pull delivers the opening line");
  assert.match(opening.text, /A crossroads at dusk/, "the opening Narrator line is in the SSR output");
  assert.equal(opening.speaker, "Narrator", "the opening line's speaker renders");
});

// ── Variable-storage reset through the host's flow ────────────────────────

test("the host's dialogue flow: buy the map, arrive, complete — then reset replays", () => {
  const { program } = loadHostProject();
  const dialogue = new Dialogue(program);

  // First pull: declares seed the storage, opening line delivers.
  dialogue.continue();
  assert.equal(dialogue.getVariable("gold"), 5);
  assert.equal(dialogue.getVariable("hasMap"), false);

  // The option set; buy the map → the price comes off, the jump fires.
  void dialogue.continue(); // the options event
  dialogue.selectOption(0);
  const { transcript, stopped } = runUntilComplete(dialogue);
  assert.equal(dialogue.getVariable("gold"), 3, "the map cost 2 gold");
  assert.equal(dialogue.getVariable("hasMap"), true);
  assert.ok(transcript.lines.some((l) => l.text.includes("chapel path is due north")));
  assert.ok(transcript.lines.some((l) => l.text.includes("glints on the altar")));
  assert.equal(stopped, "complete", "the flow runs to completion");

  // Variable-storage reset (§4): a fresh Dialogue is a fresh storage — the
  // declares reseed, once-state clears, and the story replays from the top.
  const replay = new Dialogue(program);
  assert.equal(replay.getVariable("gold"), 5, "the seed reapplies — storage was reset");
  assert.equal(replay.getVariable("hasMap"), false);
  const line = replay
    .continue()
    .find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.match(line.text, /A crossroads at dusk/, "the flow replays from the top");
});

test("the walk-on path reaches the night market without the map", () => {
  const { program } = loadHostProject();
  const dialogue = new Dialogue(program);
  void dialogue.continue(); // opening line
  void dialogue.continue(); // options
  dialogue.selectOption(1); // Walk on → jump NightMarket
  const { transcript } = runUntilComplete(dialogue);
  assert.ok(transcript.lines.some((l) => l.text.includes("leave the Rogue")));
  assert.ok(
    transcript.lines.some((l) => l.text.includes("black as pitch")),
    "the walk-on path lands in the night market",
  );
  assert.equal(dialogue.getVariable("hasMap"), false);
});

test("noOptionSelected falls through the host's option set", () => {
  const { program } = loadHostProject();
  const dialogue = new Dialogue(program);
  void dialogue.continue(); // opening line
  void dialogue.continue(); // options
  dialogue.selectOption(noOptionSelected);
  const { stopped } = runUntilStopped(dialogue);
  assert.equal(
    stopped,
    "complete",
    "falling through runs no option body — the Start node ends, and with it the dialogue",
  );
});
