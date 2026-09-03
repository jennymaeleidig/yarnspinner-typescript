/**
 * Localisation wiring (yarn-project-support ticket 03): the project's
 * `localisation` map drives localised play end-to-end. Each declared
 * locale's strings CSV — the upstream 8-column interchange format (ticket
 * 51) — resolves through the injected file system into a per-locale id →
 * text table, and {@link createProjectTextProvider} glues those tables into
 * a {@link StringTableTextProvider} a `Dialogue` runs with; the runtime's
 * `setLanguage` then switches locales (the ticket-51 language surface).
 *
 * Design constraints on record:
 * - Coding standard §2: pure data in, data out — the strings CSVs are read
 *   through the same injected `YarnProjectFileSystem` the loader used; the
 *   library never touches assets. The `assets` directories surface as the
 *   configured paths (a language → path map) for the host to load; a
 *   nonexistent assets path is not an error here (spec story 15).
 * - Coding standard §3: reading failures are diagnostics, not throws. The
 *   loader's validation (ticket 02) already warns YP0006 for a referenced
 *   strings file that does not exist; this module reports the same code
 *   when the file still cannot be read at consumption time, drops that
 *   locale's table, and carries on — a missing translation blocks
 *   localised playback of that locale, never the base-language compile.
 * - The base table comes from the compile result's string table minus
 *   shadow lines (`text === null` — their content comes from the source
 *   line and the program's baked-in text), matching
 *   `stringTableToEntries`' export contract.
 */

import { csvEntriesToTable, parseCSV } from "./stringsFile.js";
import type { Diagnostic } from "./diagnostics.js";
import type { LoadProjectResult, YarnProjectFileSystem } from "./yarnProject.js";
import { StringTableTextProvider } from "../runtime/textProvider.js";

/** The localisation surface a loaded project exposes to its host. */
export interface ProjectLocalisation {
  /**
   * The base language's id → text mapping, from the compile result's
   * string table (shadow lines excluded). Feeds the provider's base
   * language: a translation that lacks a line falls back to it.
   */
  baseTable: Record<string, string>;
  /** Per-locale id → text tables, one per declared `localisation` locale. */
  translations: Record<string, Record<string, string>>;
  /**
   * The configured assets directory per declared locale, verbatim from the
   * project file — surfaced for the host to load, never touched here.
   */
  assets: Record<string, string>;
  /** Diagnostics from reading the strings files (YP0006 warnings). */
  diagnostics: Diagnostic[];
}

/**
 * Resolve a loaded project's `localisation` map: read each declared
 * locale's strings CSV through the file system, parse it with the
 * strings-file surface, and filter the rows to the declaring locale
 * (the map contract — a locale's file holds that locale's strings).
 * Accepts any `{ project, stringTable }` shape, so both `loadProject` and
 * `loadYarnProject` results work; a failed load (`project: null`) yields
 * an empty localisation with no diagnostics (the load's own errors tell
 * that story).
 */
export function loadLocalisations(
  result: Pick<LoadProjectResult, "project" | "stringTable">,
  fileSystem: YarnProjectFileSystem,
): ProjectLocalisation {
  if (!result.project) {
    return { baseTable: {}, translations: {}, assets: {}, diagnostics: [] };
  }
  const diagnostics: Diagnostic[] = [];

  const baseTable: Record<string, string> = {};
  if (result.stringTable) {
    for (const [id, info] of Object.entries(result.stringTable)) {
      if (info.text !== null) baseTable[id] = info.text;
    }
  }

  const translations: Record<string, Record<string, string>> = {};
  const assets: Record<string, string> = {};
  for (const [lang, entry] of Object.entries(result.project.localisation ?? {})) {
    if (entry.assets !== undefined) assets[lang] = entry.assets;
    let table: Record<string, string> = {};
    if (entry.strings !== undefined) {
      const csvText = fileSystem.read(entry.strings);
      if (csvText === null) {
        diagnostics.push({
          code: "YP0006",
          severity: "warning",
          message: `Localised strings file for \`${lang}\` could not be read: ${entry.strings}`,
          file: entry.strings,
        });
      } else {
        // Rows without an id register nothing (an empty key would shadow
        // every lookup); csvEntriesToTable drops empty-text rows so
        // playback falls back to the base language for untranslated lines.
        const entries = parseCSV(csvText).filter((e) => e.id !== "");
        table = csvEntriesToTable(entries, lang);
      }
    }
    // Every declared locale appears, even one with no strings file — an
    // absent table is an empty one, and playback falls back to base.
    translations[lang] = table;
  }
  return { baseTable, translations, assets, diagnostics };
}

/**
 * Glue the localisation tables into the default text provider (the Rust
 * reference's `StringTableTextProvider`): base language from the string
 * table, one translation table per declared locale. Language selection
 * stays with the runtime surface (`Dialogue.setLanguage`) or the provider
 * directly (`setLanguage`); the returned provider starts in the base
 * language.
 */
export function createProjectTextProvider(
  localisation: ProjectLocalisation,
): StringTableTextProvider {
  const provider = new StringTableTextProvider();
  provider.extendBaseLanguage(localisation.baseTable);
  for (const [lang, table] of Object.entries(localisation.translations)) {
    provider.extendTranslation(lang, table);
  }
  return provider;
}
