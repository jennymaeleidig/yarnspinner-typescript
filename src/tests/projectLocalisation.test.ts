/**
 * Localisation wiring (yarn-project-support ticket 03): the project's
 * `localisation` map drives localised play end-to-end — each declared
 * locale's strings CSV resolves through the strings-file surface (ticket
 * 51's CSV + provider tests are the prior art) into a text provider, and a
 * `Dialogue` running with that provider emits lines in the chosen locale,
 * with `setLanguage` switching per the runtime's language surface. The
 * `assets` directories surface as configured paths — the library never
 * loads assets.
 *
 * Seams: `loadLocalisations` over the injected file system (in-memory for
 * the pure paths, the Node provider against a tmpdir for the end-to-end
 * fixture — test-side I/O only, coding standard §2), and `Dialogue` event
 * streams through `createProjectTextProvider`'s provider.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compile,
  createProjectTextProvider,
  Dialogue,
  loadLocalisations,
  loadProject,
} from "../index.js";
import type { CompileFile, YarnProjectFileSystem } from "../index.js";
import { createCSV, csvEntriesToTable, parseCSV, stringTableToEntries } from "../compile/stringsFile.js";
import { nodeProjectFs } from "../compile/nodeProjectFs.js";

const file = (name: string, source: string): CompileFile => ({ name, source });

/** The fixture story compiled directly — the line-ID reference for lookups. */
const baseCompile = (): ReturnType<typeof compile> => compile([file("story.yarn", STORY)]);

const STORY = `title: Start
---
<<declare $gold = 0>>
Mae: Gold {$gold}.
-> Take it
    Mae: You took it.
===
`;

const ypCodes = (diagnostics: { code: string }[]) =>
  diagnostics.map((d) => d.code).filter((c) => c.startsWith("YP"));

/** In-memory provider bound to a fake project directory (POSIX-relative paths). */
function memoryFs(files: Record<string, string>): YarnProjectFileSystem {
  const names = Object.keys(files).sort();
  return {
    listFiles: () => [...names],
    read: (p: string) => (p in files ? files[p] : null),
  };
}

/**
 * The full host workflow of ticket 51, saved to disk: compile the story,
 * export its base CSV, hand-"translate" the German rows, and write the CSV
 * as the project's declared German strings file. With `translateAll` every
 * row is filled (an availability check requires the whole node's lines);
 * the default leaves one line untranslated to exercise the fallback.
 */
function germanCSV(opts: { translateAll?: boolean } = {}): string {
  const result = baseCompile();
  assert.ok(result.stringTable);
  const german: Record<string, string> = {
    // The string table keeps the authored text verbatim, speaker prefix included.
    "Mae: Gold {$gold}.": "Mae: Gold {$gold}. (DE)",
    "Take it": "Nimm es",
    // Left untranslated by default: an empty text row falls back to the base language.
    "Mae: You took it.": opts.translateAll ? "Du hast es genommen. (DE)" : "",
  };
  const entries = stringTableToEntries(result.stringTable, "en").map((e) => ({
    ...e,
    language: "de",
    text: german[e.text] ?? e.text,
  }));
  return createCSV(entries);
}

const PROJECT = {
  projectFileVersion: 4,
  sourceFiles: ["**/*.yarn"],
  baseLanguage: "en",
  localisation: {
    de: { strings: "German.csv", assets: "Assets/German" },
  },
};

/** Load the fixture project from an in-memory directory and localise it. */
function localisedFixture(csv = germanCSV()) {
  const fs = memoryFs({ "story.yarn": STORY, "German.csv": csv });
  const loaded = loadProject({ project: PROJECT, fileSystem: fs });
  assert.ok(loaded.program && loaded.project, "fixture project loads cleanly");
  const localisation = loadLocalisations(loaded, fs);
  return { loaded, localisation, fileSystem: fs };
}

/** The line ID the fixture's string table registers for the given text. */
function idOf(table: Record<string, { text: string | null }>, text: string): string {
  const id = Object.keys(table).find((k) => table[k].text === text);
  assert.ok(id, `no line registered with text: ${text}`);
  return id;
}

// ── localisation map → per-locale CSV string tables ────────────────────────

test("the localisation map resolves each declared locale's strings CSV", () => {
  const { localisation } = localisedFixture();
  assert.deepEqual(localisation.diagnostics, []);
  const compile = baseCompile();
  const goldId = idOf(compile.stringTable!, "Mae: Gold {$gold}.");
  const takeId = idOf(compile.stringTable!, "Take it");
  assert.equal(localisation.translations["de"]?.[goldId], "Mae: Gold {$gold}. (DE)");
  assert.equal(localisation.translations["de"]?.[takeId], "Nimm es");
});

