// SPDX-License-Identifier: CC0-1.0
/**
 * YarnProject loader: parses upstream-style
 * `.yarnproject` files (format v4, legacy v2 accepted, the dead dev v3
 * rejected), resolves `sourceFiles`/`excludeFiles` glob patterns against an
 * injected {@link YarnProjectFileSystem}, and feeds the resolved
 * `{ name, source }` files to `compile()` (the multi-file seam).
 *
 * Design constraints on record:
 * - Coding standard §2: this module performs no I/O — the file system is
 *   injected, and glob matching is pure computation. The Node default
 *   provider lives in `nodeProjectFs.ts`, a separate module so the main
 *   entry stays browser-safe.
 * - Coding standard §1: the file format is upstream's (schema:
 *   https://schemas.yarnspinner.dev/yarnproject.schema.json) — v2 accepted
 *   like upstream, v3 rejected as the dead dev version.
 * - Coding standard §3: every problem is a diagnostic, nothing throws.
 *
 * YPxxxx codes are this project's own surface, NOT upstream YS-codes:
 * upstream has no diagnostic registry for project files. They are local
 * (registered in PROJECT_DIAGNOSTIC_REGISTRY below, like the YS registry is
 * locally registered) and deliberately excluded from DIAGNOSTIC_REGISTRY,
 * whose entries must have vendored upstream definition files.
 */

import { compile, hasErrors } from "./compileSource.js";
import type { CompileFile, CompileOptions, CompileResult } from "./compileSource.js";
import type { Diagnostic, DiagnosticSeverity } from "./diagnostics.js";

// ── Diagnostics (this project's own YP registry) ──────────────────────────

export const PROJECT_DIAGNOSTIC_REGISTRY: Record<
  string,
  { name: string; defaultSeverity: DiagnosticSeverity }
> = {
  YP0001: { name: "InvalidProjectFile", defaultSeverity: "error" },
  YP0002: { name: "UnsupportedProjectFileVersion", defaultSeverity: "error" },
  YP0003: { name: "MissingOrMalformedProjectField", defaultSeverity: "error" },
  YP0004: { name: "UnknownProjectField", defaultSeverity: "warning" },
  YP0005: { name: "UnsupportedCompilerOption", defaultSeverity: "warning" },
  // Warning, not error: a missing strings file blocks localised playback of
  // that locale, not compilation of the base-language dialogue — the project
  // still loads and compiles (the Space fixture acceptance depends on it).
  YP0006: { name: "MissingStringsFile", defaultSeverity: "warning" },
  YP0007: { name: "NoSourceFilesMatched", defaultSeverity: "error" },
  YP0008: { name: "UnreadableSourceFile", defaultSeverity: "error" },
};

/**
 * Build a YPxxxx diagnostic with the registry's default severity — the one
 * shape every project diagnostic takes, so code and severity stay keyed to
 * {@link PROJECT_DIAGNOSTIC_REGISTRY} at every call site. Shared with the
 * localisation-wiring module; not intended for consumer use.
 *
 * @internal
 */
export function projectDiagnostic(
  code: keyof typeof PROJECT_DIAGNOSTIC_REGISTRY & string,
  message: string,
  file?: string,
  context?: string,
): Diagnostic {
  return {
    code,
    severity: PROJECT_DIAGNOSTIC_REGISTRY[code].defaultSeverity,
    message,
    ...(file ? { file } : {}),
    ...(context ? { context } : {}),
  };
}

const DEFAULT_PROJECT_FILE = "project.yarnproject";

/**
 * The one shape every failure path returns — one literal, so the error
 * paths cannot drift apart (code-review finding). Shared with the `./node`
 * boundary module; not intended for consumer use.
 *
 * @internal
 */
export function failedResult(
  diagnostics: Diagnostic[],
  project: YarnProject | null = null,
  sources: string[] = [],
): LoadProjectResult {
  return {
    program: null,
    stringTable: null,
    declarations: [],
    diagnostics,
    fileTags: {},
    containsImplicitStringTags: false,
    userDefinedTypes: [],
    project,
    sources,
  };
}

// ── Public types ──────────────────────────────────────────────────────────

