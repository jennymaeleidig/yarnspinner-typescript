// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 03 — the string table's placeholder contract (upstream
 * `StringTableGeneratorVisitor.GenerateFormattedText` +
 * `LineParser.ExpandSubstitutions`).
 *
 * Upstream composes each string-table entry's `text` with every inline
 * expression replaced by its positional placeholder (`{0}`, `{1}`, … in
 * source order); the evaluated values ride the line event's substitutions,
 * and hosts expand them positionally (upstream `GetComposedTextForLine`).
 * The port stored the authored text (`{2+2}`) verbatim — breaking the
 * interchange contract: CSV locks hashed different bytes and
 * upstream-produced translation rows (`{0}`) rendered the placeholder
 * literally (`du hast {0} Äpfel` → `du hast 0 Äpfel`).
 *
 * The split this pins (superseding ADR 0005's authored-text row for the
 * table artifact only): the TABLE stores placeholder text; the runtime
 * keeps authored-text span expansion for non-table delivery, and
 * localisation rows substitute positionally.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compile, Dialogue, StringTableTextProvider, createCSV, stringTableToEntries } from "../index.js";
import { hasErrors } from "../compile/diagnostics.js";
import { parseCSV } from "../compile/stringsFile.js";
import type { CompileFile } from "../index.js";

const file = (name: string, source: string): CompileFile => ({ name, source });

// ── Table text: positional placeholders ───────────────────────────────────

test("the string table stores positional placeholders for inline expressions", () => {
  const result = compile([
    file("story.yarn", `title: Node
---
you have {2+2} apples
two: {1+1} and {2+2}
===
`),
  ]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => `${d.code}: ${d.message}`).join(", "));
  const texts = Object.values(result.stringTable!).map((e) => e.text).sort();
  assert.deepEqual(texts, ["two: {0} and {1}", "you have {0} apples"]);
});

test("braces that are not expressions survive the table verbatim", () => {
  const result = compile([
    file("story.yarn", `title: Node
---
escaped: \\{0\\} stays
unclosed: { oops
plain } brace
===
`),
  ]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => `${d.code}: ${d.message}`).join(", "));
  const texts = Object.values(result.stringTable!).map((e) => e.text).sort();
  // Escaped braces and an unclosed `{` are not expression spans (the
  // runtime composer's scan contract): the authored characters survive.
  assert.deepEqual(texts, ["escaped: \\{0\\} stays", "plain } brace", "unclosed: { oops"]);
});

test("the CSV lock hash hashes the placeholder-composed text (upstream interop)", () => {
  const result = compile([
    file("story.yarn", `title: Node
---
you have {2+2} apples
===
`),
  ]);
  const csv = createCSV(stringTableToEntries(result.stringTable!, "en"));
  const row = parseCSV(csv)[0];
  // Independent SHA-256 over the placeholder form (`you have {0} apples`) —
  // the bytes upstream's YarnProjectImporter hashes.
  const expected = createHash("sha256").update("you have {0} apples", "utf8").digest("hex").slice(0, 8);
  assert.equal(row.lock, expected);
});

test("shadow validation sees expressions through the placeholders (YS0043/YS0044)", () => {
  // The source line's text now reads `says {0}` in the table; the shadow
  // check must still detect the authored expression (YS0043) — and text
  // equality compares placeholder forms, as upstream's composed strings do.
  const expressionSource = compile([
    file("story.yarn", `title: Node
---
says {1+1} #line:src
shadowed #shadow:src
===
`),
  ]);
  assert.ok(
    expressionSource.diagnostics.some((d) => d.code === "YS0043"),
    "a shadow whose source has expressions reports YS0043",
  );

  // Placeholder-form equality: texts differing only in expression CONTENT
  // compose to the same placeholders, so no YS0044 (upstream compares the
  // composed strings).
  const placeholderEqual = compile([
    file("story.yarn", `title: Node
---
says {1} #line:src
says {2} #shadow:src
===
`),
  ]);
  assert.equal(
    placeholderEqual.diagnostics.some((d) => d.code === "YS0044"),
    false,
    placeholderEqual.diagnostics.filter((d) => d.code === "YS0044").map((d) => d.message).join("; "),
  );

  // Placeholder-form inequality still reports (YS0044).
  const differing = compile([
    file("story.yarn", `title: Node
---
says {1} #line:src
different #shadow:src
===
`),
  ]);
  assert.ok(differing.diagnostics.some((d) => d.code === "YS0044"), "differing text still reports YS0044");
});