test("the base table comes from the compile result's string table, shadow lines excluded", () => {
  const story = `title: Start
---
<<declare $gold = 0>>
Mae: Gold {$gold}.
-> Take it
    Mae: You took it.
===

title: Shadows
---
A source line. #line:source
A shadowed line. #shadow:source
===
`;
  // Rebuild the German CSV against the shadowed story so IDs agree.
  const result = compile([file("story.yarn", story)]);
  assert.ok(result.stringTable);
  const shadowId = Object.entries(result.stringTable).find(
    ([, info]) => info.shadowLineID !== null,
  )![0];
  const entries = stringTableToEntries(result.stringTable, "en").map((e) => ({
    ...e,
    language: "de",
    text: `${e.text} (DE)`,
  }));
  const fs = memoryFs({
    "story.yarn": story,
    "German.csv": createCSV(entries),
  });
  const loaded = loadProject({ project: PROJECT, fileSystem: fs });
  assert.ok(loaded.program);
  const localisation = loadLocalisations(loaded, fs);

  const goldId = idOf(result.stringTable!, "Mae: Gold {$gold}.");
  assert.equal(localisation.baseTable[goldId], "Mae: Gold {$gold}.");
  assert.equal(
    localisation.baseTable[shadowId],
    undefined,
    "shadow lines register no base-table text (content comes from the source line)",
  );
});

test("CSV rows are filtered to the declared locale; rows without an id are skipped", () => {
  // A mixed-language file: only the de rows belong to the de locale.
  const mixed = [
    "language,id,text,file,node,lineNumber,lock,comment",
    'en,"line:a","Hello",story.yarn,Start,1,,',
    'de,"line:a","Hallo",story.yarn,Start,1,,',
    'de,"","Orphan row",story.yarn,Start,2,,',
  ].join("\r\n");
  const { localisation } = localisedFixture(mixed);
  assert.deepEqual(localisation.translations["de"], { "line:a": "Hallo" });
});

test("the base language can be declared in the localisation map like any other locale", () => {
  const result = compile([file("story.yarn", STORY)]);
  assert.ok(result.stringTable);
  const baseCsv = createCSV(stringTableToEntries(result.stringTable, "en"));
  const fs = memoryFs({
    "story.yarn": STORY,
    "English.csv": baseCsv,
  });
  const loaded = loadProject({
    project: {
      ...PROJECT,
      localisation: {
        en: { strings: "English.csv" },
        de: { strings: "German.csv" },
      },
    },
    fileSystem: fs,
  });
  assert.ok(loaded.project);
  const localisation = loadLocalisations(loaded, fs);
  assert.ok(localisation.translations["en"]);
  assert.ok(Object.keys(localisation.translations["en"]).length > 0);
});

test("a strings file missing at read time diagnoses YP0006 and drops the locale", () => {
  // The file system has no German.csv — loadProject's validation already
  // warned; the localisation read reports the same failure and carries on.
  const fs = memoryFs({ "story.yarn": STORY });
  const loaded = loadProject({ project: PROJECT, fileSystem: fs });
  assert.ok(loaded.program, "a missing strings file warns but does not block the compile");
  assert.ok(ypCodes(loaded.diagnostics).includes("YP0006"));

  const localisation = loadLocalisations(loaded, fs);
  assert.deepEqual(ypCodes(localisation.diagnostics), ["YP0006"]);
  assert.deepEqual(localisation.translations["de"], {});
});

// ── assets directories surface as configured paths, never loaded ──────────

test("assets directories surface as the configured paths; nonexistent ones are fine", () => {
  // "Assets/German" does not exist in the fixture's file system — surfacing
  // the configured path must not require or touch it.
  const { localisation } = localisedFixture();
  assert.deepEqual(localisation.assets, { de: "Assets/German" });
});

test("a locale declaring only assets surfaces the path without a translation", () => {
  const fs = memoryFs({ "story.yarn": STORY });
  const loaded = loadProject({
    project: { ...PROJECT, localisation: { fr: { assets: "Assets/French" } } },
    fileSystem: fs,
  });
  assert.ok(loaded.project);
  const localisation = loadLocalisations(loaded, fs);
  assert.deepEqual(localisation.assets, { fr: "Assets/French" });
  assert.deepEqual(localisation.translations["fr"], {});
  assert.deepEqual(localisation.diagnostics, []);
});

test("a failed load (project: null) yields an empty localisation with no diagnostics", () => {
  const fs = memoryFs({ "story.yarn": STORY });
  const loaded = loadProject({
    project: { ...PROJECT, projectFileVersion: 3 },
    fileSystem: fs,
  });
  assert.equal(loaded.project, null);
  const localisation = loadLocalisations(loaded, fs);
  assert.deepEqual(localisation.baseTable, {});
  assert.deepEqual(localisation.translations, {});
  assert.deepEqual(localisation.assets, {});
  assert.deepEqual(localisation.diagnostics, []);
});

// ── provider glue: Dialogue runs the project's locales ─────────────────────

