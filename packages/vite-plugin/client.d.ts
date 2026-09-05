// SPDX-License-Identifier: CC0-1.0
// Ambient declarations for the plugin's import contracts — the implemented
// runtime shapes: the .yarn module (default Program + named string table,
// implicit-tag flag, file tags), its ?raw form, and the .yarnproject module
// (the full load result). Enable with one triple-slash reference in an
// ambient types file:
//
//   /// <reference types="yarn-spinner-vite-plugin/client" />
//
// This file doubles as the zero-dependency paste-in snippet: it references
// only yarn-spinner-runner-ts types (which the host has installed), never
// this package — so it can be pasted verbatim into a project's ambient
// types file instead. It stays a declaration script (no top-level
// import/export) so the paste-in cannot change the host file's module-ness,
// and the named load-result type below is global for the same reason.

/**
 * The full build-time load result of a `.yarnproject` — program, project
 * metadata, base/translated string tables, assets — shaped for
 * `createProjectTextProvider` and localised `Dialogue` playback. This is
 * also what a `.yarn` import emits when the plugin's `project` option pins
 * a project as its compilation context (see the `*.yarn` note below).
 */
interface YarnProjectLoadResult {
  program: import("yarn-spinner-runner-ts").Program | null;
  projectName?: string;
  baseLanguage: string;
  /** The base language's id → text table (the string table, shadow lines excluded). */
  baseTable: Record<string, string>;
  /** Per-locale id → text tables, one per declared localisation locale. */
  translations: Record<string, Record<string, string>>;
  /** The configured assets directory per declared locale, verbatim. */
  assets: Record<string, string>;
  /** Diagnostics from reading the strings files (YP0006 warnings). */
  diagnostics: import("yarn-spinner-runner-ts").Diagnostic[];
}

declare module "*.yarn" {
  // Types the UNPINNED import (the common case): the default export is the
  // bare compiled Program and the named exports ride the module. With the
  // plugin's `project` option pinning a .yarnproject, the same import emits
  // the full one-job load result instead — YarnProjectLoadResult, with none
  // of the named exports. TypeScript cannot vary an ambient declaration by
  // plugin option, so the pinned deviation is stated here rather than unioned
  // into the common case: a pinned host types its import as
  // YarnProjectLoadResult (in scope once this file is referenced).
  const program: import("yarn-spinner-runner-ts").Program;
  export default program;
  /** The compiled string table: line id → text/node/line info. */
  export const stringTable: import("yarn-spinner-runner-ts").StringTable;
  /** Whether the compiler created line IDs for lines lacking #line: tags. */
  export const containsImplicitStringTags: boolean;
  /** Per-file file-level hashtags (the .yarn file's own tags). */
  export const fileTags: Record<string, string[]>;
}

declare module "*.yarn?raw" {
  const source: string;
  export default source;
}

declare module "*.yarnproject" {
  const project: YarnProjectLoadResult;
  export default project;
}
