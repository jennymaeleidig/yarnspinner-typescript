// SPDX-License-Identifier: CC0-1.0
// The full .yarn import contract as implemented: named exports beside the
// default Program, ?raw passthrough, the Vite-core bail set, and diagnostics
// as build errors — errors fail with a RollupError-shaped object, warnings
// surface without failing, and severity overrides apply before that split.
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dialogue } from "yarn-spinner-runner-ts";
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";
import { callHook, importEmitted, lineTexts } from "./pluginHarness.js";

const STORY = `# title_tag

title: Start
---
Narrator: Hi
-> Opt A
    Narrator: A chosen
===
`;

const BROKEN = `title: Start
===
`;

const plugin = yarnSpinnerVitePlugin();

const makeCtx = (warn: unknown[] = []) => ({
  warn: (msg: unknown) => warn.push(msg),
});

/** A temp .yarn file; returns [id, cleanup]. */
const storyFile = (name: string, source: string): [string, () => void] => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-plugin-"));
  const file = join(dir, name);
  writeFileSync(file, source);
  return [file, () => rmSync(dir, { recursive: true, force: true })];
};

test("the emitted module carries the named exports beside the default Program", async () => {
  const [file, cleanup] = storyFile("story.yarn", STORY);
  try {
    const code = await callHook(plugin.load, { warn: () => {} }, file);
    const mod = await importEmitted(code as string);
    const dialogue = new Dialogue(mod.default, { startAt: "Start" });
    strictEqual(lineTexts(dialogue.continue())[0], "Hi");

    ok(
      mod.stringTable && typeof mod.stringTable === "object",
      "stringTable named export",
    );
    // "Narrator: Hi" carries no #line: tag — the compiler assigned its ID.
    strictEqual(mod.containsImplicitStringTags, true);
    ok(
      Object.keys(mod.stringTable).length > 0,
      "implicit line registered in the table",
    );
    deepStrictEqual(mod.fileTags[file], ["title_tag"]);
  } finally {
    cleanup();
  }
});

test("?raw yields the exact source string", async () => {
  const [file, cleanup] = storyFile("story.yarn", STORY);
  try {
    const code = await callHook(plugin.load, { warn: () => {} }, `${file}?raw`);
    const mod = await importEmitted(code as string);
    strictEqual(mod.default, STORY);
  } finally {
    cleanup();
  }
});

test("the Vite-core bail set passes through: ?url, ?inline, ?no-inline", async () => {
  const [file, cleanup] = storyFile("story.yarn", STORY);
  try {
    for (const q of ["url", "inline", "no-inline"]) {
      strictEqual(
        await callHook(plugin.load, { warn: () => {} }, `${file}?${q}`),
        undefined,
        `?${q}`,
      );
    }
  } finally {
    cleanup();
  }
});

test("an error-severity diagnostic fails the load with id, location, and frame", async () => {
  const [file, cleanup] = storyFile("broken.yarn", BROKEN);
  try {
    await strictEqual(
      await (
        callHook(plugin.load, { warn: () => {} }, file) as Promise<unknown>
      ).then(
        () => "no throw",
        (e: {
          message: string;
          id?: string;
          loc?: { line?: number; column?: number };
          frame?: string;
        }) => {
          ok(e.message.length > 0, "error message present");
          strictEqual(e.id, file);
          ok(
            typeof e.loc?.line === "number" && e.loc.line >= 1,
            `1-based line in loc, got ${JSON.stringify(e.loc)}`,
          );
          ok(typeof e.loc.column === "number");
          ok(
            typeof e.frame === "string" && e.frame.includes("^"),
            "frame quotes the source line with a caret",
          );
          return "threw";
        },
      ),
      "threw",
    );
  } finally {
    cleanup();
  }
});

test("a warning-severity diagnostic is surfaced without failing the load", async () => {
  const [file, cleanup] = storyFile(
    "warny.yarn",
    `title: Start\n---\n<<jump Nope>>\n===\n`,
  );
  const warnings: unknown[] = [];
  try {
    const code = await callHook(plugin.load, makeCtx(warnings), file);
    const mod = await importEmitted(code as string);
    ok(mod.default, "module still emits");
    ok(
      warnings.some((w) => String(w).includes("YS0012")),
      `warning surfaced, got ${JSON.stringify(warnings)}`,
    );
    ok(
      warnings.some((w) => String(w).includes("warny.yarn")),
      `warning carries its file location, got ${JSON.stringify(warnings)}`,
    );
  } finally {
    cleanup();
  }
});

test("a severity override flips an error to a warning and the build succeeds", async () => {
  const [file, cleanup] = storyFile("broken.yarn", BROKEN);
  const downgraded = yarnSpinnerVitePlugin({
    diagnosticsSeverity: { YS0004: "warning" },
  });
  const warnings: unknown[] = [];
  try {
    const code = await callHook(downgraded.load, makeCtx(warnings), file);
    ok(
      typeof code === "string" && code.includes("export default"),
      "downgraded error no longer fails; module emits",
    );
    ok(
      warnings.some((w) => String(w).includes("YS0004")),
      "surfaced as warning",
    );
  } finally {
    cleanup();
  }
});
