/**
 * The CSV strings file: the upstream 8-column interchange
 * format for translators — `language,id,text,file,node,lineNumber,lock,
 * comment`. The CSV never exists inside the core compiler (upstream or
 * here): it is the host-integration artifact derived from the compile
 * result's string table, so this module is pure data in, data out (coding
 * standards §2 — hosts read and write the files).
 *
 * Upstream contract (YarnSpinner-Unity):
 * - `StringTableEntry` + `ParseFromCSV`/`CreateCSV` (`Runtime/YarnProject/
 *   StringTableEntry.cs`): named-column records; fields the CSV lacks
 *   default to the empty string (CsvHelper `TryGetField`); quoting follows
 *   RFC 4180 (quote a field containing a comma, quote, or newline; escape
 *   quotes by doubling).
 * - `YarnProjectImporter.GetStringTableEntries` (`Editor/Importers/
 *   YarnProjectImporter.cs`): entries are built from the string table,
 *   skipping entries with `text === null` (shadow lines); `lock` is
 *   `YarnImporter.GetHashString(text, 8)` — the first 8 lowercase hex chars
 *   of the SHA-256 of the base text; `comment` is
 *   `GenerateCommentWithLineMetadata` — `Line metadata: ` + the hashtags
 *   joined by spaces, with `line:`-prefixed entries removed, or the empty
 *   string when nothing remains.
 * - `csvEntriesToTable` provides the id → text mapping the runtime's
 *   text-provider seam consumes (Rust `StringTableTextProvider`); empty
 *   translations are skipped so missing lines fall back to the base
 *   language.
 *
 * Adapted from YarnSpinner-Unity — see CITATION.cff.
 * Citation: Yarn Spinner Pty. Ltd. and contributors — YarnSpinner-Unity
 * (main) [MIT]
 * Source: https://github.com/YarnSpinnerTool/YarnSpinner-Unity
 * Accessed: 2026-09-03
 */

import { sha256Hex } from "./sha256.js";
import type { StringTable } from "./stringTable.js";

/** One row of a CSV strings file (upstream `StringTableEntry`, camelCased). */
export interface StringTableEntry {
  /** The language the line's text is written in. */
  language: string;
  /** The line ID — the same across all localisations (the string-table key). */
  id: string;
  /** The line's text in {@link StringTableEntry.language}. */
  text: string;
  /** The `.yarn` file the line was originally found in. */
  file: string;
  /** The node the line was originally found in. */
  node: string;
  /** The 1-based source line number (as a string, per the CSV contract). */
  lineNumber: string;
  /**
   * The first 8 hex chars of the SHA-256 of the line's base-language text:
   * a translated row whose lock differs from the base row is stale.
   */
  lock: string;
  /** The line's hashtag metadata, for translators (`Line metadata: …`). */
  comment: string;
}

/** The upstream column order (Unity's `CreateCSV` field list). */
const COLUMNS = ["language", "id", "text", "file", "node", "lineNumber", "lock", "comment"] as const;

/**
 * Parse a CSV strings file into entries (upstream
 * `StringTableEntry.ParseFromCSV`). The header row names the columns; rows
 * are matched by header name, so column order and extra columns are
 * tolerated, and missing fields default to the empty string. Unknown
 * columns are ignored.
 */
export function parseCSV(sourceText: string): StringTableEntry[] {
  const rows = parseRows(sourceText);
  if (rows.length === 0) return [];
  const header = rows[0];
  const index = new Map(header.map((name, i) => [name, i]));
  const field = (row: string[], name: string): string => {
    const i = index.get(name);
    return i !== undefined && i < row.length ? row[i] : "";
  };
  const entries: StringTableEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Skip wholly empty rows.
    if (row.length === 1 && row[0] === "") continue;
    entries.push({
      language: field(row, "language"),
      id: field(row, "id"),
      text: field(row, "text"),
      file: field(row, "file"),
      node: field(row, "node"),
      lineNumber: field(row, "lineNumber"),
      lock: field(row, "lock"),
      comment: field(row, "comment"),
    });
  }
  return entries;
}

/**
 * Render entries as a CSV strings file (upstream `StringTableEntry.
 * CreateCSV`): the 8-column header row, then one row per entry, in the
 * given order. Fields containing a comma, quote, or newline are quoted;
 * embedded quotes are doubled.
 */
export function createCSV(entries: Iterable<StringTableEntry>): string {
  const rows: string[][] = [[...COLUMNS]];
  for (const entry of entries) {
    rows.push(COLUMNS.map((column) => entry[column]));
  }
  return rows.map((row) => row.map(quoteField).join(",")).join("\r\n");
}

function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * RFC 4180 record/field splitting: quoted fields may contain commas,
 * escaped quotes (`""`), and newlines of either flavour; a `\r\n` (or
 * bare `\r`/`\n`) outside quotes ends the record.
 */
function parseRows(sourceText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < sourceText.length) {
    const ch = sourceText[i];
    if (ch === '"' && field === "") {
      // Opening quote of a quoted field (only valid at a field start): a
      // quote mid-field is a literal character.
      i += 1;
      while (i < sourceText.length) {
        if (sourceText[i] === '"') {
          if (sourceText[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        field += sourceText[i];
        i += 1;
      }
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && sourceText[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Build CSV entries from a compile result's string table (upstream
 * `YarnProjectImporter.GetStringTableEntries`): one entry per line that has
 * text — entries with `text === null` (shadow lines) are excluded — with
 * the SHA-256 lock and the `Line metadata: …` comment. Entries keep the
 * string table's registration order.
 */
export function stringTableToEntries(table: StringTable, language = "en"): StringTableEntry[] {
  const entries: StringTableEntry[] = [];
  for (const [id, info] of Object.entries(table)) {
    if (info.text === null) continue;
    entries.push({
      language,
      id,
      text: info.text,
      file: info.fileName,
      node: info.nodeName,
      lineNumber: String(info.lineNumber),
      lock: sha256Hex(info.text).slice(0, 8),
      comment: generateCommentWithLineMetadata(info.metadata),
    });
  }
  return entries;
}

/**
 * Upstream `GenerateCommentWithLineMetadata`: `Line metadata: ` followed by
 * each piece of metadata separated by whitespace, with `line:`-prefixed
 * entries (the line ID itself) removed; the empty string when nothing
 * remains.
 */
function generateCommentWithLineMetadata(metadata: string[]): string {
  const cleaned = metadata.filter((m) => !m.startsWith("line:"));
  if (cleaned.length === 0) return "";
  return `Line metadata: ${cleaned.join(" ")}`;
}

/**
 * The id → text mapping the runtime text-provider seam consumes, filtered
 * to a language when given. Entries with an empty `text` are skipped:
 * a missing translation falls back to the base language
 * (`StringTableTextProvider`).
 */
export function csvEntriesToTable(
  entries: Iterable<StringTableEntry>,
  language?: string,
): Record<string, string> {
  const table: Record<string, string> = {};
  for (const entry of entries) {
    if (language !== undefined && entry.language !== language) continue;
    if (entry.text === "") continue;
    table[entry.id] = entry.text;
  }
  return table;
}
