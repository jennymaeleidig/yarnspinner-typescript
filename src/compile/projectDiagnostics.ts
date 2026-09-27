// SPDX-License-Identifier: CC0-1.0
/**
 * The project-file (YPxxxx) diagnostics channel: this project's own surface,
 * NOT upstream YS-codes (upstream has no diagnostic registry for project
 * files). Registered locally, deliberately excluded from
 * `DIAGNOSTIC_REGISTRY`, whose entries must have vendored upstream
 * definition files.
 *
 * Split out of `yarnProject.ts` so the pure `.ysls.json` definitions parser
 * can emit project-level diagnostics without importing the loader (no cycle).
 */

import type { Diagnostic, DiagnosticSeverity } from "./diagnostics.js";

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
  // Definitions (`.ysls.json`) are editor tooling: a broken file must not
  // fail the build — the project still compiles, only command validation
  // loses its declared set. Both warn for that reason.
  YP0009: { name: "MalformedDefinitionsFile", defaultSeverity: "warning" },
  YP0010: { name: "UnreadableDefinitionsFile", defaultSeverity: "warning" },
};

/**
 * Build a YPxxxx diagnostic with the registry's default severity — the one
 * shape every project diagnostic takes, so code and severity stay keyed to
 * {@link PROJECT_DIAGNOSTIC_REGISTRY} at every call site.
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
