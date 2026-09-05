// SPDX-License-Identifier: CC0-1.0
/**
 * Diagnostics channel (coding standards §3 collect-don't-throw).
 *
 * Shape mirrors upstream `YarnSpinner.Diagnostics.Diagnostic` (3.2.2):
 * { code, severity, message, file, range, context }. Codes and default
 * severities follow the upstream per-code definitions registry
 * (test/fixtures/upstream/YarnSpinner/YarnSpinner.Diagnostics/Definitions/YSxxxx-*.md) —
 * the authoritative source (the docs site is stale on severities).
 *
 * Ranges are upstream-style 0-based line/column, inclusive start, exclusive
 * end. `file` and `context` are optional (single-source compiles may omit
 * file; multi-file compiles carry it).
 */

export type DiagnosticSeverity = "error" | "warning" | "info" | "none";

export interface YarnRange {
  startLine: number; // 0-based
  startCol: number; // 0-based
  endLine: number;
  endCol: number;
}

/** The severity vocabulary a project file's `diagnosticsSeverity` map may
 * assign (upstream `DiagnosticSeverity`, including `None` = present but
 * user-hidden). Shared with the validation guard so the union and the
 * runtime check cannot drift apart. */
export const DIAGNOSTIC_SEVERITIES = ["error", "warning", "info", "none"] as const;

export function isDiagnosticSeverity(value: unknown): value is DiagnosticSeverity {
  return typeof value === "string" && (DIAGNOSTIC_SEVERITIES as readonly string[]).includes(value);
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
 * The first-spec tranche of adoptable codes, plus the syntax
 * basics. Every entry here must have a vendored definition file — enforced by
 * src/tests/diagnostics.test.ts — and every vendored example of a registered
 * code must emit that code (the diagnostic golden loop in
 * src/tests/diagnosticExamples.test.ts).
 *
 * Deliberately NOT registered: YS0013 UnknownFunction — upstream 3.2.2 marks
 * it `generated_in: languageserver` (the compiler never emits it; it creates
 * implicit function declarations instead, which the Inference-*
 * fixture conformance adopts). It joins when mandatory function declarations
 * land upstream.
 */
export const DIAGNOSTIC_REGISTRY: Record<string, DiagnosticDescriptor> = {
  YS0003: { name: "UndefinedVariable", defaultSeverity: "warning" },
  YS0004: { name: "MissingDelimiter", defaultSeverity: "error" },
  YS0005: { name: "SyntaxError", defaultSeverity: "error" },
  YS0006: { name: "UnclosedCommand", defaultSeverity: "error" },
  YS0007: { name: "UnclosedScope", defaultSeverity: "error" },
  YS0011: { name: "DuplicateNodeTitle", defaultSeverity: "error" },
  YS0012: { name: "UndefinedNode", defaultSeverity: "warning" },
  YS0014: { name: "WrongFunctionParameters", defaultSeverity: "error" },
  YS0017: { name: "LinesCantHaveLineAndShadowTag", defaultSeverity: "error" },
  YS0018: { name: "DuplicateLineID", defaultSeverity: "error" },
  YS0019: { name: "LineContentAfterCommand", defaultSeverity: "warning" },
  YS0020: { name: "CommandFollowingLine", defaultSeverity: "error" },
  YS0021: { name: "StrayCommandEnd", defaultSeverity: "warning" },
  YS0022: { name: "UnenclosedCommand", defaultSeverity: "warning" },
  YS0027: { name: "InvalidNodeName", defaultSeverity: "error" },
  YS0028: { name: "TypeInferenceFailure", defaultSeverity: "error" },
  YS0029: { name: "ExpressionTypeUndetermined", defaultSeverity: "error" },
  YS0030: { name: "SmartVariableReadOnly", defaultSeverity: "error" },
  YS0031: { name: "NodeGroupMissingWhen", defaultSeverity: "error" },
  YS0032: { name: "DuplicateSubtitle", defaultSeverity: "error" },
  YS0033: { name: "EmptyNode", defaultSeverity: "warning" },
  YS0035: { name: "EnumDeclarationError", defaultSeverity: "error" },
  YS0037: { name: "InvalidLiteralValue", defaultSeverity: "error" },
  YS0038: { name: "InvalidMemberAccess", defaultSeverity: "error" },
  YS0039: { name: "RedeclarationOfExistingVariable", defaultSeverity: "error" },
  YS0040: { name: "RedeclarationOfExistingType", defaultSeverity: "error" },
  YS0041: { name: "InternalError", defaultSeverity: "error" },
  YS0042: { name: "UnknownLineIDForShadowLine", defaultSeverity: "error" },
  YS0043: { name: "ShadowLinesCantHaveExpressions", defaultSeverity: "error" },
  YS0044: { name: "ShadowLinesMustHaveSameTextAsSource", defaultSeverity: "error" },
  YS0045: { name: "SmartVariableLoop", defaultSeverity: "error" },
  YS0048: { name: "SingularCommandWrap", defaultSeverity: "warning" },
  YS0050: { name: "TypeCheckerError", defaultSeverity: "error" },
  YS0051: { name: "NodeMissingTitle", defaultSeverity: "error" },
  YS0052: { name: "NodeHasMoreThanOneTitle", defaultSeverity: "error" },
  YS0053: { name: "DeclarationValueDoesntMatchType", defaultSeverity: "error" },
  YS0062: { name: "MultipleLineOrShadowIDsOnALine", defaultSeverity: "error" },
  YS0063: { name: "MarkupFailedToParse", defaultSeverity: "warning" },
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

/**
 * Apply per-code severity overrides as one final pass over the collected
 * diagnostics — the overridden severity is the final severity everywhere
 * (upstream `CompilerOptions.DiagnosticsSeverity`; `none` keeps the
 * diagnostic present but user-hidden). One implementation for every compile
 * path: the core's own modes and the plugin package's project compile step
 * layer their maps over this, so the severity-precedence contract cannot
 * drift between them.
 */
export function applySeverityOverrides(
  diagnostics: Diagnostic[],
  severityMap: Record<string, DiagnosticSeverity> | undefined,
): void {
  if (!severityMap) return;
  for (const d of diagnostics) {
    const override = severityMap[d.code];
    if (override) d.severity = override;
  }
}
