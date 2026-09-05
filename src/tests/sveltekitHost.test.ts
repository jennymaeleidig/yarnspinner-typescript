// SPDX-License-Identifier: CC0-1.0
/**
 * SvelteKit host harness: the end-to-end
 * story proven by the example app at `examples/sveltekit-host/` — the same
 * story as the Next.js host, with zero React anywhere. The YarnProject
 * loader runs server-side (`loadYarnProject` over the app's own authored
 * content, +page.server.ts), the compiled program crosses the load boundary
 * as a plain serializable object, and the client component runs `Dialogue`'s
 * pull-based continue loop natively in Svelte runes.
 *
 * Tests run from src only (no package surface for a one-app example). The pull loop the client component runs is the
 * package's own transcript-reduction module (`runUntilStopped`) — the same
 * shipped logic, imported, not mirrored. The SSR harness compiles the REAL
 * `DialogueHost.svelte` (svelte/compiler, both generations clean) and
 * renders it with `svelte/server`: the component file is the single source
 * of truth for the server-rendered output, and the harness itself is the
 * no-React proof — only Svelte and the package's main entry are loaded. The
 * interactive handlers are asserted through `Dialogue` in the flow tests
 * (they cannot execute inside a server render); the content files are
 * loaded through the same server-side path the host's +page.server.ts uses.
 *
 * The `npm run sveltekit:build` target (adapter-static) prerenders the page,
 * so the loader call and this same SSR output run at build time in CI.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname, relative } from "node:path";
import { compile } from "svelte/compiler";
import type { Component } from "svelte";
import { render } from "svelte/server";

import {
  Dialogue,
  noOptionSelected,
  runUntilComplete,
  runUntilStopped,
} from "../index.js";
import { loadYarnProject } from "../compile/nodeProjectFs.js";
import type { Diagnostic, Program } from "../index.js";

/** Directory of the compiled test file (dist/tests/). */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The repo root (parent of dist/). */
const ROOT = join(HERE, "..", "..");

/** The shared demo content — the same files +page.server.ts loads. */
const CONTENT_DIR = join(ROOT, "examples", "content");

/** The host's app sources — scanned for the Node/React split. */
const HOST_SRC = join(ROOT, "examples", "sveltekit-host", "src");

/** The host's dialogue component — compiled by the SSR harness. */
const HOST_COMPONENT = join(HOST_SRC, "lib", "DialogueHost.svelte");

/** The built main entry — what the host's client code consumes. */
const DIST_INDEX = join(ROOT, "dist", "index.js");

/** Load the host's project the way +page.server.ts does. */
function loadHostProject(): {
  program: Program;
  sources: string[];
  projectName?: string;
} {
  const result = loadYarnProject(join(CONTENT_DIR, "project.yarnproject"));
  assert.ok(
    result.program,
    `host project must load: ${result.diagnostics.map((d) => d.code).join(", ")}`,
  );
  return {
    program: result.program,
    sources: result.sources,
    projectName: result.project?.projectName,
  };
}

// ── SSR harness: the real Svelte component, server-rendered ───────────────

/** Props of DialogueHost.svelte (kept in structural sync with the component). */
interface HostProps {
  program: Program;
  projectName?: string | null;
  sources: string[];
  diagnostics: Diagnostic[];
}

/** Compile the host's component for both generations and return the
 *  server-mode JS for the harness to import. */
function compileHostComponent(): string {
  const source = readFileSync(HOST_COMPONENT, "utf8");
  let serverJs = "";
  // Both generations must compile clean: server generation is what the SSR
  // harness below renders; client generation is what the browser hydrates —
  // the interactive handlers (Continue/option/reset) live in it. The
  // handlers' behavior itself is asserted through `Dialogue` in the flow
  // tests (tests compile from src only — the Next.js mirror disclosure).
  for (const generate of ["server", "client"] as const) {
    const { js, warnings } = compile(source, {
      generate,
      css: "injected",
      filename: HOST_COMPONENT,
      name: "DialogueHost",
    });
    assert.equal(
      warnings.length,
      0,
      `the component must compile clean for ${generate}: ${warnings.map((w) => w.message).join("; ")}`,
    );
    if (generate === "server") serverJs = js.code;
  }
  return serverJs;
}

/** The compiled server component, imported once per process. */
const getServerComponent = (async () => {
  const js = compileHostComponent();
  // Written inside dist/ so bare-specifier imports in the compiled module
  // (svelte/internal/server, the package's main entry) resolve from the
  // repo's node_modules and package self-reference.
  const outDir = join(HERE, "..", ".svelte-ssr-harness");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "DialogueHost.svelte.js");
  writeFileSync(outFile, js);
  const mod = (await import(pathToFileURL(outFile).href)) as {
    default: unknown;
  };
  return mod.default as Component<HostProps>;
})();

after(() => {
  rmSync(join(HERE, "..", ".svelte-ssr-harness"), {
    recursive: true,
    force: true,
  });
});

/** Drain the dialogue through every stopping point to the end — the
 *  shipped module's own drain, the same function the host component could
 *  call; no local copy. */

// ── Server-side load path (+page.server.ts, minus the markup) ─────────────

test("the host's project loads server-side through the Node provider", () => {
  const { sources, projectName } = loadHostProject();
  assert.deepEqual(sources, [
    "crossroads.yarn",
    "night_market.yarn",
    "storylets.yarn",
  ]);
  assert.equal(projectName, "Wayside");
});

