// SPDX-License-Identifier: CC0-1.0
/**
 * The text-provider seam + setLanguage (spec ticket 51; upstream is
 * string-table-unaware — the Rust reference reshapes localisation into an
 * injected `TextProvider`, and the CSV-backed provider ships so hosts can
 * localise end-to-end): `Dialogue` accepts a `TextProvider` (base language
 * = the program's own text; translations come from parsed CSV strings
 * files) and `Dialogue.setLanguage()` switches the active language.
 *
 * The runtime's line IDs are the canonical `line:`-prefixed string-table
 * keys (upstream `Line.ID`), so provider lookups, string-table keys, and
 * CSV `id` column values are all the same string.
 *
 * Ported inline tests (no fixture coverage — inventory fact) cover the
 * provider and the setLanguage swap through the runtime event stream.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, Dialogue, StringTableTextProvider } from "../index.js";
import {
  parseCSV,
  createCSV,
  stringTableToEntries,
  csvEntriesToTable,
} from "../compile/stringsFile.js";
import type { CompileFile } from "../index.js";

const file = (name: string, source: string): CompileFile => ({ name, source });

const STORY = `title: Start
---
<<declare $gold = 0>>
Mae: Gold {$gold}.
-> Take it
    Mae: You took it.
===
`;

// ── StringTableTextProvider (the Rust-reference default provider) ──────────

test("the provider resolves from the base table, falling back by line ID", () => {
  const provider = new StringTableTextProvider();
  provider.extendBaseLanguage({ "line:one": "Hello", "line:two": "Goodbye" });
  provider.extendTranslation("de", { "line:one": "Hallo" });

  assert.equal(provider.getText("line:one"), "Hello");
  assert.equal(provider.getText("line:missing"), undefined);

  provider.setLanguage("de");
  assert.equal(provider.getText("line:one"), "Hallo");
  // Missing translations fall back to the base language.
  assert.equal(provider.getText("line:two"), "Goodbye");

  provider.setLanguage(null);
  assert.equal(provider.getText("line:one"), "Hello");
});

test("areLinesAvailable reports whether all hinted lines resolve in the current language", () => {
  const provider = new StringTableTextProvider();
  provider.extendBaseLanguage({ "line:one": "Hello" });
  provider.extendTranslation("de", {});

  provider.acceptLineHints(["line:one"]);
  assert.equal(provider.areLinesAvailable(), true);

  provider.setLanguage("de");
  assert.equal(provider.areLinesAvailable(), false, "de has no translation for line:one");

  provider.extendTranslation("de", { "line:one": "Hallo" });
  assert.equal(provider.areLinesAvailable(), true);
});

// ── setLanguage over the injected seam (the acceptance case) ────────────────

/** Compile the story, render the base CSV, hand-"translate" it to German, and
 *  load the translated CSV into a provider — the full host workflow. */
function germanProvider() {
  const result = compile([file("story.yarn", STORY)]);
  assert.ok(result.program && result.stringTable);

  const baseCsv = createCSV(stringTableToEntries(result.stringTable, "en"));

  // The "translator": parse the base CSV and replace the text column.
  const baseEntries = parseCSV(baseCsv);
  const german: Record<string, string> = {
    // The string table keeps the authored text verbatim, speaker prefix included.
    "Mae: Gold {$gold}.": "Mae: Gold {$gold}. (DE)",
    "Take it": "Nimm es",
    "Mae: You took it.": "Mae: You took it. (DE)",
  };
  const translated = baseEntries.map((e) => ({
    ...e,
    language: "de",
    text: german[e.text] ?? e.text,
  }));

  const provider = new StringTableTextProvider();
  provider.extendTranslation("de", csvEntriesToTable(parseCSV(createCSV(translated)), "de"));
  return { result, provider };
}

test("setLanguage swaps rendered text from a CSV strings file", () => {
  const {
    result: { program },
    provider,
  } = germanProvider();
  const lineOf = (events: ReturnType<Dialogue["continue"]>) =>
    events.find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");

  // Base language: the program's own text.
  const base = new Dialogue(program!, { textProvider: provider });
  let line = lineOf(base.continue());
  assert.ok(line);
  assert.equal(line.text, "Gold 0.");
  assert.match(line.lineId!, /^line:/, "event line IDs are the canonical string-table keys");

  // Switch language mid-run; the next lines render the CSV text.
  const dialogue = new Dialogue(program!, { textProvider: provider });
  void dialogue.continue(); // base-language line
  dialogue.setLanguage("de");
  void dialogue.continue(); // options event, delivered after the switch
  dialogue.selectOption(0);
  line = lineOf(dialogue.continue());
  assert.ok(line);
  assert.equal(line.text, "You took it. (DE)");

  // setLanguage(null) returns to the base language.
  provider.setLanguage("de");
  const back = new Dialogue(program!, { textProvider: provider });
  back.setLanguage(null);
  line = lineOf(back.continue());
  assert.ok(line);
  assert.equal(line.text, "Gold 0.");
});

test("translated option text resolves through the provider; substitutions still expand", () => {
  const {
    result: { program },
    provider,
  } = germanProvider();

  const dialogue = new Dialogue(program!, { textProvider: provider });
  dialogue.setLanguage("de");
  dialogue.setVariable("gold", 25);

  void dialogue.continue(); // the node-start + base line
  const options = dialogue
    .continue()
    .find((e): e is Extract<typeof e, { type: "options" }> => e.type === "options");
  assert.ok(options, "an options event arrives");
  assert.equal(options.options[0].text, "Nimm es");

  // Selecting the option runs its body; the translated line keeps its
  // `{expr}` substitution live against current variables.
  dialogue.selectOption(0);
  const line = dialogue.continue().find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "You took it. (DE)");
});

test("translated text keeps substitutions live (expanded at delivery, not export)", () => {
  const {
    result: { program },
    provider,
  } = germanProvider();
  const dialogue = new Dialogue(program!, { textProvider: provider });
  dialogue.setLanguage("de");
  dialogue.setVariable("gold", 7);
  const line = dialogue.continue().find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");
  assert.ok(line);
  assert.equal(line.text, "Gold 7. (DE)");
});

test("lineHints feed the provider's availability tracking", () => {
  const {
    result: { program },
    provider,
  } = germanProvider();
  const dialogue = new Dialogue(program!, { textProvider: provider, lineHints: true });
  dialogue.setLanguage("fr"); // a language with no translations loaded
  // areLinesAvailable flips once the node's lines are hinted.
  dialogue.continue();
  assert.equal(provider.areLinesAvailable(), false, "fr has no translations");
});

test("setLanguage without a provider reports a diagnostic and changes nothing", () => {
  const result = compile([file("story.yarn", STORY)]);
  const errors: string[] = [];
  const dialogue = new Dialogue(result.program!, { logError: (m) => errors.push(m) });
  dialogue.setLanguage("de");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no text provider/);
});
