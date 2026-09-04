// SPDX-License-Identifier: CC0-1.0
/**
 * The text provider seam: the injectable resolver from
 * line ID to text for the current language. The runtime is
 * string-table-unaware (CONTEXT.md "Text provider") — the host owns where
 * text comes from; this module ships the default provider mirroring the
 * Rust reference's `TextProvider` trait (`accept_line_hints`, `get_text`,
 * `set_language`, `are_lines_available`) and its
 * `StringTableTextProvider`: a base-language table plus per-language
 * translation tables, missing translations falling back to the base
 * language. The base language is the program's own text — a provider that
 * lacks a line leaves the runtime's baked-in text standing, so an empty
 * provider changes nothing.
 *
 * The CSV strings-file workflow (src/compile/stringsFile.ts) feeds
 * `extendTranslation` via `csvEntriesToTable(parseCSV(csvText), language)`.
 */

/**
 * The injectable resolver from line ID to text for the current language
 * (the Rust reference's `TextProvider` trait). Line IDs are the canonical
 * `line:`-prefixed string-table keys — the same strings as the CSV `id`
 * column and the compile result's string-table keys.
 */
export interface TextProvider {
  /**
   * Lookahead: the line IDs the current node may deliver soon (upstream
   * `PrepareForLines` / Rust `accept_line_hints`). Providers use this to
   * preload or report availability; implementing it is optional.
   */
  acceptLineHints?(lineIds: string[]): void;
  /**
   * The text for the line under the current language, or `undefined` when
   * this provider has none — the runtime then uses the program's own text
   * (the base language).
   */
  getText(lineId: string): string | undefined;
  /**
   * Switch the active language (BCP-47, upstream's language-code
   * convention); `null` selects the base language (Rust `set_language`).
   */
  setLanguage(language: string | null): void;
  /**
   * Whether every hinted line resolves under the current language (Rust
   * `are_lines_available`). Vacuously true before any hints arrive.
   */
  areLinesAvailable(): boolean;
}

/**
 * The default text provider (the Rust reference's
 * `StringTableTextProvider`): a base-language table plus per-language
 * translation tables, with fallback to the base language for lines a
 * translation lacks.
 */
export class StringTableTextProvider implements TextProvider {
  private baseTable: Record<string, string> = {};
  private readonly translations = new Map<string, Record<string, string>>();
  private language: string | null = null;
  private readonly hinted = new Set<string>();

  /** Add (or replace) base-language lines (Rust `extend_base_language`). */
  extendBaseLanguage(table: Record<string, string>): void {
    this.baseTable = { ...this.baseTable, ...table };
  }

  /** Add (or replace) a language's translation lines (Rust `extend_translation`). */
  extendTranslation(language: string, table: Record<string, string>): void {
    this.translations.set(language, { ...this.translations.get(language), ...table });
  }

  setLanguage(language: string | null): void {
    this.language = language;
  }

  getText(lineId: string): string | undefined {
    if (this.language !== null) {
      const translated = this.translations.get(this.language)?.[lineId];
      if (translated !== undefined) return translated;
    }
    return this.baseTable[lineId];
  }

  areLinesAvailable(): boolean {
    // Availability checks the ACTIVE language's table directly — no fallback
    // to base (Rust `are_lines_available`): a missing translation is exactly
    // what this signal reports.
    const table = this.language !== null ? this.translations.get(this.language) : this.baseTable;
    for (const lineId of this.hinted) {
      if (!table || table[lineId] === undefined) return false;
    }
    return true;
  }

  acceptLineHints(lineIds: string[]): void {
    for (const lineId of lineIds) this.hinted.add(lineId);
  }
}
