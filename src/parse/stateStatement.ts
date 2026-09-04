// SPDX-License-Identifier: CC0-1.0
/**
 * The state-statement grammar (`<<set>>` / `<<declare>>`) — one home for the
 * shape every consumer previously re-parsed by hand: the type checker's
 * regexes, the compiler's `lowerSet` slicing, the runtime's
 * `executeStateStatement` arg-slicing, and the smart-variable classifier's
 * declare regex. Four mechanisms, coordinated by a lockstep comment that
 * was already drifting in the margins (divergent identifier rules, a
 * restated compound-operator table) — now one parse result all four
 * consume (deepening-wave-2 ticket 05).
 *
 * Grammar (upstream `set_statement` / `declare_statement`):
 * - `set $var (to|=) expr` — plain assignment;
 * - `set $var (+=|-=|*=|/=|%=) expr` — compound assignment, the operator
 *   token directly after the variable reference (spaced or attached —
 *   upstream lexes the operator as one token);
 * - `declare $var = expr (as TYPE)?` — declaration with optional type
 *   postfix (compile metadata; the postfix is stripped from the value
 *   expression and reported as `declaredType`).
 *
 * Identifiers follow the upstream rule `[A-Za-z_][A-Za-z0-9_]*` (the
 * stricter read — the type checker's old `$(\w+)` accepted `$1abc`, which
 * upstream's lexer never would). Command keywords are lowercase, as every
 * consumer's matcher assumed.
 *
 * Consumers keep their own semantics over the shared parse: the checker
 * validates, the compiler lowers, the runtime executes the fallback, the
 * classifier classifies. The parser's YS0006/YS0005 shape validation
 * (parser.ts) deliberately stays separate — it reports the *malformed*
 * truncation shapes this parser simply rejects, and its regexes are
 * looser by design so it can name what went wrong.
 */

/** The compound-assignment operators (upstream's assignment-operator set). */
export type CompoundOperator = "+=" | "-=" | "*=" | "/=" | "%=";

/** A parsed state statement: the grammar's full shape, stated once. */
export interface StateStatement {
  kind: "set" | "declare";
  /** Variable name without the `$` prefix. */
  name: string;
  /** The value expression (declare: the ` as TYPE` postfix stripped). */
  expression: string;
  /** The assignment operator as authored (plain set only): `to` or `=`. */
  assignment?: "to" | "=";
  /** The compound-assignment operator as authored (compound set only). */
  compoundOp?: CompoundOperator;
  /** `<<declare>>`'s `as TYPE` postfix, when authored. */
  declaredType?: string;
}

/** Compound assignment: the operator token directly after the variable. */
const COMPOUND_SET = /^set\s+\$([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/;
/** Plain assignment: `to` or `=` after whitespace, then the expression. */
const PLAIN_SET = /^set\s+\$([A-Za-z_][A-Za-z0-9_]*)\s+(to|=)\s*([\s\S]+)$/;
/** Declaration: `=` (optionally attached), expression, optional ` as TYPE`. */
const DECLARE = /^declare\s+\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/;
/** The `as TYPE` postfix (anchored at the end, outside any quoted string). */
const AS_TYPE = /\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/**
 * Parse a state statement's command content. Returns `null` when the
 * content is not a state statement (another command, or a malformed shape
 * — the parser owns diagnostics for those).
 */
export function parseStateStatement(content: string): StateStatement | null {
  const trimmed = content.trim();

  const compound = COMPOUND_SET.exec(trimmed);
  if (compound) {
    return { kind: "set", name: compound[1], expression: compound[3].trim(), compoundOp: compound[2] as CompoundOperator };
  }

  const plain = PLAIN_SET.exec(trimmed);
  if (plain) {
    return {
      kind: "set",
      name: plain[1],
      expression: plain[3].trim(),
      assignment: plain[2] as "to" | "=",
    };
  }

  const declare = DECLARE.exec(trimmed);
  if (declare) {
    const rest = declare[2];
    const asMatch = AS_TYPE.exec(rest);
    return {
      kind: "declare",
      name: declare[1],
      expression: (asMatch ? rest.slice(0, asMatch.index) : rest).trim(),
      assignment: "=",
      ...(asMatch ? { declaredType: asMatch[1] } : {}),
    };
  }

  return null;
}

/**
 * A compound operator applied to the variable's current value is the base
 * binary operator (the stack-op set's names) — the one mapping for the
 * compiler's lowering and the runtime's fallback execution, replacing the
 * restated `COMPOUND_OPS` tables.
 */
export function compoundOperatorToStackOp(op: CompoundOperator): "add" | "subtract" | "multiply" | "divide" | "modulo" {
  switch (op) {
    case "+=": return "add";
    case "-=": return "subtract";
    case "*=": return "multiply";
    case "/=": return "divide";
    case "%=": return "modulo";
  }
}