/**
 * File access bound to one project directory. Paths are POSIX-style
 * (`/`-separated) and relative to that directory. {@link listFiles}
 * enumerates every file (not directory) recursively; {@link read} returns
 * the file's text or `null` when it does not exist / is unreadable.
 */
export interface YarnProjectFileSystem {
  listFiles(): string[];
  read(path: string): string | null;
}

/**
 * A validated `.yarnproject` (upstream format v4 / legacy v2): the fields
 * this loader consumes, with everything else either ignored as known-editor
 * surface or diagnosed. See the upstream schema for field documentation.
 */
export interface YarnProject {
  projectFileVersion: number;
  sourceFiles: string[];
  baseLanguage: string;
  excludeFiles?: string[];
  projectName?: string;
  /** Per-locale string-table CSV paths and asset directories; resolved by `projectLocalisation.ts`. */
  localisation?: Record<string, { strings?: string; assets?: string }>;
}

/** Options for {@link loadProject} and {@link listSources}. */
export interface LoadProjectOptions extends CompileOptions {
  /** The `.yarnproject` contents — raw JSON text or an already-parsed object. */
  project: string | Record<string, unknown>;
  /** File access bound to the project directory. */
  fileSystem: YarnProjectFileSystem;
  /** Name used in diagnostics for the project file itself. */
  projectFile?: string;
}

/** What {@link loadProject} returns: a {@link CompileResult} plus project context. */
export interface LoadProjectResult extends CompileResult {
  /** The validated project, or `null` when validation failed (error diagnostics). */
  project: YarnProject | null;
  /** The resolved source paths (POSIX-relative, sorted) fed to `compile()`. */
  sources: string[];
}

/** What {@link listSources} returns. */
export interface SourceList {
  sources: string[];
  diagnostics: Diagnostic[];
}

// ── Glob matching (pure; upstream pattern semantics) ──────────────────────

/**
 * Match a POSIX-relative path against one glob pattern: `**` spans zero or
 * more segments, `*`/`?` stay within a segment, patterns anchor at the
 * project root. No brace expansion or character classes (upstream's
 * documented patterns don't use them); document limits in consumer docs.
 */
function matchGlob(path: string, pattern: string): boolean {
  const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const pathSegs = path.split("/");
  const patSegs = p.split("/");
  return matchPathSegments(pathSegs, patSegs);
}

function matchPathSegments(path: string[], pattern: string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...rest] = pattern;
  if (head === "**") {
    // `**` matches zero or more segments — try consuming each prefix.
    for (let i = 0; i <= path.length; i++) {
      if (matchPathSegments(path.slice(i), rest)) return true;
    }
    return false;
  }
  if (path.length === 0) return false;
  if (!matchPathSegment(path[0], head)) return false;
  return matchPathSegments(path.slice(1), rest);
}

/** Match one path segment against one pattern segment (`*`/`?` wildcards). */
function matchPathSegment(segment: string, part: string): boolean {
  // Iterative wildcard match: `*` = zero+ chars, `?` = exactly one char.
  let p = 0; // index into segment
  let m = 0; // index into part
  let star = -1;
  let mark = 0;
  while (p < segment.length) {
    if (m < part.length && (part[m] === "?" || part[m] === segment[p])) {
      p++;
      m++;
    } else if (m < part.length && part[m] === "*") {
      star = m;
      mark = p;
      m++;
    } else if (star !== -1) {
      m = star + 1;
      mark++;
      p = mark;
    } else {
      return false;
    }
  }
  while (m < part.length && part[m] === "*") m++;
  return m === part.length;
}

// ── Validation (pure) ─────────────────────────────────────────────────────

/** Supported format versions: v4 current, v2 legacy, v3 the dead dev version. */
const SUPPORTED_VERSIONS = [2, 4] as const;

interface ParseOutcome {
  project: YarnProject | null;
  diagnostics: Diagnostic[];
}

/**
 * Parse and validate a `.yarnproject`. Pure: shape validation only —
 * filesystem-dependent checks (strings-file existence, source resolution)
 * happen in the loader. Returns `project: null` alongside error diagnostics.
 */