test("the provider plays the German locale end-to-end through Dialogue events", () => {
  const { loaded, localisation } = localisedFixture();
  const provider = createProjectTextProvider(localisation);
  const dialogue = new Dialogue(loaded.program!, { textProvider: provider });
  dialogue.setLanguage("de");
  dialogue.setVariable("gold", 25);

  const events = dialogue.continue();
  const line = events.find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");
  assert.ok(line, "a line event arrives");
  assert.equal(line.text, "Gold 25. (DE)", "translated text keeps its substitution live");

  const options = dialogue
    .continue()
    .find((e): e is Extract<typeof e, { type: "options" }> => e.type === "options");
  assert.ok(options, "an options event arrives");
  assert.equal(options.options[0].text, "Nimm es", "option text resolves through the provider");

  dialogue.selectOption(0);
  const last = dialogue
    .continue()
    .find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");
  assert.ok(last);
  assert.equal(last.text, "You took it.", "an empty CSV text row falls back to the base language");
});

test("setLanguage switches locales on the runtime's language surface", () => {
  const { loaded, localisation } = localisedFixture();
  const provider = createProjectTextProvider(localisation);
  const lineOf = (d: Dialogue) =>
    d.continue().find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");

  // Base language first (no setLanguage call — null is the default).
  const base = new Dialogue(loaded.program!, { textProvider: provider });
  assert.equal(lineOf(base)?.text, "Gold 0.");

  // Switch mid-conversation to German.
  const de = new Dialogue(loaded.program!, { textProvider: provider });
  de.setLanguage("de");
  assert.equal(lineOf(de)?.text, "Gold 0. (DE)");

  // …and a dialogue continuing under the same provider goes back to base.
  const back = new Dialogue(loaded.program!, { textProvider: provider });
  back.setLanguage("de");
  void lineOf(back);
  back.setLanguage(null);
  const options = back
    .continue()
    .find((e): e is Extract<typeof e, { type: "options" }> => e.type === "options");
  assert.ok(options);
  assert.equal(options.options[0].text, "Take it", "null selects the base language");
});

test("the provider's availability signal tracks the active locale over hinted lines", () => {
  // A fully translated locale: the whole node's hinted lines resolve.
  const { loaded, localisation } = localisedFixture(germanCSV({ translateAll: true }));
  const provider = createProjectTextProvider(localisation);
  const dialogue = new Dialogue(loaded.program!, { textProvider: provider, lineHints: true });

  dialogue.continue();
  assert.equal(provider.areLinesAvailable(), true, "base language resolves every hinted line");

  dialogue.setLanguage("de");
  dialogue.setNode("Start");
  dialogue.continue();
  assert.equal(provider.areLinesAvailable(), true, "de resolves every hinted line");

  dialogue.setLanguage("fr");
  dialogue.setNode("Start");
  dialogue.continue();
  assert.equal(provider.areLinesAvailable(), false, "fr has no translations at all");
});

test("a partially translated locale reports unavailable lines (no fallback in the signal)", () => {
  const { loaded, localisation } = localisedFixture();
  const provider = createProjectTextProvider(localisation);
  const dialogue = new Dialogue(loaded.program!, { textProvider: provider, lineHints: true });
  dialogue.setLanguage("de");
  dialogue.continue();
  assert.equal(
    provider.areLinesAvailable(),
    false,
    "the untranslated line is missing from the de table — the signal reports it (playback still falls back)",
  );
});

// ── Node end-to-end (real files, test-side I/O) ────────────────────────────

test("loadYarnProject's Node provider localises a real project directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-loc-"));
  try {
    writeFileSync(join(dir, "story.yarn"), STORY);
    writeFileSync(join(dir, "German.csv"), germanCSV());
    const fs = nodeProjectFs(dir);
    const loaded = loadProject({
      project: JSON.stringify(PROJECT),
      fileSystem: fs,
      projectFile: "project.yarnproject",
    });
    assert.ok(loaded.program && loaded.project);
    const localisation = loadLocalisations(loaded, fs);
    assert.deepEqual(localisation.diagnostics, []);

    const provider = createProjectTextProvider(localisation);
    const dialogue = new Dialogue(loaded.program, { textProvider: provider });
    dialogue.setLanguage("de");
    const line = dialogue
      .continue()
      .find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");
    assert.ok(line);
    assert.equal(line.text, "Gold 0. (DE)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// csvEntriesToTable is the strings-file surface the glue consumes (prior art
// from ticket 51) — a smoke check that the glue's filtering matches it.
test("the glue's per-locale tables match csvEntriesToTable's filtering", () => {
  const csv = germanCSV();
  const viaGlue = localisedFixture(csv).localisation.translations["de"];
  const viaSurface = csvEntriesToTable(parseCSV(csv), "de");
  assert.deepEqual(viaGlue, viaSurface);
});
