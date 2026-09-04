// SPDX-License-Identifier: CC0-1.0
// The Vite plugin surface. Real-file ids are compiled in place (the mdx/svelte
// precedent) — no virtual modules, hence no resolveId: Vite hands the plugin
// the on-disk id and load answers it. The query contract: ?raw is the raw
// source string; ?url/?inline/?no-inline — and any other query — bail so Vite
// core owns them. Content edits to .yarn and .yarnproject full-reload in dev:

import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { compileYarnModule, type CompiledYarnModule } from "./compileModule.js";
import { compileYarnProjectModule } from "./compileProjectModule.js";
import { toDeclarations, type YslsDefinitions } from "./definitions.js";
import type { Diagnostic, DiagnosticSeverity } from "yarn-spinner-runner-ts";

const YARN_FILE = /\.yarn$/;
const PROJECT_FILE = /\.yarnproject$/;
const CONTENT_FILE = /\.yarn(project)?$/;

export interface YarnSpinnerVitePluginOptions {
  /**
   * Per-code severity overrides applied before the error/warning split —
   * the project file's `compilerOptions.diagnosticsSeverity` map may also
   * supply these (the project's own values apply; this option merges over
   * them).
   */
  diagnosticsSeverity?: Record<string, DiagnosticSeverity>;
  /**
   * Pin an explicit `.yarnproject` as the compilation context for `.yarn`
   * imports: the project compiles as one job (its program, string table,
   * localisation), and pinned imports emit that result. No upward
   * discovery — unpinned imports stay standalone.
   */
  project?: string;
  /**
   * `.ysls.json`-shaped definitions — file paths or inline objects — whose
   * commands/functions become compile-time signatures: build-time checking
   * sees the host's Library surface.
   */
  definitions?: Array<string | YslsDefinitions>;
  /**
   * Compiler-options passthrough, merged over the pinned project's own
   * `compilerOptions` (the plugin's values win).
   */
  compilerOptions?: {
    diagnosticsSeverity?: Record<string, DiagnosticSeverity>;
  };
  /**
   * Include/exclude filters over the file path, layered on extension
   * matching: excluded files never load; with include set, only matching
   * files load. Patterns are globs (`**` spans segments, `*`/`?` stay
   * within one); a RegExp matches the path directly. Arrays are OR-ed.
   */
  include?: string | RegExp | Array<string | RegExp>;
  exclude?: string | RegExp | Array<string | RegExp>;
}

/** Match one path segment against one pattern segment (`*`/`?` within it). */
function matchSegment(seg: string, value: string): boolean {
  const rx = new RegExp(
    `^${seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`,
  );
  return rx.test(value);
}

/** One glob-or-regexp filter against a path (unanchored, picomatch-style:
 *  a pattern matches any suffix of the path; `**` spans zero+ segments). */
function matchesFilter(pattern: string | RegExp, path: string): boolean {
  if (pattern instanceof RegExp) return pattern.test(path);
  const pathSegs = path.replace(/\\/g, "/").split("/");
  const patSegs = pattern.replace(/\\/g, "/").replace(/^\.\//, "").split("/");
  for (let start = 0; start < pathSegs.length; start++) {
    if (matchSegments(pathSegs.slice(start), patSegs)) return true;
  }
  return false;
}

function matchSegments(path: string[], pattern: string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...rest] = pattern;
  if (head === "**") {
    for (let k = 0; k <= path.length; k++) {
      if (matchSegments(path.slice(k), rest)) return true;
    }
    return false;
  }
  if (path.length === 0 || !matchSegment(head, path[0])) return false;
  return matchSegments(path.slice(1), rest);
}

function matchesAny(
  filters: string | RegExp | Array<string | RegExp> | undefined,
  path: string,
): boolean {
  if (filters === undefined) return false;
  const list = Array.isArray(filters) ? filters : [filters];
  return list.some((f) => matchesFilter(f, path));
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
  // The merged severity map: the top-level option, then the compiler-options
  // passthrough (more specific wins). Derived once.
  const diagnosticsSeverity = {
    ...opts.diagnosticsSeverity,
    ...opts.compilerOptions?.diagnosticsSeverity,
  };
  // The definitions' Library surface, derived once at plugin creation
  // (.ysls.json files are read here, Node side).
  const declarations = opts.definitions ? toDeclarations(opts.definitions) : undefined;

  // Extension matching first (in load), then the include/exclude layer.
  const filtered = (file: string): boolean => {
    if (matchesAny(opts.exclude, file)) return false;
    if (opts.include !== undefined && !matchesAny(opts.include, file)) return false;
    return true;
  };

  const settle = (
    compiled: CompiledYarnModule,
    id: string,
    source: string,
    warn: (msg: string) => void,
  ): string => {
    for (const w of compiled.warnings) warn(`${w.code}: ${w.message}`);
    if (compiled.errors.length > 0) throw asBuildError(compiled.errors[0], id, source);
    return compiled.code;
  };

  return {
    name: "yarn-spinner-vite-plugin",
    enforce: "pre",
    async load(id) {
      const { file, query } = splitQuery(id);
      if (!PROJECT_FILE.test(file) && !YARN_FILE.test(file)) return;
      if (query === "raw") return `export default ${JSON.stringify(await readFile(file, "utf8"))};`;
      if (query !== "") return;
      if (!filtered(file)) return;
      if (PROJECT_FILE.test(file) || (opts.project !== undefined && YARN_FILE.test(file))) {
        // The .yarnproject itself, or a .yarn import pinned to a project:
        // the project compiles as one job and the module emits its result.
        const projectFile = opts.project ?? file;
        return settle(
          compileYarnProjectModule(projectFile, {
            diagnosticsSeverity,
            declarations,
          }),
          id,
          await readFile(projectFile, "utf8").catch(() => ""),
          (m) => this.warn(m),
        );
      }
      const source = await readFile(file, "utf8");
      return settle(
        compileYarnModule(source, file, {
          diagnosticsSeverity,
          declarations,
        }),
        id,
        source,
        (m) => this.warn(m),
      );
    },
    handleHotUpdate(ctx) {
      if (!CONTENT_FILE.test(ctx.file)) return;
      ctx.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