export function parseYarnProject(
  project: string | Record<string, unknown>,
  projectFile = DEFAULT_PROJECT_FILE,
): ParseOutcome {
  const diagnostics: Diagnostic[] = [];
  let raw: Record<string, unknown> | null = null;
  if (typeof project === "string") {
    try {
      const parsed: unknown = JSON.parse(project);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        diagnostics.push(
          projectDiagnostic("YP0001", "Project file must contain a JSON object", projectFile),
        );
      } else {
        raw = parsed as Record<string, unknown>;
      }
    } catch (e) {
      diagnostics.push(
        projectDiagnostic(
          "YP0001",
          `Project file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
          projectFile,
        ),
      );
    }
  } else {
    raw = project;
  }
  if (!raw) return { project: null, diagnostics };

  const fail = (diag: Diagnostic): ParseOutcome => {
    diagnostics.push(diag);
    return { project: null, diagnostics };
  };

  // projectFileVersion: required, integer, 2 or 4 (3 is the dead dev version).
  const version = raw.projectFileVersion;
  if (version === undefined) {
    return fail(projectDiagnostic("YP0003", "Required field `projectFileVersion` is missing", projectFile));
  }
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return fail(
      projectDiagnostic(
        "YP0002",
        `\`projectFileVersion\` must be an integer, got ${JSON.stringify(version)}`,
        projectFile,
      ),
    );
  }
  if (version === 3) {
    return fail(
      projectDiagnostic(
        "YP0002",
        "`projectFileVersion` 3 is not supported (a dead development version); use 4 (or legacy 2)",
        projectFile,
      ),
    );
  }
  if (!(SUPPORTED_VERSIONS as readonly number[]).includes(version)) {
    return fail(
      projectDiagnostic(
        "YP0002",
        `\`projectFileVersion\` ${version} is not supported (supported: 2, 4)`,
        projectFile,
      ),
    );
  }

  // sourceFiles: required, array of strings (schema default `**/*.yarn` only
  // applies when the schema fills the file; an absent required field is a
  // validation failure here).
  const sourceFiles = raw.sourceFiles;
  if (sourceFiles === undefined) {
    return fail(projectDiagnostic("YP0003", "Required field `sourceFiles` is missing", projectFile));
  }
  if (
    !Array.isArray(sourceFiles) ||
    sourceFiles.some((s) => typeof s !== "string")
  ) {
    return fail(
      projectDiagnostic("YP0003", "`sourceFiles` must be an array of glob strings", projectFile),
    );
  }

  // baseLanguage: required string.
  const baseLanguage = raw.baseLanguage;
  if (baseLanguage === undefined) {
    return fail(projectDiagnostic("YP0003", "Required field `baseLanguage` is missing", projectFile));
  }
  if (typeof baseLanguage !== "string") {
    return fail(
      projectDiagnostic("YP0003", "`baseLanguage` must be a string language code", projectFile),
    );
  }

  // excludeFiles: optional array of strings.
  const excludeFiles = raw.excludeFiles;
  if (excludeFiles !== undefined && (!Array.isArray(excludeFiles) || excludeFiles.some((s) => typeof s !== "string"))) {
    return fail(
      projectDiagnostic("YP0003", "`excludeFiles` must be an array of glob strings", projectFile),
    );
  }

  // projectName / authorName: optional, but the schema types them — malformed
  // values are diagnosed (failures legible, never silent).
  if (raw.projectName !== undefined && typeof raw.projectName !== "string") {
    return fail(projectDiagnostic("YP0003", "`projectName` must be a string", projectFile));
  }
  if (
    raw.authorName !== undefined &&
    (!Array.isArray(raw.authorName) || raw.authorName.some((a) => typeof a !== "string"))
  ) {
    return fail(
      projectDiagnostic("YP0003", "`authorName` must be an array of author name strings", projectFile),
    );
  }

  // localisation: optional map of language → { strings?, assets? }.
  let localisation: YarnProject["localisation"];
  const rawLocalisation = raw.localisation;
  if (rawLocalisation !== undefined) {
    if (typeof rawLocalisation !== "object" || rawLocalisation === null || Array.isArray(rawLocalisation)) {
      return fail(
        projectDiagnostic(
          "YP0003",
          "`localisation` must map language codes to { strings?, assets? } objects",
          projectFile,
        ),
      );
    }
    localisation = {};
    for (const [lang, entry] of Object.entries(rawLocalisation)) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return fail(
          projectDiagnostic(
            "YP0003",
            `\`localisation.${lang}\` must be an object with optional \`strings\` and \`assets\` paths`,
            projectFile,
          ),
        );
      }
      const e = entry as Record<string, unknown>;
      if (e.strings !== undefined && typeof e.strings !== "string") {
        return fail(
          projectDiagnostic("YP0003", `\`localisation.${lang}.strings\` must be a string path`, projectFile),
        );
      }
      if (e.assets !== undefined && typeof e.assets !== "string") {
        return fail(
          projectDiagnostic("YP0003", `\`localisation.${lang}.assets\` must be a string path`, projectFile),
        );
      }
      // The schema closes localisation entries (additionalProperties: false) —
      // unknown keys (e.g. a `strins` typo) warn per key, like top-level ones.
      for (const key of Object.keys(e)) {
        if (key !== "strings" && key !== "assets") {
          diagnostics.push(
            projectDiagnostic(
              "YP0004",
              `Unknown field \`${key}\` in \`localisation.${lang}\` (not in the v4 schema)`,
              projectFile,
              `localisation.${lang}.${key}`,
            ),
          );
        }
      }
      localisation[lang] = {
        ...(e.strings !== undefined ? { strings: e.strings as string } : {}),
        ...(e.assets !== undefined ? { assets: e.assets as string } : {}),
      };
    }
  }

  // Unknown top-level fields: the v4 schema closes the object
  // (additionalProperties: false) — warn per unknown key so typos surface
  // without hard-failing forward-compatible readers.
  const KNOWN_FIELDS = new Set([
    "projectFileVersion",
    "projectName",
    "authorName",
    "sourceFiles",
    "excludeFiles",
    "baseLanguage",
    "localisation",
    "compilerOptions",
    // Known-but-deferred/ignored surface: definitions (.ysls.json) is editor
    // tooling this loader deliberately does not consume; editorOptions is
    // editor-only. Both are schema-known, so neither warns.
    "definitions",
    "editorOptions",
  ]);
  for (const key of Object.keys(raw)) {
    if (!KNOWN_FIELDS.has(key)) {
      diagnostics.push(
        projectDiagnostic(
          "YP0004",
          `Unknown project field \`${key}\` (not in the v4 schema)`,
          projectFile,
          key,
        ),
      );
    }
  }

  // compilerOptions: the schema leaves it open (additionalProperties: true),
  // so unknown keys are valid per upstream — but this compiler has no
  // equivalent for anything it doesn't recognise, so every key either maps
  // or is diagnosed. Nothing is silently dropped (no-silent-option-drops).
  const compilerOptions = raw.compilerOptions;
  if (compilerOptions !== undefined) {
    if (typeof compilerOptions !== "object" || compilerOptions === null || Array.isArray(compilerOptions)) {
      return fail(
        projectDiagnostic("YP0003", "`compilerOptions` must be an object", projectFile),
      );
    }
    for (const key of Object.keys(compilerOptions)) {
      const knownUpstream =
        key === "requireVariableDeclarations" || key === "allowPreviewFeatures";
      diagnostics.push(
        projectDiagnostic(
          "YP0005",
          knownUpstream
            ? `\`compilerOptions.${key}\` has no equivalent in this compiler and was ignored`
            : `\`compilerOptions.${key}\` is not recognised by this compiler and was ignored`,
          projectFile,
          `compilerOptions.${key}`,
        ),
      );
    }
  }

  const project0: YarnProject = {
    projectFileVersion: version,
    sourceFiles: sourceFiles as string[],
    baseLanguage,
    ...(excludeFiles !== undefined ? { excludeFiles: excludeFiles as string[] } : {}),
    ...(typeof raw.projectName === "string" ? { projectName: raw.projectName } : {}),
    ...(localisation !== undefined ? { localisation } : {}),
  };
  return { project: project0, diagnostics };
}

