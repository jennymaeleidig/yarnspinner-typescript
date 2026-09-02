/**
 * Expression codegen (ADR 0001): the compile-time counterpart of the
 * runtime string evaluator. Condition and assignment expressions compile
 * to stack bytecode instead of being re-evaluated from strings.
 *
 * The parser is a conventional recursive-descent precedence climber with
 * upstream's operator layering (loosest to tightest): `or` → `and` →
 * equality → relational → additive → multiplicative → unary → primary.
 * The upstream word aliases (`and`, `or`, `not`, `eq`, `is`, `neq`, `gt`,
 * `lt`, `gte`, `lte`, case-insensitive) tokenize as identifiers and bind as
 * operators; `=` is an equality alias, as in the evaluator's preprocessing.
 *
 * Compile-time resolution: enum member access (`Enum.Case`, where the enum
 * is known to the program) folds to a literal push of the case's raw value
 * (ADR 0004); a unary minus over a number literal folds into the literal;
 * variables (`$name` or bare) push at runtime; known function shapes emit
 * `callFunction` with an argument count.
 *
 * Malformed input throws `ExpressionCodegenError`; the lowering pass picks
 * the observable-equivalent fallback per context (conditions →
 * `pushBool false`, mirroring the evaluator's catch → false; `<<set>>` →
 * the raw command, keeping the runtime's error handling).
 */

import type { Instruction } from "./program.js";

/** Raised when an expression cannot be compiled to bytecode. */
export class ExpressionCodegenError extends Error {}

/** Enum table for member-access folding: enum name → case name → raw value. */
export type EnumTable = Record<string, Record<string, number | string>>;

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "variable"; name: string }
  | { kind: "ident"; text: string }
  | { kind: "op"; text: string };

const WORD_OPS: Record<string, string> = {
  or: "or",
  and: "and",
  not: "not",
  eq: "eq",
  is: "eq",
  neq: "neq",
  gt: "gt",
  lt: "lt",
  gte: "gte",
  lte: "lte",
};

/** Quote-aware scanner. Escapes only matter for token boundaries. */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < input.length && input[j] !== c) {
        if (input[j] === "\\" && j + 1 < input.length) {
          value += input[j + 1]; // escaped quote/backslash: keep the literal char
          j += 2;
          continue;
        }
        value += input[j];
        j++;
      }
      if (j >= input.length) throw new ExpressionCodegenError(`Unterminated string in expression: ${input}`);
      tokens.push({ kind: "string", value });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(?:\.[0-9]+)?/.exec(input.slice(i))!;
      tokens.push({ kind: "number", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(input.slice(i));
      if (!m) throw new ExpressionCodegenError(`Expected a variable name after "$": ${input}`);
      tokens.push({ kind: "variable", name: m[1] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i))!;
      tokens.push({ kind: "ident", text: m[0] });
      i += m[0].length;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === "===" || two === "!==" || two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||") {
      tokens.push({ kind: "op", text: two });
      i += 2;
      continue;
    }
    if ("+-*/%<>!()=.".includes(c)) {
      tokens.push({ kind: "op", text: c });
      i++;
      continue;
    }
    throw new ExpressionCodegenError(`Unexpected character "${c}" in expression: ${input}`);
  }
  return tokens;
}