test("the compiled program is serializable across the load boundary", () => {
  const { program } = loadHostProject();
  // +page.server.ts hands the program to the page as load data — SvelteKit
  // serializes it (devalue) to the client. It must survive a JSON round-trip
  // unchanged (ADR 0001).
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("the host's sources keep Node access in +page.server.ts and React out of the tree", () => {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  })(HOST_SRC);
  assert.ok(files.length > 0, "the host has app sources");

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = relative(HOST_SRC, file);
    // Zero React anywhere: no react/react-dom imports in any source file.
    assert.ok(
      !/"react(-dom|-jsx-runtime)?"/.test(text),
      `${rel} must not import React`,
    );
    // The .server.ts suffix is the only Node-touching module — every other
    // file must reach neither the loader's Node provider nor node builtins.
    if (!rel.endsWith(".server.ts")) {
      assert.ok(
        !text.includes("yarn-spinner-runner-ts/node"),
        `${rel} must not import the Node-only ./node subpath`,
      );
      assert.ok(
        !text.includes("node:"),
        `${rel} must not reference node: builtins`,
      );
    }
  }

  // The client code's only package import is the browser-safe main entry
  // (coding standard §2): the built artifact carries no node: builtins.
  const component = readFileSync(HOST_COMPONENT, "utf8");
  assert.match(component, /from "yarn-spinner-runner-ts";/);
  const index = readFileSync(DIST_INDEX, "utf8");
  assert.ok(
    !index.includes("node:"),
    "dist/index.js must not reference node: builtins",
  );
});

test("the host renders its opening line server-side (SSR harness)", async () => {
  const component = await getServerComponent;
  const { program, sources, projectName } = loadHostProject();
  const html = render(component, {
    props: {
      program,
      sources,
      projectName: projectName ?? null,
      diagnostics: [],
    },
  }).html;

  assert.match(
    html,
    /A crossroads at dusk/,
    "the opening Narrator line must be in the SSR output (the first pull runs during render)",
  );
  assert.match(
    html,
    /<strong[^>]*>Narrator<\/strong>/,
    "the opening line's speaker renders",
  );
  assert.match(html, /Wayside/, "the project name renders");
  assert.match(
    html,
    /crossroads\.yarn/,
    "the loader's resolved sources render",
  );
  assert.match(html, /Continue/, "the pull loop's control renders");
  assert.match(html, /Reset/, "the variable-storage reset control renders");
  assert.ok(
    !html.includes("react.element") && !html.includes("react-dom"),
    "the server-rendered tree carries no React markers",
  );
});

// ── Variable-storage reset through the host's flow ────────────────────────

test("the host's dialogue flow: walk on, buy the lantern, arrive, complete — then reset replays", () => {
  const { program } = loadHostProject();
  const dialogue = new Dialogue(program);

  // First pull: crossroads declares seed the storage, opening line delivers.
  dialogue.continue();
  assert.equal(dialogue.getVariable("gold"), 5);
  assert.equal(dialogue.getVariable("hasMap"), false);

  // Walk on → the night market: pulls stop per line, so the jump's lines
  // arrive one pull at a time; the market's declares seed on entry.
  void dialogue.continue(); // crossroads options
  dialogue.selectOption(1); // Walk on → jump NightMarket
  dialogue.continue(); // walk-on line
  dialogue.continue(); // the Hawker opening
  assert.equal(dialogue.getVariable("coins"), 7);
  assert.equal(dialogue.getVariable("hasLantern"), false);

  // The option set; buy the lantern → the price comes off, the jump fires.
  void dialogue.continue(); // the market's options event
  dialogue.selectOption(0);
  const { transcript, stopped } = runUntilComplete(dialogue);
  assert.equal(dialogue.getVariable("coins"), 4, "the lantern cost 3 coins");
  assert.equal(dialogue.getVariable("hasLantern"), true);
  assert.ok(
    transcript.lines.some((l) =>
      l.text.includes("lantern will hold till dawn"),
    ),
  );
  assert.ok(
    transcript.lines.some((l) => l.text.includes("4 coins")),
    "the arrival line's {expr} substitution renders live",
  );
  assert.equal(stopped, "complete", "the flow runs to completion");

  // Variable-storage reset (§4): a fresh Dialogue is a fresh storage — the
  // declares reseed, generated state clears, and the story replays from the top.
  const replay = new Dialogue(program);
  assert.equal(
    replay.getVariable("gold"),
    5,
    "the seed reapplies — storage was reset",
  );
  assert.equal(replay.getVariable("hasMap"), false);
  const line = replay
    .continue()
    .find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.match(
    line.text,
    /A crossroads at dusk/,
    "the flow replays from the top",
  );
});

test("the walk-on path completes without the lantern", () => {
  const { program } = loadHostProject();
  const dialogue = new Dialogue(program);
  void dialogue.continue(); // crossroads opening
  void dialogue.continue(); // crossroads options
  dialogue.selectOption(1); // Walk on → jump NightMarket
  dialogue.continue(); // walk-on line
  dialogue.continue(); // the Hawker opening
  void dialogue.continue(); // the market's options event
  dialogue.selectOption(1); // Keep walking
  const { transcript } = runUntilComplete(dialogue);
  assert.ok(
    transcript.lines.some((l) => l.text.includes("keep their secrets")),
  );
  assert.equal(dialogue.getVariable("hasLantern"), false);
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
