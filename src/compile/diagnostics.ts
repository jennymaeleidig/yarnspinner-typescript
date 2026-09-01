/**
 * Diagnostics channel (spec ticket 10; coding standards §3 collect-don't-throw).
 *
 * Shape mirrors upstream `YarnSpinner.Diagnostics.Diagnostic` (3.2.2):
 * { code, severity, message, file, range, context }. Codes and default
 * severities follow the vendored per-code definitions registry
 * (test/fixtures/upstream/YarnSpinner/Diagnostics/Definitions/YSxxxx-*.md) —
 * the authoritative source (the docs site is stale on severities).
 *
 * Ranges are upstream-style 0-based line/column, inclusive start, exclusive
 * end. `file` and `context` are optional (single-source compiles may omit
 * file; the multi-file surface arrives with the phase-3 compiler reshape).
 */

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface YarnRange {
  startLine: number; // 0-based
  startCol: number; // 0-based
  endLine: number;
  endCol: number;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  range?: YarnRange;
  /** The source line the diagnostic refers to (upstream `context`). */
  context?: string;
}

interface DiagnosticDescriptor {
  name: string;
  defaultSeverity: DiagnosticSeverity;
}

/**
 * The first-spec tranche of adoptable codes (tickets 09/10), plus the syntax
 * basics. Every entry here must have a vendored definition file — enforced by
 * src/tests/diagnostics.test.ts.
 */
export const DIAGNOSTIC_REGISTRY: Record<string, DiagnosticDescriptor> = {
  YS0004: { name: "MissingDelimiter", defaultSeverity: "error" },
  YS0005: { name: "SyntaxError", defaultSeverity: "error" },
  YS0006: { name: "UnclosedCommand", defaultSeverity: "error" },
  YS0007: { name: "UnclosedScope", defaultSeverity: "error" },
  YS0011: { name: "DuplicateNodeTitle", defaultSeverity: "error" },
  YS0012: { name: "UndefinedNode", defaultSeverity: "warning" },
  YS0021: { name: "StrayCommandEnd", defaultSeverity: "warning" },
  YS0027: { name: "InvalidNodeName", defaultSeverity: "error" },
  YS0030: { name: "SmartVariableReadOnly", defaultSeverity: "error" },
  YS0031: { name: "NodeGroupMissingWhen", defaultSeverity: "error" },
  YS0032: { name: "DuplicateSubtitle", defaultSeverity: "error" },
  YS0033: { name: "EmptyNode", defaultSeverity: "warning" },
  YS0041: { name: "InternalError", defaultSeverity: "error" },
  YS0045: { name: "SmartVariableLoop", defaultSeverity: "error" },
  YS0050: { name: "TypeCheckerError", defaultSeverity: "error" },
  YS0051: { name: "NodeMissingTitle", defaultSeverity: "error" },
  YS0052: { name: "NodeHasMoreThanOneTitle", defaultSeverity: "error" },
};

/** Build a diagnostic from a registry code, filling in the default severity. */
export function makeDiagnostic(
  code: string,
  message: string,
  opts: { file?: string; range?: YarnRange; context?: string } = {},
): Diagnostic {
  const descriptor = DIAGNOSTIC_REGISTRY[code];
  if (!descriptor) {
    // Programming error: emitting an unregistered code. Keep the diagnostic
    // flowing (collect-don't-throw) but flag it as an internal error.
    return { code: "YS0041", severity: "error", message: `Internal compiler error: diagnostic ${code} is not registered`, ...opts };
  }
  return { code, severity: descriptor.defaultSeverity, message, ...opts };
}

/** True when the diagnostics contain at least one error. */
export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