// ── Source resolution + loading ───────────────────────────────────────────

interface Resolved {
  sources: string[];
  diagnostics: Diagnostic[];
}

function resolveSources(
  project: YarnProject,
  fileSystem: YarnProjectFileSystem,
  projectFile: string,
): Resolved {
  const diagnostics: Diagnostic[] = [];
  const excludes = project.excludeFiles ?? [];
  const matched = fileSystem
    .listFiles()
    .filter((f) => project.sourceFiles.some((p) => matchGlob(f, p)))
    .filter((f) => !excludes.some((p) => matchGlob(f, p)))
    .sort();
  if (matched.length === 0) {
    diagnostics.push(
      projectDiagnostic(
        "YP0007",
        `No source files matched \`sourceFiles\` (${project.sourceFiles.join(", ")})`,
        projectFile,
      ),
    );
  }
  // Referenced strings files must exist — diagnosed here at validation time;
  // consuming their contents is projectLocalisation.ts (localisation wiring).
  for (const [lang, entry] of Object.entries(project.localisation ?? {})) {
    if (entry.strings !== undefined && fileSystem.read(entry.strings) === null) {
      diagnostics.push(
        projectDiagnostic(
          "YP0006",
          `Localised strings file for \`${lang}\` not found: ${entry.strings}`,
          projectFile,
          entry.strings,
        ),
      );
    }
  }
  return { sources: matched, diagnostics };
}

