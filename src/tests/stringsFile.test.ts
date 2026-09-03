/**
 * CSV strings files (spec ticket 51; upstream 8-column interchange): the
 * CSV never exists inside the core compiler — it is the host-integration
 * artifact derived from the compile result's string table (Unity
 * `StringTableEntry.ParseFromCSV`/`CreateCSV` + `YarnProjectImporter`'s
 * entry-building). The 8 columns are `language,id,text,file,node,
 * lineNumber,lock,comment`; `lock` is the first 8 lowercase hex chars of
 * the SHA-256 of the line's base-language text (`YarnImporter.GetHashString`);
 * `comment` is the line's hashtag metadata rendered as `Line metadata: …`
 * with `line:`-prefixed entries removed (`GenerateCommentWithLineMetadata`);
 * entries with `text === null` (shadow lines) are excluded.
 *
 * Lock vectors are cross-checked against node's `node:crypto` SHA-256 — an
 * implementation independent of this repo's `src/compile/sha256.ts`.
 * The CSV behavior has no fixture coverage upstream (inventory fact); the
 * ported inline tests below cover it through the compile output.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compile } from "../index.js";
import { hasErrors } from "../compile/diagnostics.js";
import type { CompileFile } from "../index.js";
import {
  parseCSV,
  createCSV,
  stringTableToEntries,
  csvEntriesToTable,
} from "../compile/stringsFile.js";

const file = (name: string, source: string): CompileFile => ({ name, source });

/** Independent lock recomputation: node's SHA-256 (not this repo's sha256.ts). */
function nodeLock(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

const ENTRY = {
  language: "en",
  id: "line:1eaf1e55",
  text: "Hello",
  file: "story.yarn",
  node: "Start",
  lineNumber: "3",
  lock: "abcdef01",
  comment: "Line metadata: lastline",
};

// ── parseCSV / createCSV (upstream StringTableEntry.ParseFromCSV/CreateCSV) ──

test("createCSV writes the upstream 8-column header (CRLF records, RFC 4180)", () => {
  const csv = createCSV([ENTRY]);
  const [header] = csv.split("\r\n");
  assert.equal(header, "language,id,text,file,node,lineNumber,lock,comment");
});

test("parseCSV(createCSV(entries)) round-trips entries", () => {
  const entries = [
    ENTRY,
    { ...ENTRY, id: "line:feedface", text: "Goodbye", lineNumber: "4", comment: "" },
  ];
  const parsed = parseCSV(createCSV(entries));
  assert.deepEqual(parsed, entries);
});

test("fields containing commas, quotes, and newlines round-trip", () => {
  const entry = {
    ...ENTRY,
    text: 'He said "run", then: stop\ngone',
    comment: 'Line metadata: tag with "quotes" and, commas',
  };
  const parsed = parseCSV(createCSV([entry]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].text, entry.text);
  assert.equal(parsed[0].comment, entry.comment);
});

test("parseCSV handles \\r\\n line endings and missing trailing fields", () => {
  const parsed = parseCSV(
    "language,id,text,file,node,lineNumber,lock,comment\r\nen,line:x,Hi,file.yarn,Node\r\n",
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "line:x");
  assert.equal(parsed[0].lock, "");
  assert.equal(parsed[0].comment, "");
});

test("parseCSV ignores unknown columns and defaults missing ones (TryGetField semantics)", () => {
  const parsed = parseCSV(
    "id,extra,language\ndropdown,line:one,fr",
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "dropdown");
  assert.equal(parsed[0].language, "fr");
  assert.equal(parsed[0].text, "");
});

// ── stringTableToEntries (upstream YarnProjectImporter.GetStringTableEntries) ──

test("string table entries carry the 8 columns with SHA-256 locks and metadata comments", () => {
  const result = compile([
    file(
      "story.yarn",
      `title: Start
---
Hello there. #line:hello #apple
===
`,
    ),
  ]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  const entries = stringTableToEntries(result.stringTable!, "en");
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.language, "en");
  assert.equal(entry.id, "line:hello");
  assert.equal(entry.text, "Hello there.");
  assert.equal(entry.file, "story.yarn");
  assert.equal(entry.node, "Start");
  assert.equal(entry.lineNumber, "3");
  // The lock cross-check: first 8 hex chars of the SHA-256 of the base text,
  // recomputed here with node:crypto.
  assert.equal(entry.lock, nodeLock("Hello there."));
  // The comment is the hashtag metadata with the line: tag removed
  // (GenerateCommentWithLineMetadata).
  assert.equal(entry.comment, "Line metadata: apple");
  // The rendered CSV round-trips.
  const parsed = parseCSV(createCSV(entries));
  assert.equal(parsed[0].lock, entry.lock);
});

test("entries with no leftover metadata get an empty comment; lastline joins the metadata", () => {
  const result = compile([
    file(
      "story.yarn",
      `title: Start
---
Pick one.
-> First option
===
`,
    ),
  ]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  const entries = stringTableToEntries(result.stringTable!);
  const line = entries.find((e) => e.text === "Pick one.")!;
  assert.equal(line.comment, "Line metadata: lastline");
  const option = entries.find((e) => e.text === "First option")!;
  // The option's implicit ID is written back into its tags, so the comment
  // filters it out and carries nothing else.
  assert.equal(option.comment, "");
});

test("shadow entries (text null) are excluded from the CSV", () => {
  const result = compile([
    file(
      "story.yarn",
      `title: Start
---
This is a line. #line:source
This is a line. #shadow:source
===
`,
    ),
  ]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  assert.ok(Object.values(result.stringTable!).some((e) => e.text === null), "precondition: a shadow entry exists");
  const entries = stringTableToEntries(result.stringTable!);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "line:source");
});

// ── csvEntriesToTable (the provider-facing shape) ──────────────────────────

test("csvEntriesToTable maps id → text, filtered by language", () => {
  const csv = createCSV([
    { ...ENTRY, language: "en", text: "Hello" },
    { ...ENTRY, language: "de", id: "line:2222222", text: "Hallo" },
    { ...ENTRY, language: "de", id: "line:3333333", text: "" },
  ]);
  const all = csvEntriesToTable(parseCSV(csv));
  assert.deepEqual(all, { "line:1eaf1e55": "Hello", "line:2222222": "Hallo" });
  const de = csvEntriesToTable(parseCSV(csv), "de");
  // Empty translations are skipped: missing lines fall back to the base.
  assert.deepEqual(de, { "line:2222222": "Hallo" });
});
