// SPDX-License-Identifier: CC0-1.0
// The bundler-agnostic compile step: no Vite types cross this module, so the
// future webpack loader (Next.js webpack mode / Turbopack rules) reuses it
// verbatim. Contract (ticket 04 grows the project path; ticket 05 the option
// surface): .yarn source in, a CompiledYarnModule out — the emitted ESM text
// plus the diagnostics partitioned by final severity. The partitioning is
// bundler-neutral; turning each bucket into build failure or a warning is
// the host bundler's job (a webpack loader maps errors to this.emitError).
//
// Severity "none" means present but user-hidden (upstream DiagnosticSeverity
// .None): it reaches neither bucket, so it produces no build signal.

import { compileSource } from "yarn-spinner-runner-ts";
import type { Diagnostic, DiagnosticSeverity } from "yarn-spinner-runner-ts";

export interface CompileYarnOptions {
  /**
   * Per-code severity overrides — the project file's
   * `compilerOptions.diagnosticsSeverity` map once ticket 04 wires project
   * context in. Applied before the error/warning split, so an error
   * downgraded to a warning no longer fails the build.
   */
  diagnosticsSeverity?: Record<string, DiagnosticSeverity>;
}

export interface CompiledYarnModule {
  /** The emitted ESM text: default Program + tree-shakeable named exports. */
  code: string;
  /** Diagnostics whose final severity is "error" — the build must fail. */
  errors: Diagnostic[];
  /** Diagnostics whose final severity is "warning" or "info" — surface, don't fail. */
  warnings: Diagnostic[];
}

export function compileYarnModule(
  source: string,
  filename: string,
  opts: CompileYarnOptions = {},
): CompiledYarnModule {
  const { program, stringTable, containsImplicitStringTags, fileTags, diagnostics } =
    compileSource(source, {
      file: filename,
      diagnosticsSeverity: opts.diagnosticsSeverity,
    });
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning" || d.severity === "info");
  const code =
    `// ${filename} — compiled at build time by yarn-spinner-vite-plugin\n` +
    `export default ${JSON.stringify(program)};\n` +
    `export const stringTable = ${JSON.stringify(stringTable ?? {})};\n` +
    `export const containsImplicitStringTags = ${containsImplicitStringTags};\n` +
    `export const fileTags = ${JSON.stringify(fileTags)};\n`;
  return { code, errors, warnings };
}