function toCompileFiles(sources: string[], fileSystem: YarnProjectFileSystem): {
  files: CompileFile[];
  diagnostics: Diagnostic[];
} {
  const files: CompileFile[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const path of sources) {
    const source = fileSystem.read(path);
    if (source === null) {
      diagnostics.push(
        projectDiagnostic("YP0008", `Source file matched but could not be read: ${path}`, path),
      );
      continue;
    }
    files.push({ name: path, source });
  }
  return { files, diagnostics };
}

/**
 * `loadProject`/`listSources` share their options shape: everything except
 * the three loader-specific keys IS a {@link CompileOptions} — and since
 * `LoadProjectOptions extends CompileOptions`, the options object passes to
 * `compile()` as-is (the loader keys ride along unobserved).
 */

/**
 * List the source files a project resolves to, without compiling — the
 * `ysc list-sources` equivalent. Pure with respect to the library: all I/O
 * goes through the injected file system.
 */
export function listSources(opts: LoadProjectOptions): SourceList {
  const projectFile = opts.projectFile ?? "project.yarnproject";
  const { project, diagnostics } = parseYarnProject(opts.project, projectFile);
  if (!project) return { sources: [], diagnostics };
  const resolved = resolveSources(project, opts.fileSystem, projectFile);
  return { sources: resolved.sources, diagnostics: [...diagnostics, ...resolved.diagnostics] };
}

/**
 * Load an upstream-style `.yarnproject` and compile its sources in one call:
 * parse + validate, resolve `sourceFiles` minus `excludeFiles`, feed the
 * resolved `{ name, source }` files to `compile()`. On validation errors the
 * compile is skipped (`program: null`, `project: null`) and the diagnostics
 * carry the reasons; on success YP warnings ride alongside compile output.
 */
export function loadProject(opts: LoadProjectOptions): LoadProjectResult {
  const projectFile = opts.projectFile ?? DEFAULT_PROJECT_FILE;
  const { project, diagnostics } = parseYarnProject(opts.project, projectFile);
  if (!project || hasErrors(diagnostics)) {
    return failedResult(diagnostics, project);
  }
  const resolved = resolveSources(project, opts.fileSystem, projectFile);
  const allDiagnostics = [...diagnostics, ...resolved.diagnostics];
  if (hasErrors(resolved.diagnostics)) {
    return failedResult(allDiagnostics, project, resolved.sources);
  }
  const { files, diagnostics: readDiagnostics } = toCompileFiles(resolved.sources, opts.fileSystem);
  const result = compile(files, opts);
  return {
    ...result,
    diagnostics: [...allDiagnostics, ...readDiagnostics, ...result.diagnostics],
    project,
    sources: resolved.sources,
  };
}
