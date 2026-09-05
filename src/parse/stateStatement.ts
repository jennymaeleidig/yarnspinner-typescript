// SPDX-License-Identifier: CC0-1.0
/**
 * The state-statement grammar (`<<set>>` / `<<declare>>`) — one home for the
 * shape every consumer previously re-parsed by hand: the type checker's
 * regexes, the compiler's `lowerSet` slicing, the runtime's
 * `executeStateStatement` arg-slicing, and the smart-variable classifier's
 * declare regex. Four mechanisms, coordinated by a lockstep comment that
 * was already drifting in the margins (divergent identifier rules, a
 * restated compound-operator table) — now one parse result all four
 * consume.
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
 * Identifiers follow the upstream lexer's ID rule (the shared unicode
 * identifier classes in `identifier.ts` — the full `IDENTIFIER_HEAD`
 * ranges, not the old ASCII read; the earlier stricter-than-upstream
 * `[A-Za-z_][A-Za-z0-9_]*` rejected localized names like `$生命` the g4
 * accepts). Command keywords are lowercase, as every consumer's matcher
 * assumed.
 *
 * Consumers keep their own semantics over the shared parse: the checker
 * validates, the compiler lowers, the runtime executes the fallback, the
 * classifier classifies. The parser's YS0006/YS0005 shape validation
 * (parser.ts) deliberately stays separate — it reports the *malformed*
 * truncation shapes this parser simply rejects, and its regexes are
 * looser by design so it can name what went wrong.
 */

import { IDENTIFIER, NOT_IDENTIFIER_CHARACTER } from "./identifier.js";

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
const COMPOUND_SET = new RegExp(
  `^set\\s+\\$(${IDENTIFIER})\\s*(\\+=|-=|\\*=|/=|%=)\\s*([\\s\\S]+)$`,
  "u",
);
/**
 * Plain assignment: `to` or `=` after the variable, then the expression.
 * The `=` may be attached (`set $x= 1`, `set $x=1` — upstream lexes the
 * attached `=` as the OPERATOR_ASSIGNMENT token); `to` may even run into
 * the expression (`set $x to1` — upstream's OPERATOR_ASSIGNMENT has no
 * word-boundary predicate). The identifier-boundary lookahead after the
 * name keeps `$xto` whole: `set $xto 1` must not mis-read as
 * `set $x to 1` (backtracking into the identifier is forbidden).
 */
const PLAIN_SET = new RegExp(
  `^set\\s+\\$(${IDENTIFIER})${NOT_IDENTIFIER_CHARACTER}\\s*(?:(to)|=)\\s*([\\s\\S]+)$`,
  "u",
);
/** Declaration: `=` or `to` (upstream OPERATOR_ASSIGNMENT is `'=' | 'to'`,
 *  so `<<declare $x to 1>>` is the same statement as `<<declare $x = 1>>`),
 *  expression, optional ` as TYPE`. */
const DECLARE = new RegExp(
  `^declare\\s+\\$(${IDENTIFIER})${NOT_IDENTIFIER_CHARACTER}\\s*(?:(to)|=)\\s*([\\s\\S]+)$`,
  "u",
);
/** The `as TYPE` postfix (anchored at the end, outside any quoted string). */
const AS_TYPE = new RegExp(`\\s+as\\s+(${IDENTIFIER})\\s*$`, "u");

/**
 * Parse a state statement's command content. Returns `null` when the
 * content is not a state statement (another command, or a malformed shape
 * — the parser owns diagnostics for those).
 */
export function parseStateStatement(content: string): StateStatement | null {
  const trimmed = content.trim();

  const compound = COMPOUND_SET.exec(trimmed);
  if (compound) {
    return {
      kind: "set",
      name: compound[1],
      expression: compound[3].trim(),
      compoundOp: compound[2] as CompoundOperator,
    };
  }

  const plain = PLAIN_SET.exec(trimmed);
  if (plain) {
    return {
      kind: "set",
      name: plain[1],
      expression: plain[3].trim(),
      assignment: plain[2] ? ("to" as const) : ("=" as const),
    };
  }

  const declare = DECLARE.exec(trimmed);
  if (declare) {
    const rest = declare[3];
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
export function compoundOperatorToStackOp(
  op: CompoundOperator,
): "add" | "subtract" | "multiply" | "divide" | "modulo" {
  switch (op) {
    case "+=":
      return "add";
    case "-=":
      return "subtract";
    case "*=":
      return "multiply";
    case "/=":
      return "divide";
    case "%=":
      return "modulo";
  }
}
