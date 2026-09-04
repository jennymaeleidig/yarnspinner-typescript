// SPDX-License-Identifier: CC0-1.0
// The Vite plugin surface. Real-file ids are compiled in place (the mdx/svelte
// precedent) — no virtual modules, hence no resolveId: Vite hands the plugin
// the on-disk id and load answers it. The query contract: ?raw is the raw
// source string; ?url/?inline/?no-inline bail so Vite core owns them, as does
// any other query. Content edits to .yarn — and, once ticket 04 makes them
// modules, .yarnproject — full-reload in dev: a rebuilt Program means a
// rebuilt Dialogue, and variable storage resets regardless (map decision,
// ticket 03 of the wayfinder effort).

import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { compileYarnModule } from "./compileModule.js";
import type { Diagnostic, DiagnosticSeverity } from "yarn-spinner-runner-ts";

const YARN_FILE = /\.yarn$/;
const CONTENT_FILE = /\.yarn(project)?$/;
/** Queries Vite core owns; the plugin must not touch them. */
const BAIL_QUERIES = new Set(["url", "inline", "no-inline"]);

export interface YarnSpinnerVitePluginOptions {
  /**
   * Per-code severity overrides applied before the error/warning split —
   * the project file's `compilerOptions.diagnosticsSeverity` once project
   * context lands (ticket 04); until then host-supplied.
   */
  diagnosticsSeverity?: Record<string, DiagnosticSeverity>;
}

/** Split an id into its file part and query (Vite ids: `file?query`). */
function splitQuery(id: string): { file: string; query: string } {
  const q = id.indexOf("?");
  return q === -1 ? { file: id, query: "" } : { file: id.slice(0, q), query: id.slice(q + 1) };
}

/**
 * Shape a diagnostic as a RollupError: id, 1-based line / 0-based column
 * location, and a frame quoting the offending source line with a caret
 * under the column — clickable in the terminal and the Vite overlay.
 */
function asBuildError(d: Diagnostic, id: string, source: string): object {
  const line = (d.range?.startLine ?? 0) + 1;
  const column = d.range?.startCol ?? 0;
  const context = d.context ?? source.split("\n")[line - 1] ?? "";
  return {
    message: `${d.code}: ${d.message}`,
    id,
    loc: { file: id, line, column },
    frame: `${context}\n${" ".repeat(Math.max(0, column))}^`,
  };
}

export function yarnSpinnerVitePlugin(
  opts: YarnSpinnerVitePluginOptions = {},
): Plugin {
  return {
    name: "yarn-spinner-vite-plugin",
    enforce: "pre",
    async load(id) {
      const { file, query } = splitQuery(id);
      if (!YARN_FILE.test(file)) return;
      if (query === "raw") return `export default ${JSON.stringify(await readFile(file, "utf8"))};`;
      if (BAIL_QUERIES.has(query) || query !== "") return;
      const source = await readFile(file, "utf8");
      const { code, errors, warnings } = compileYarnModule(source, file, {
        diagnosticsSeverity: opts.diagnosticsSeverity,
      });
      for (const w of warnings) this.warn(`${w.code}: ${w.message}`);
      if (errors.length > 0) throw asBuildError(errors[0], id, source);
      return code;
    },
    handleHotUpdate(ctx) {
      if (!CONTENT_FILE.test(ctx.file)) return;
      ctx.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
