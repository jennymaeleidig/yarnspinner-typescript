// SPDX-License-Identifier: CC0-1.0
// The Vite plugin surface. Real-file ids are compiled in place (the mdx/svelte
// precedent) — no virtual modules, hence no resolveId: Vite hands the plugin
// the on-disk id and load answers it. The query contract: ?raw is the raw
// source string; ?url/?inline/?no-inline — and any other query — bail so Vite
// core owns them. Content edits to .yarn and .yarnproject full-reload in dev
// via the `handleHotUpdate` hook, which sends a full reload and lets Vite
// re-request the module.

import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { compileYarnModule, type CompiledYarnModule } from "./compileModule.js";
import { compileYarnProjectModule } from "./compileProjectModule.js";
import { toDeclarations, type YslsDefinitions } from "./definitions.js";
import type { Diagnostic, DiagnosticSeverity } from "yarnspinner-typescript";

// The generic-loader seam, made reachable: the compile steps are pure and
// bundler-agnostic (no Vite types cross their modules), so the documented
// webpack-loader contract is importable from this package's main entry —
// a loader author calls the same functions the plugin's load hook calls,
// instead of reaching past the exports map (which blocks deep imports).
export { compileYarnModule, compileYarnProjectModule };
export type {
  CompiledYarnModule,
  CompileYarnOptions,
} from "./compileModule.js";

const PROJECT_FILE = /\.yarnproject$/;
/** A content id of either kind: a .yarn story or a .yarnproject. */
const ANY_YARN_FILE = /\.yarn(project)?$/;

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
    `^${seg
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")}$`,
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
  return q === -1
    ? { file: id, query: "" }
    : { file: id.slice(0, q), query: id.slice(q + 1) };
}

/**
 * The build-surface error shape (RollupError-ish): a message, the imported
 * id, a 1-based line / 0-based column location, and a frame quoting the
 * offending source line with a caret under the column. Hosts catching a
 * failed load get this shape; `loc`/`frame` are absent when there is no
 * meaningful location (e.g. a file that could not be read at all).
 */
export interface YarnBuildError {
  message: string;
  id: string;
  loc?: { file: string; line: number; column: number };
  frame?: string;
}

/**
 * Shape a diagnostic as a RollupError: id, 1-based line / 0-based column
 * location, and a frame quoting the offending source line with a caret
 * under the column — clickable in the terminal and the Vite overlay. The
 * diagnostic's own file wins over the imported id (a project-path error
 * points into the .yarn source that caused it), and the quoted line is
 * read from that file when the diagnostic carries no context of its own.
 * Project loads report source paths relative to the .yarnproject, so the
 * read resolves against `baseDir` — the compilation entry's directory —
 * making the frame quote the file the loc actually points into.
 */
async function asBuildError(
  d: Diagnostic,
  id: string,
  source: string,
  baseDir: string,
): Promise<YarnBuildError> {
  const line = (d.range?.startLine ?? 0) + 1;
  const column = d.range?.startCol ?? 0;
  const file = d.file ?? id;
  let context = d.context;
  if (context === undefined) {
    const text =
      file === id
        ? source
        : await readFile(
            isAbsolute(file) ? file : join(baseDir, file),
            "utf8",
          ).catch(() => "");
    context = text.split("\n")[line - 1] ?? "";
  }
  return {
    message: `${d.code}: ${d.message}`,
    id,
    loc: { file, line, column },
    frame: `${context}\n${" ".repeat(Math.max(0, column))}^`,
  };
}

/** An unreadable compilation file as a build error: the failure names the
 *  file instead of vanishing into an empty frame (a project the plugin
 *  cannot read must fail the build with its path, not compile as if empty). */
function fileReadError(file: string, cause: unknown): YarnBuildError {
  return {
    message: `Cannot read ${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
    id: file,
  };
}

/** A warning's build-surface text: code, message, and where it points —
 *  the file whenever it is known, file:line:column when a range rides
 *  along. */
function asWarning(d: Diagnostic, id: string): string {
  const file = d.file ?? id;
  if (d.range === undefined) return `${d.code}: ${d.message} (${file})`;
  return `${d.code}: ${d.message} (${file}:${d.range.startLine + 1}:${d.range.startCol})`;
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
  const declarations = opts.definitions
    ? toDeclarations(opts.definitions)
    : undefined;

  // Both compile steps take the same derived options — derived once here.
  const compileOpts = { diagnosticsSeverity, declarations };

  // Extension matching first (in load), then the include/exclude layer.
  const filtered = (file: string): boolean => {
    if (matchesAny(opts.exclude, file)) return false;
    if (opts.include !== undefined && !matchesAny(opts.include, file))
      return false;
    return true;
  };

  // One load-and-compile path: the read (with `fileReadError` shaping on both
  // branches), the compile-step choice by file kind + pin, and the single
  // warn closure — the plumbing a new plugin option would otherwise be
  // pasted into twice. The compile steps themselves are the
  // bundler-agnostic seam (ADR 0006) — their interfaces are untouched.
  //
  // Names are root-relative (`configResolved` captures the bundler root):
  // the name flows into node `sourceFile`, string-table `fileName`, line-ID
  // hashing, and diagnostics, and a build-machine absolute path there would
  // ship inside end-user bundles. The relative name always round-trips
  // through join(root, name) — a `..` prefix is fine — and reads stay
  // absolute; without a resolved config (direct compileYarnModule calls)
  // the name is passed through untouched.
  const display = (file: string): string =>
    root === undefined ? file : relative(root, file);
  const loadAndCompile = async (
    id: string,
    file: string,
    warn: (msg: string) => void,
  ): Promise<string> => {
    // The emit tail both compile steps share: warnings to the sink (with
    // location), the first error as a build failure, otherwise the code.
    const emit = async (
      compiled: CompiledYarnModule,
      source: string,
      baseDir: string,
    ): Promise<string> => {
      for (const w of compiled.warnings) warn(asWarning(w, id));
      if (compiled.errors.length > 0) {
        throw await asBuildError(compiled.errors[0], id, source, baseDir);
      }
      return compiled.code;
    };
    if (PROJECT_FILE.test(file) || opts.project !== undefined) {
      // The .yarnproject itself, or a .yarn import pinned to a project:
      // the project compiles as one job and the module emits its result.
      const projectFile = opts.project ?? file;
      const projectText = await readFile(projectFile, "utf8").catch(
        (e: unknown) => {
          throw fileReadError(projectFile, e);
        },
      );
      return emit(
        compileYarnProjectModule(
          projectFile,
          compileOpts,
          display(projectFile),
        ),
        projectText,
        dirname(projectFile),
      );
    }
    const source = await readFile(file, "utf8").catch((e: unknown) => {
      throw fileReadError(file, e);
    });
    return emit(
      compileYarnModule(source, display(file), compileOpts),
      source,
      // Diagnostics carry the display name, so a frame quoting a file
      // other than the imported id resolves against the same base the
      // name is relative to.
      root ?? dirname(file),
    );
  };

  // Captured from the Vite config: the base the root-relative compile
  // names are computed against (see `display`).
  let root: string | undefined;

  return {
    name: "yarnspinner-vite-plugin",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async load(id) {
      const { file, query } = splitQuery(id);
      if (!ANY_YARN_FILE.test(file)) return;
      if (query === "raw")
        return `export default ${JSON.stringify(await readFile(file, "utf8"))};`;
      if (query !== "") return;
      if (!filtered(file)) return;
      return loadAndCompile(id, file, (m) => this.warn(m));
    },
    handleHotUpdate(ctx) {
      if (!ANY_YARN_FILE.test(ctx.file)) return;
      ctx.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
