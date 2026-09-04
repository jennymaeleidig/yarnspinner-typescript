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
// types file instead.

declare module "*.yarn" {
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
  import type { Diagnostic, Program } from "yarn-spinner-runner-ts";

  /** The full build-time load result, shaped for createProjectTextProvider. */
  const project: {
    program: Program | null;
    projectName?: string;
    baseLanguage: string;
    /** The base language's id → text table (the string table, shadow lines excluded). */
    baseTable: Record<string, string>;
    /** Per-locale id → text tables, one per declared localisation locale. */
    translations: Record<string, Record<string, string>>;
    /** The configured assets directory per declared locale, verbatim. */
    assets: Record<string, string>;
    /** Diagnostics from reading the strings files (YP0006 warnings). */
    diagnostics: Diagnostic[];
  };
  export default project;
}