/** Relational operator/alias token → the comparison op it compiles to. */
const RELATIONAL_OPS: Record<string, Instruction["op"]> = {
  "<": "lessThan",
  lt: "lessThan",
  ">": "greaterThan",
  gt: "greaterThan",
  "<=": "lessThanOrEqualTo",
  lte: "lessThanOrEqualTo",
  ">=": "greaterThanOrEqualTo",
  gte: "greaterThanOrEqualTo",
};

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly enums: EnumTable,
    private readonly source: string,
  ) {}

  /** Compile the whole token stream to a postfix instruction list. */
  compile(): Instruction[] {
    const code = this.parseOr();
    if (this.pos !== this.tokens.length) {
      throw new ExpressionCodegenError(`Unexpected trailing input in expression: ${this.source}`);
    }
    return code;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  /** Match an operator token (symbolic) or a word-alias identifier. */
  private matchOp(...texts: string[]): string | null {
    const t = this.peek();
    if (!t) return null;
    if (t.kind === "op" && texts.includes(t.text)) {
      this.pos++;
      return t.text;
    }
    if (t.kind === "ident") {
      const alias = WORD_OPS[t.text.toLowerCase()];
      if (alias && texts.includes(alias)) {
        this.pos++;
        return alias;
      }
    }
    return null;
  }

  /** Lookahead: is the next token one of these operator symbols? */
  private peekIsOp(...texts: string[]): boolean {
    const t = this.peek();
    return t?.kind === "op" && texts.includes(t.text);
  }

  private expectOp(text: string): void {
    if (!this.matchOp(text)) {
      throw new ExpressionCodegenError(`Expected "${text}" in expression: ${this.source}`);
    }
  }

  // or → and
  private parseOr(): Instruction[] {
    let left = this.parseAnd();
    while (this.matchOp("or", "||")) {
      left = [...left, ...this.parseAnd(), { op: "or" } as Instruction];
    }
    return left;
  }

  // and → equality
  private parseAnd(): Instruction[] {
    let left = this.parseEquality();
    while (this.matchOp("and", "&&")) {
      left = [...left, ...this.parseEquality(), { op: "and" } as Instruction];
    }
    return left;
  }

  // equality → relational: == != = eq is neq (and === !==)
  private parseEquality(): Instruction[] {
    let left = this.parseRelational();
    while (true) {
      const op = this.matchOp("eq", "neq") ?? this.matchOp("==", "!=", "===", "!==", "=");
      if (!op) return left;
      const right = this.parseRelational();
      const instruction: Instruction =
        op === "!=" || op === "!==" || op === "neq"
          ? { op: "notEqualTo" }
          : { op: "equalTo" };
      left = [...left, ...right, instruction];
    }
  }

  // relational → additive: < <= > >= (and word aliases)
  private parseRelational(): Instruction[] {
    let left = this.parseAdditive();
    while (true) {
      const op = this.matchOp("gt", "lt", "gte", "lte") ?? this.matchOp("<", ">", "<=", ">=");
      if (!op) return left;
      const right = this.parseAdditive();
      left = [...left, ...right, { op: RELATIONAL_OPS[op] } as Instruction];
    }
  }

  // additive → multiplicative: + -  (`add` concatenates strings at runtime)
  private parseAdditive(): Instruction[] {
    let left = this.parseMultiplicative();
    while (true) {
      const op = this.matchOp("+", "-");
      if (!op) return left;
      const right = this.parseMultiplicative();
      left = [...left, ...right, { op: op === "+" ? "add" : "subtract" } as Instruction];
    }
  }

  // multiplicative → unary: * / %
  private parseMultiplicative(): Instruction[] {
    let left = this.parseUnary();
    while (true) {
      const op = this.matchOp("*", "/", "%");
      if (!op) return left;
      const right = this.parseUnary();
      const instruction: Instruction =
        op === "*" ? { op: "multiply" } : op === "/" ? { op: "divide" } : { op: "modulo" };
      left = [...left, ...right, instruction];
    }
  }

  // unary → primary: ! not - (a numeric-literal minus folds into the literal)
  private parseUnary(): Instruction[] {
    if (this.matchOp("not")) {
      return [...this.parseUnary(), { op: "not" } as Instruction];
    }
    if (this.matchOp("!")) {
      return [...this.parseUnary(), { op: "not" } as Instruction];
    }
    if (this.matchOp("-")) {
      const next = this.peek();
      if (next && next.kind === "number") {
        this.pos++;
        return [{ op: "pushNumber", value: -next.value }];
      }
      return [...this.parseUnary(), { op: "negate" } as Instruction];
    }
    return this.parsePrimary();
  }

  // primary: literals, variables, function calls, enum members, parens
  private parsePrimary(): Instruction[] {
    const t = this.peek();
    if (!t) throw new ExpressionCodegenError(`Unexpected end of expression: ${this.source}`);

    if (t.kind === "number") {
      this.pos++;
      return [{ op: "pushNumber", value: t.value }];
    }
    if (t.kind === "string") {
      this.pos++;
      return [{ op: "pushString", value: t.value }];
    }
    if (t.kind === "variable") {
      this.pos++;
      return [{ op: "pushVariable", name: t.name }];
    }
    if (t.kind === "op" && t.text === "(") {
      this.pos++;
      const code = this.parseOr();
      this.expectOp(")");
      return code;
    }
    // The `.Case` shorthand never resolves at compile time (the type checker
    // rewrites resolvable shorthand in place); the evaluator yields no value
    // for leftovers.
    if (t.kind === "op" && t.text === ".") {
      this.pos++;
      const member = this.peek();
      if (member?.kind !== "ident") {
        throw new ExpressionCodegenError(`Expected a member name after ".": ${this.source}`);
      }
      this.pos++;
      return [{ op: "pushNull" }];
    }
    if (t.kind === "ident") {
      this.pos++;
      const lower = t.text.toLowerCase();
      if (lower === "true") return [{ op: "pushBool", value: true }];
      if (lower === "false") return [{ op: "pushBool", value: false }];

      // Function call: name(args…) — argc operands popped by the callee.
      if (this.peekIsOp("(")) {
        this.pos++;
        const args: Instruction[] = [];
        let argc = 0;
        if (!this.peekIsOp(")")) {
          while (true) {
            args.push(...this.parseOr());
            argc++;
            if (this.matchOp(",")) continue;
            break;
          }
        }
        this.expectOp(")");
        return [...args, { op: "callFunction", name: t.text, argc }];
      }

      // Enum member: Enum.Case folds to the case's raw value (ADR 0004)
      // when the enum is known; otherwise it has no compile-time value —
      // the evaluator yields undefined for unresolved member accesses.
      if (this.peekIsOp(".")) {
        this.pos++;
        const member = this.peek();
        if (member?.kind !== "ident") {
          throw new ExpressionCodegenError(`Expected a member name after ".": ${this.source}`);
        }
        this.pos++;
        if (this.peekIsOp(".")) {
          throw new ExpressionCodegenError(`Chained member access is not supported: ${this.source}`);
        }
        const cases = this.enums[t.text];
        if (cases && Object.prototype.hasOwnProperty.call(cases, member.text)) {
          const raw = cases[member.text];
          return [
            typeof raw === "number"
              ? { op: "pushNumber", value: raw }
              : { op: "pushString", value: raw },
          ];
        }
        return [{ op: "pushNull" }];
      }

      // Bare identifiers read as variables (the evaluator's contract).
      return [{ op: "pushVariable", name: t.text }];
    }
    throw new ExpressionCodegenError(`Unexpected token in expression: ${this.source}`);
  }
}

/**
 * Compile one expression to postfix stack bytecode. Throws
 * `ExpressionCodegenError` when the expression cannot be compiled.
 */
export function compileExpression(expr: string, enums: EnumTable = {}): Instruction[] {
  const trimmed = expr.trim();
  if (!trimmed) throw new ExpressionCodegenError("Empty expression");
  return new Parser(tokenize(trimmed), enums, trimmed).compile();
}
