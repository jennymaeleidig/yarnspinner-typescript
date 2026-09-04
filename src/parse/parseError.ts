// SPDX-License-Identifier: CC0-1.0
/**
 * A parse-level problem (coding standards §3: collect-don't-throw — the
 * compile seam converts these to diagnostics; nothing escapes the seam).
 *
 * Its own module so both the lexer and the parser can raise it without an
 * import cycle (parser.ts re-exports it for its historical importers).
 */
export class ParseError extends Error {
  /** 0-based source range of the offending token, when known. */
  range?: { startLine: number; startCol: number; endLine: number; endCol: number };
  /**
   * The registry YS-code the compile seam should report.
   * Upstream's error listener assigns codes beyond plain syntax errors —
   * an unclosed command is YS0006, not YS0005 — so raiseable parse
   * problems carry their code. Absent → the seam reports YS0005.
   */
  code?: string;
  constructor(message: string, range?: ParseError["range"], code?: string) {
    super(message);
    this.range = range;
    this.code = code;
  }
}
