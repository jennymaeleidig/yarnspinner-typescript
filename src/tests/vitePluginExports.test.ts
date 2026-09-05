// SPDX-License-Identifier: CC0-1.0
// The generic-loader seam is reachable: the bundler-agnostic compile steps —
// compileYarnModule and compileYarnProjectModule — resolve AND execute through
// the plugin package's main entry, so the documented webpack-loader contract
// is importable rather than only documented. Their types ride the same entry.
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dialogue } from "yarnspinner-typescript";
import {
  compileYarnModule,
  compileYarnProjectModule,
  type CompiledYarnModule,
  type CompileYarnOptions,
} from "yarn-spinner-vite-plugin";
import { importEmitted, lineTexts } from "./pluginHarness.js";

const STORY = `title: Start\n---\nNarrator: Hi\n===\n`;

/** A temp project: story.yarn + project.yarnproject; returns [projectPath, cleanup]. */
const projectFixture = (): [string, () => void] => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-exports-"));
  writeFileSync(join(dir, "story.yarn"), STORY);
  writeFileSync(
    join(dir, "project.yarnproject"),
    JSON.stringify({
      projectFileVersion: 4,
      sourceFiles: ["**/*.yarn"],
      baseLanguage: "en",
    }),
  );
  return [
    join(dir, "project.yarnproject"),
    () => rmSync(dir, { recursive: true, force: true }),
  ];
};

test("compileYarnModule resolves and executes through the package entry", async () => {
  // The options/result types ride the same entry (type-level pin).
  const opts: CompileYarnOptions = {};
  const compiled: CompiledYarnModule = compileYarnModule(
    STORY,
    "story.yarn",
    opts,
  );
  deepStrictEqual(compiled.errors, []);
  ok(compiled.code.includes("export default"), "emitted ESM text");

  // Executed, not just resolved: the emitted module runs like a plugin load's.
  const mod = await importEmitted(compiled.code);
  const dialogue = new Dialogue(mod.default, { startAt: "Start" });
  strictEqual(lineTexts(dialogue.continue())[0], "Hi");
});

test("compileYarnProjectModule resolves and executes through the package entry", async () => {
  const [projectPath, cleanup] = projectFixture();
  try {
    const compiled = compileYarnProjectModule(projectPath);
    deepStrictEqual(compiled.errors, []);
    ok(compiled.code.includes("export default"), "emitted ESM text");
    ok(!compiled.code.includes("readFile"), "emitted module is pure data");
  } finally {
    cleanup();
  }
});