// ── Delivery: localisation rows substitute positionally ───────────────────

const STORY = `title: Start
---
You have {2+2} apples.
-> Pick one
    You take {1+1} of them.
===
`;

/** The host workflow: compile, export the base CSV, "translate" to German
 *  with upstream-style `{0}` rows, load into a provider. */
function germanProvider() {
  const result = compile([file("story.yarn", STORY)]);
  assert.ok(result.program && result.stringTable);
  const baseCsv = createCSV(stringTableToEntries(result.stringTable, "en"));
  const germanByBase: Record<string, string> = {
    // The translator receives the placeholder form and localises it,
    // reordering the placeholder the way German word order demands.
    "You have {0} apples.": "Du hast {0} Äpfel.",
    "Pick one": "Nimm eine",
    "You pick {0} of them.": "Du nimmst {0} davon.",
  };
  const translated = parseCSV(baseCsv).map((e) => ({
    ...e,
    language: "de",
    text: germanByBase[e.text] ?? e.text,
  }));
  const provider = new StringTableTextProvider();
  provider.extendTranslation("de", Object.fromEntries(translated.map((e) => [e.id, e.text])));
  return { result, provider };
}

const lineOf = (events: ReturnType<Dialogue["continue"]>) =>
  events.find((e): e is Extract<typeof e, { type: "line" }> => e.type === "line");

test("a localisation row containing {0} renders the evaluated value", () => {
  const { result, provider } = germanProvider();
  const dialogue = new Dialogue(result.program!, { textProvider: provider });
  dialogue.setLanguage("de");
  const line = lineOf(dialogue.continue());
  assert.ok(line);
  // The reviewed divergence: the placeholder rendered literally as `0`.
  assert.equal(line.text, "Du hast 4 Äpfel.");
});

test("positional placeholders substitute by index, not by textual order", () => {
  const result = compile([
    file("story.yarn", `title: Start
---
A {1+1} B {2+2}
===
`),
  ]);
  const provider = new StringTableTextProvider();
  // The translation reorders the placeholders: {1} first, {0} second.
  const lineId = Object.keys(result.stringTable!)[0];
  provider.extendTranslation("de", { [lineId]: "B {1} A {0}" });
  const dialogue = new Dialogue(result.program!, { textProvider: provider });
  dialogue.setLanguage("de");
  const line = lineOf(dialogue.continue());
  assert.ok(line);
  assert.equal(line.text, "B 4 A 2");
});

test("base-language delivery without a provider keeps authored {expr} substitution", () => {
  const { result } = germanProvider();
  const dialogue = new Dialogue(result.program!);
  const line = lineOf(dialogue.continue());
  assert.ok(line);
  assert.equal(line.text, "You have 4 apples.");
});

test("a provider's base-language table (placeholder text) composes the same values", () => {
  const { result } = germanProvider();
  const baseTable = Object.fromEntries(
    Object.entries(result.stringTable!).map(([id, info]) => [id, info.text ?? ""]),
  );
  const provider = new StringTableTextProvider();
  provider.extendBaseLanguage(baseTable);
  const dialogue = new Dialogue(result.program!, { textProvider: provider });
  const line = lineOf(dialogue.continue());
  assert.ok(line);
  assert.equal(line.text, "You have 4 apples.");
});

test("a translation row for an expression-free line substitutes nothing", () => {
  const result = compile([file("story.yarn", `title: Start\n---\nPick one\n===\n`)]);
  const provider = new StringTableTextProvider();
  const lineId = Object.keys(result.stringTable!)[0];
  provider.extendTranslation("de", { [lineId]: "Nimm eine {0}" });
  const dialogue = new Dialogue(result.program!, { textProvider: provider });
  dialogue.setLanguage("de");
  const line = lineOf(dialogue.continue());
  assert.ok(line);
  // Upstream ExpandSubstitutions ignores markers without a substitution
  // (the line has no expressions) — the placeholder composes literally.
  assert.equal(line.text, "Nimm eine {0}");
});
