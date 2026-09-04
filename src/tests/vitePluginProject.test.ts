// SPDX-License-Identifier: CC0-1.0
// The .yarnproject import contract: the evaluated import is the full load
// result — program, per-locale tables, localisation metadata — shaped so the
// host hands it straight to the project text-provider factory and runs
// localised dialogue with no runtime file access.
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dialogue, type DialogueEvent } from "yarn-spinner-runner-ts";
import {
  compileSource,
  createProjectTextProvider,
  createCSV,
  stringTableToEntries,
} from "yarn-spinner-runner-ts";
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";
import { callHook, importEmitted } from "./pluginHarness.js";

const STORY = `title: Start\n---\nMae: Gold {$gold}. #line:gold\n<<set $gold to 5>>\nTake it #line:take\n===\n`;

const plugin = yarnSpinnerVitePlugin();

const firstLine = (events: DialogueEvent[]): string => {
  const line = events.find((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line");
  ok(line, "expected a line event");
  return line.text;
};

/** A temp project: story.yarn + German.csv + project.yarnproject; returns [projectPath, cleanup]. */
const projectFixture = (): [string, () => void] => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-project-"));
  const story = `title: Start\n---\nMae: Gold {$gold}. #line:gold\n<<set $gold to 5>>\nTake it #line:take\n===\n`;
  const { stringTable } = compileSource(story, { file: "story.yarn" });
  ok(stringTable, "fixture compiles");
  const entries = stringTableToEntries(stringTable, "en").map((e) => ({
    ...e,
    language: "de",
    text: e.text === "Mae: Gold {$gold}." ? "Mae: Gold {$gold}. (DE)" : e.text,
  }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "story.yarn"), story);
  writeFileSync(join(dir, "German.csv"), createCSV(entries));
  writeFileSync(
    join(dir, "project.yarnproject"),
    JSON.stringify({
      projectFileVersion: 4,
      sourceFiles: ["**/*.yarn"],
      baseLanguage: "en",
      // An unknown key the loader must tolerate.
      editorMetadata: { openTabs: ["story.yarn"] },
      localisation: { de: { strings: "German.csv", assets: "Assets/German" } },
    }),
  );
  return [join(dir, "project.yarnproject"), () => rmSync(dir, { recursive: true, force: true })];
};

test("a project import emits the full load result and drives localised dialogue", async () => {
  const [projectPath, cleanup] = projectFixture();
  try {
    const code = await callHook(plugin.load, { warn: () => {} }, projectPath);
    const mod = await importEmitted(code as string);

    // Full load result: program plus per-locale tables plus metadata.
    ok(mod.default.program, "program present");
    ok(mod.default.projectName !== undefined || mod.default.baseLanguage === "en", "localisation metadata present");
    strictEqual(mod.default.baseLanguage, "en");
    ok(Object.keys(mod.default.translations.de ?? {}).length > 0, "per-locale table present");
    strictEqual(mod.default.assets.de, "Assets/German");

    // Fresh Dialogue per language: delivery is once-per-line, so setLanguage
    // affects subsequent lines only (the core loader test's pattern).
    const base = new Dialogue(mod.default.program, {
      textProvider: createProjectTextProvider(mod.default),
    });
    strictEqual(
      firstLine(base.continue()),
      "Gold .",
      "base-language text (speaker prefix stripped, {$gold} unset)",
    );
    const de = new Dialogue(mod.default.program, {
      textProvider: createProjectTextProvider(mod.default),
    });
    de.setLanguage("de");
    strictEqual(firstLine(de.continue()), "Gold . (DE)", "localised text");
  } finally {
    cleanup();
  }
});

test("the emitted project module contains no runtime file access", async () => {
  const [projectPath, cleanup] = projectFixture();
  try {
    const code = await callHook(plugin.load, { warn: () => {} }, projectPath);
    ok(typeof code === "string");
    ok(!code.includes("require(") && !code.includes("readFile"), "emitted module is pure data");
    // Translation rows ride the emitted tables, not a deferred read.
    ok(code.includes("(DE)"), "translated text baked into the module");
  } finally {
    cleanup();
  }
});

test("?raw on a .yarnproject yields the raw project file", async () => {
  const [projectPath, cleanup] = projectFixture();
  try {
    const code = await callHook(plugin.load, { warn: () => {} }, `${projectPath}?raw`);
    const mod = await importEmitted(code as string);
    const parsed = JSON.parse(mod.default);
    strictEqual(parsed.projectFileVersion, 4);
    ok(parsed.editorMetadata.openTabs, "unknown keys preserved in the raw file");
  } finally {
    cleanup();
  }
});

test("an error-severity diagnostic inside a project source fails the load", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-proj-err-"));
  try {
    writeFileSync(join(dir, "broken.yarn"), "title: Start\n===\n");
    writeFileSync(
      join(dir, "project.yarnproject"),
      JSON.stringify({ projectFileVersion: 4, sourceFiles: ["**/*.yarn"], baseLanguage: "en" }),
    );
    const projectPath = join(dir, "project.yarnproject");
    const err = (await (callHook(plugin.load, { warn: () => {} }, projectPath) as Promise<unknown>).then(
      () => null,
      (e: { message: string; id?: string; loc?: { line?: number; column?: number }; frame?: string }) => e,
    )) as { message: string; id?: string; loc?: { line?: number; column?: number }; frame?: string };
    ok(err && err.message.includes("YS"), `fails with a compiler diagnostic, got ${JSON.stringify(err)}`);
    strictEqual(err.id, projectPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing strings file is a surfaced warning, not a build failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-proj-warn-"));
  try {
    writeFileSync(join(dir, "story.yarn"), "title: Start\n---\nHi #line:hi\n===\n");
    writeFileSync(
      join(dir, "project.yarnproject"),
      JSON.stringify({
        projectFileVersion: 4,
        sourceFiles: ["**/*.yarn"],
        baseLanguage: "en",
        localisation: { de: { strings: "Missing.csv" } },
      }),
    );
    const warnings: unknown[] = [];
    const code = await callHook(plugin.load, { warn: (m: unknown) => warnings.push(m) }, join(dir, "project.yarnproject"));
    ok(typeof code === "string" && code.includes("export default"), "build succeeds");
    ok(warnings.some((w) => String(w).includes("YP0006")), `warning surfaced, got ${JSON.stringify(warnings)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
