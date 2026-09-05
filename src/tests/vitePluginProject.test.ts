// SPDX-License-Identifier: CC0-1.0
// The .yarnproject import contract: the evaluated import is the full load
// result — program, per-locale tables, localisation metadata — shaped so the
// host hands it straight to the project text-provider factory and runs
// localised dialogue with no runtime file access.
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dialogue } from "yarn-spinner-runner-ts";
import {
  compileSource,
  createProjectTextProvider,
  createCSV,
  stringTableToEntries,
} from "yarn-spinner-runner-ts";
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";
import { callHook, firstLine, importEmitted } from "./pluginHarness.js";

const STORY = `title: Start\n---\nMae: Gold {$gold}. #line:gold\n<<set $gold to 5>>\nTake it #line:take\n===\n`;

const plugin = yarnSpinnerVitePlugin();

/** A temp project: story.yarn + German.csv + project.yarnproject; returns [projectPath, cleanup]. */
const projectFixture = (): [string, () => void] => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-project-"));
  const story = `title: Start\n---\nMae: Gold {$gold}. #line:gold\n<<set $gold to 5>>\nTake it #line:take\n===\n`;
  const { stringTable } = compileSource(story, { file: "story.yarn" });
  ok(stringTable, "fixture compiles");
  const entries = stringTableToEntries(stringTable, "en").map((e) => ({
    ...e,
    language: "de",
    text: e.text === "Mae: Gold {0}." ? "Mae: Gold {0}. (DE)" : e.text,
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
  return [
    join(dir, "project.yarnproject"),
    () => rmSync(dir, { recursive: true, force: true }),
  ];
};

test("a project import emits the full load result and drives localised dialogue", async () => {
  const [projectPath, cleanup] = projectFixture();
  try {
    const code = await callHook(plugin.load, { warn: () => {} }, projectPath);
    const mod = await importEmitted(code as string);

    // Full load result: program plus per-locale tables plus metadata.
    ok(mod.default.program, "program present");
    ok(
      mod.default.projectName !== undefined ||
        mod.default.baseLanguage === "en",
      "localisation metadata present",
    );
    strictEqual(mod.default.baseLanguage, "en");
    ok(
      Object.keys(mod.default.translations.de ?? {}).length > 0,
      "per-locale table present",
    );
    strictEqual(mod.default.assets.de, "Assets/German");

    // Fresh Dialogue per language: delivery is once-per-line, so setLanguage
    // affects subsequent lines only (the core loader test's pattern).
    const base = new Dialogue(mod.default.program, {
      textProvider: createProjectTextProvider(mod.default),
    });
    strictEqual(
      firstLine(base.continue()),
      "Gold 0.",
      "base-language text (speaker prefix stripped; $gold has no declare, so it seeds its implicit number default 0 per upstream)",
    );
    const de = new Dialogue(mod.default.program, {
      textProvider: createProjectTextProvider(mod.default),
    });
    de.setLanguage("de");
    strictEqual(firstLine(de.continue()), "Gold 0. (DE)", "localised text");
  } finally {
    cleanup();
  }
});

test("the emitted project module contains no runtime file access", async () => {
  const [projectPath, cleanup] = projectFixture();
  try {
    const code = await callHook(plugin.load, { warn: () => {} }, projectPath);
    ok(typeof code === "string");
    ok(
      !code.includes("require(") && !code.includes("readFile"),
      "emitted module is pure data",
    );
    // Translation rows ride the emitted tables, not a deferred read.
    ok(code.includes("(DE)"), "translated text baked into the module");
  } finally {
    cleanup();
  }
});

test("?raw on a .yarnproject yields the raw project file", async () => {
  const [projectPath, cleanup] = projectFixture();
  try {
    const code = await callHook(
      plugin.load,
      { warn: () => {} },
      `${projectPath}?raw`,
    );
    const mod = await importEmitted(code as string);
    const parsed = JSON.parse(mod.default);
    strictEqual(parsed.projectFileVersion, 4);
    ok(
      parsed.editorMetadata.openTabs,
      "unknown keys preserved in the raw file",
    );
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
      JSON.stringify({
        projectFileVersion: 4,
        sourceFiles: ["**/*.yarn"],
        baseLanguage: "en",
      }),
    );
    const projectPath = join(dir, "project.yarnproject");
    const err = (await (
      callHook(plugin.load, { warn: () => {} }, projectPath) as Promise<unknown>
    ).then(
      () => null,
      (e: {
        message: string;
        id?: string;
        loc?: { file?: string; line?: number; column?: number };
        frame?: string;
      }) => e,
    )) as {
      message: string;
      id?: string;
      loc?: { file?: string; line?: number; column?: number };
      frame?: string;
    };
    ok(
      err && err.message.includes("YS"),
      `fails with a compiler diagnostic, got ${JSON.stringify(err)}`,
    );
    strictEqual(err.id, projectPath);
    // The diagnostic's own file wins: the loc points into the .yarn source
    // that caused the failure, not the .yarnproject JSON that was imported.
    ok(
      err.loc?.file?.endsWith("broken.yarn"),
      `loc points into the source, got ${JSON.stringify(err.loc)}`,
    );
    ok(
      !err.frame?.includes("projectFileVersion"),
      `frame quotes the source line, got ${JSON.stringify(err.frame)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pinned import whose error is in a .yarn source quotes that source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-pin-frame-"));
  try {
    writeFileSync(join(dir, "broken.yarn"), "title: Start\n===\n");
    writeFileSync(
      join(dir, "project.yarnproject"),
      JSON.stringify({
        projectFileVersion: 4,
        sourceFiles: ["**/*.yarn"],
        baseLanguage: "en",
      }),
    );
    const pinned = yarnSpinnerVitePlugin({
      project: join(dir, "project.yarnproject"),
    });
    const err = (await (
      callHook(
        pinned.load,
        { warn: () => {} },
        join(dir, "broken.yarn"),
      ) as Promise<unknown>
    ).then(
      () => null,
      (e: {
        message: string;
        loc?: { file?: string; line?: number; column?: number };
        frame?: string;
      }) => e,
    )) as {
      message: string;
      loc?: { file?: string; line?: number; column?: number };
      frame?: string;
    } | null;
    ok(
      err && err.message.includes("YS"),
      `fails with a compiler diagnostic, got ${JSON.stringify(err)}`,
    );
    // The loc points into the .yarn source (project loads report source
    // paths relative to the .yarnproject), and the frame quotes THAT file
    // at the loc's line — not the pinned project JSON the import went through.
    ok(
      err.loc?.file?.endsWith("broken.yarn"),
      `loc points into the source, got ${JSON.stringify(err.loc)}`,
    );
    const frameLines = (err.frame ?? "").split("\n");
    const quoted = frameLines[0] ?? "";
    const sourceLines = readFileSync(join(dir, "broken.yarn"), "utf8").split(
      "\n",
    );
    strictEqual(
      quoted,
      sourceLines[(err.loc?.line ?? 0) - 1],
      "frame quotes the loc's line from the .yarn source",
    );
    ok(
      frameLines[1]?.includes("^"),
      `caret rides under the column, got ${JSON.stringify(err.frame)}`,
    );
    ok(
      !err.frame?.includes("projectFileVersion"),
      "the project JSON is not quoted",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a YP-level error quotes the project JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-yp-frame-"));
  try {
    writeFileSync(join(dir, "story.yarn"), "title: Start\n---\nHi\n===\n");
    // Valid JSON, missing the required `baseLanguage`: a YP0003 error whose
    // loc is the project file itself.
    writeFileSync(
      join(dir, "project.yarnproject"),
      JSON.stringify({ projectFileVersion: 4, sourceFiles: ["**/*.yarn"] }),
    );
    const pinned = yarnSpinnerVitePlugin({
      project: join(dir, "project.yarnproject"),
    });
    const err = (await (
      callHook(
        pinned.load,
        { warn: () => {} },
        join(dir, "story.yarn"),
      ) as Promise<unknown>
    ).then(
      () => null,
      (e: {
        message: string;
        loc?: { file?: string; line?: number };
        frame?: string;
      }) => e,
    )) as {
      message: string;
      loc?: { file?: string; line?: number };
      frame?: string;
    } | null;
    ok(
      err && err.message.includes("YP"),
      `fails with a project diagnostic, got ${JSON.stringify(err)}`,
    );
    ok(
      err.loc?.file?.endsWith("project.yarnproject"),
      `loc is the project file, got ${JSON.stringify(err.loc)}`,
    );
    // The frame quotes the project JSON at the loc's line (here: line 1).
    const quoted = (err.frame ?? "").split("\n")[0] ?? "";
    strictEqual(
      quoted,
      readFileSync(join(dir, "project.yarnproject"), "utf8").split("\n")[0],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing strings file is a surfaced warning, not a build failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-proj-warn-"));
  try {
    writeFileSync(
      join(dir, "story.yarn"),
      "title: Start\n---\nHi #line:hi\n===\n",
    );
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
    const code = await callHook(
      plugin.load,
      { warn: (m: unknown) => warnings.push(m) },
      join(dir, "project.yarnproject"),
    );
    ok(
      typeof code === "string" && code.includes("export default"),
      "build succeeds",
    );
    ok(
      warnings.some((w) => String(w).includes("YP0006")),
      `warning surfaced, got ${JSON.stringify(warnings)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
