/**
 * Enum-aware type checking pass (spec ticket 41).
 *
 * Walks the parsed document, validates enum usage, and records the variable
 * types and declarations the compile result exposes:
 *
 * - enum member access (`Enum.Case`, `.Case` shorthand) resolution —
 *   YS0038/YS0050 when unresolvable, YS0028 when ambiguous (mirrors upstream
 *   TypeCheckerListener.ExitValueTypeMemberReference);
 * - the same-enum restriction on `==`/`!=` (upstream YS0050 "Operation '=='s
 *   values must both be the same type");
 * - enum declarations (via buildEnumTypes — YS0035/YS0037/YS0040);
 * - enum cases as function arguments against host-provided signatures
 *   (YS0050 not-convertible, YS0014 arity);
 * - assignment to enum-typed variables (declared or inferred).
 *
 * Resolved `.Case` shorthand is REWRITTEN in place to the full
 * `Enum.Case` form before compilation: the runtime's enum member access
 * evaluates to the case's raw value, so the shorthand must be resolved while
 * type information is available (ADR 0004). Member access in line text is
 * not rewritten (markup segment offsets are derived from the original text).
 *
 * Collect-don't-throw (coding standards §3): every problem is emitted as a
 * diagnostic; expressions that cannot be parsed by the mini-parser are left
 * unchecked (syntax problems belong to YS0005's parser, not this pass).
 */

import type { YarnDocument, Statement } from "../model/ast.js";
import { EnumTypeBuilder, buildEnumTypes, collectEnumBlocks } from "./enums.js";
import type { EnumRawValue, EnumType } from "./enums.js";
import { makeDiagnostic } from "./diagnostics.js";
import type { Diagnostic } from "./diagnostics.js";

/** Declared parameter/return types for compile-time function signatures. */
export type DeclaredValueType = "number" | "string" | "bool" | "any";

export interface FunctionSignature {
  params: DeclaredValueType[];
  variadic?: boolean;
  returns: DeclaredValueType;
}

/** A `<<declare>>`d variable, as surfaced in the compile result. */
export interface VariableDeclaration {
  /** Bare variable name (no `$` prefix), matching variable-storage keys. */
  name: string;
  /** Declared or inferred type name ("number"/"string"/"bool" or an enum name). */
  type: string;
  /** The static initial value when the initializer is a constant. */
  defaultValue?: EnumRawValue | boolean;
}

/** Host-provided external declarations feeding the type checker (ticket 41). */
export interface ExternalDeclarations {
  /** Host-defined enum types (built EnumTypeBuilder outputs or plain EnumTypes). */
  enums?: Array<EnumType | EnumTypeBuilder>;
  /** Function signatures for compile-time argument checking (upstream Library declarations). */
  functions?: Record<string, FunctionSignature>;
}

export interface TypeCheckResult {
  declarations: VariableDeclaration[];
  enumTypes: Map<string, EnumType>;
}

/** Upstream type display names (Types.Number/Types.String/Types.Boolean). */
const PRIM_NAME: Record<string, string> = { number: "Number", string: "String", bool: "Boolean" };

type ExprBase = "number" | "string" | "bool" | "unknown";

interface ExprType {
  base: ExprBase;
  enumName?: string;
}

const UNKNOWN_TYPE: ExprType = { base: "unknown" };

interface Rewrite {
  start: number;
  end: number;
  text: string;
}

interface CheckContext {
  enumTypes: Map<string, EnumType>;
  variableTypes: Map<string, string>;
  functionSignatures: Map<string, FunctionSignature>;
  emit: (code: string, message: string) => void;
  rewrites: Rewrite[];
  declarations: VariableDeclaration[];
}

// --- Expression mini-parser -------------------------------------------------
//
// A small recursive-descent parser over the expression subset the evaluator
// supports (literals, variables, member access, calls, unary/binary ops with
// the evaluator's word aliases). Records token positions so resolved `.Case`
// shorthand can be rewritten.

interface Tok {
  kind: "num" | "str" | "var" | "ident" | "wordop" | "dot" | "op" | "lparen" | "rparen" | "comma";
  text: string;
  start: number;
  end: number;
}

const WORD_OPS = new Map(
  Object.entries({
    not: "!",
    and: "&&",
    or: "||",
    xor: "^",
    eq: "==",
    is: "==",
    neq: "!=",
    gte: ">=",
    lte: "<=",
    gt: ">",
    lt: "<",
  }),
);

function tokenize(expr: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== c) j++;
      toks.push({ kind: "str", text: expr.slice(i + 1, j), start: i, end: Math.min(j + 1, expr.length) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(?:\.[0-9]+)?/.exec(expr.slice(i))!;
      toks.push({ kind: "num", text: m[0], start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i));
      if (!m) {
        i++;
        continue;
      }
      toks.push({ kind: "var", text: m[0], start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i))!;
      const word = m[0].toLowerCase();
      if (WORD_OPS.has(word)) {
        toks.push({ kind: "wordop", text: WORD_OPS.get(word)!, start: i, end: i + m[0].length });
      } else {
        toks.push({ kind: "ident", text: m[0], start: i, end: i + m[0].length });
      }
      i += m[0].length;
      continue;
    }
    if (c === "." && /[A-Za-z_]/.test(expr[i + 1] ?? "")) {
      toks.push({ kind: "dot", text: ".", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === "(") {
      toks.push({ kind: "lparen", text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ kind: "rparen", text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === ",") {
      toks.push({ kind: "comma", text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      toks.push({ kind: "op", text: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if ("+-*/%<>=!^".includes(c)) {
      toks.push({ kind: "op", text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    i++; // unknown character: skipped (parse-failure territory, not ours)
  }
  return toks;
}

type ExprNode =
  | { kind: "num" | "str" | "bool"; value: unknown }
  | { kind: "var"; name: string }
  | { kind: "member"; typeName?: string; member: string; shorthand: boolean; start: number; end: number }
  | { kind: "call"; name: string; args: ExprNode[]; argTexts: string[] }
  | { kind: "un"; op: string; operand: ExprNode }
  | { kind: "bin"; op: string; left: ExprNode; right: ExprNode }
  | { kind: "bad" };

class ExprParser {
  private i = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly expr: string,
  ) {}

  parse(): ExprNode | null {
    const node = this.parseOr();
    if (this.i < this.toks.length) return null; // trailing garbage → unchecked
    return node;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private takeOp(texts: string[]): string | null {
    const t = this.peek();
    if (t && (t.kind === "op" || t.kind === "wordop") && texts.includes(t.text)) {
      this.i++;
      return t.text;
    }
    return null;
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (true) {
      const op = this.takeOp(["||"]);
      if (!op) return left;
      left = { kind: "bin", op, left, right: this.parseAnd() };
    }
  }

  private parseAnd(): ExprNode {
    let left = this.parseComparison();
    while (true) {
      const op = this.takeOp(["&&"]);
      if (!op) return left;
      left = { kind: "bin", op, left, right: this.parseComparison() };
    }
  }

  private parseComparison(): ExprNode {
    let left = this.parseAdditive();
    while (true) {
      const op = this.takeOp(["==", "!=", "<=", ">=", "<", ">"]);
      if (!op) return left;
      left = { kind: "bin", op, left, right: this.parseAdditive() };
    }
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (true) {
      const op = this.takeOp(["+", "-"]);
      if (!op) return left;
      left = { kind: "bin", op, left, right: this.parseMultiplicative() };
    }
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    while (true) {
      const op = this.takeOp(["*", "/", "%"]);
      if (!op) return left;
      left = { kind: "bin", op, left, right: this.parseUnary() };
    }
  }

  private parseUnary(): ExprNode {
    const op = this.takeOp(["!", "-"]);
    if (op) return { kind: "un", op, operand: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const t = this.peek();
    if (!t) return { kind: "bad" };
    if (t.kind === "num") {
      this.i++;
      return { kind: "num", value: Number(t.text) };
    }
    if (t.kind === "str") {
      this.i++;
      return { kind: "str", value: t.text };
    }
    if (t.kind === "var") {
      this.i++;
      return { kind: "var", name: t.text.slice(1) };
    }
    if (t.kind === "dot") {
      // Shorthand member access: .Member
      this.i++;
      const member = this.peek();
      if (!member || member.kind !== "ident") return { kind: "bad" };
      this.i++;
      return { kind: "member", member: member.text, shorthand: true, start: t.start, end: member.end };
    }
    if (t.kind === "lparen") {
      this.i++;
      const inner = this.parseOr();
      const close = this.peek();
      if (!close || close.kind !== "rparen") return { kind: "bad" };
      this.i++;
      return inner;
    }
    if (t.kind === "ident") {
      if (t.text === "true" || t.text === "false") {
        this.i++;
        return { kind: "bool", value: t.text === "true" };
      }
      this.i++;
      const next = this.peek();
      if (next && next.kind === "lparen") {
        // Function call: parse the argument list structurally; argument text
        // (for diagnostics) is sliced from the original expression.
        this.i++;
        let depth = 1;
        let close = -1;
        for (let k = this.i; k < this.toks.length; k++) {
          if (this.toks[k].kind === "lparen") depth++;
          if (this.toks[k].kind === "rparen") {
            depth--;
            if (depth === 0) {
              close = k;
              break;
            }
          }
        }
        if (close === -1) return { kind: "bad" };
        const inner = this.toks.slice(this.i, close);
        const args: ExprNode[] = [];
        const argTexts: string[] = [];
        if (inner.length > 0) {
          let argDepth = 0;
          let startIdx = 0;
          const groups: Tok[][] = [];
          inner.forEach((tok, idx) => {
            if (tok.kind === "lparen") argDepth++;
            if (tok.kind === "rparen") argDepth--;
            if (tok.kind === "comma" && argDepth === 0) {
              groups.push(inner.slice(startIdx, idx));
              startIdx = idx + 1;
            }
          });
          groups.push(inner.slice(startIdx));
          for (const g of groups) {
            if (g.length === 0) return { kind: "bad" };
            const sub = new ExprParser(g, this.expr).parse();
            if (!sub) return { kind: "bad" };
            args.push(sub);
            argTexts.push(this.expr.slice(g[0].start, g[g.length - 1].end).trim());
          }
        }
        this.i = close + 1;
        return { kind: "call", name: t.text, args, argTexts };
      }
      if (next && next.kind === "dot") {
        const member = this.toks[this.i + 1];
        if (member && member.kind === "ident") {
          this.i += 2;
          return { kind: "member", typeName: t.text, member: member.text, shorthand: false, start: t.start, end: member.end };
        }
        return { kind: "bad" };
      }
      return { kind: "bad" }; // bare identifiers aren't values in Yarn
    }
    return { kind: "bad" };
  }
}

// --- Checker ----------------------------------------------------------------

function checkNode(node: ExprNode, ctx: CheckContext, expectedEnum?: string): ExprType {
  switch (node.kind) {
    case "num":
      return { base: "number" };
    case "str":
      return { base: "string" };
    case "bool":
      return { base: "bool" };
    case "var": {
      const varType = ctx.variableTypes.get(node.name);
      if (varType && ctx.enumTypes.has(varType)) return { base: "unknown", enumName: varType };
      if (varType === "number" || varType === "string" || varType === "bool") return { base: varType };
      return UNKNOWN_TYPE;
    }
    case "member":
      return checkMember(node, ctx, expectedEnum);
    case "call":
      return checkCall(node, ctx, expectedEnum);
    case "un": {
      const operand = checkNode(node.operand, ctx, expectedEnum);
      void operand;
      return node.op === "-" ? { base: "number" } : { base: "bool" };
    }
    case "bin":
      return checkBinary(node, ctx, expectedEnum);
    case "bad":
      return UNKNOWN_TYPE;
  }
}

function checkMember(
  node: Extract<ExprNode, { kind: "member" }>,
  ctx: CheckContext,
  expectedEnum?: string,
): ExprType {
  if (!node.shorthand) {
    const enumType = ctx.enumTypes.get(node.typeName!);
    if (!enumType) {
      ctx.emit("YS0050", `No type called ${node.typeName} could be found`);
      return UNKNOWN_TYPE;
    }
    if (!enumType.cases.some((c) => c.name === node.member)) {
      ctx.emit("YS0038", `${node.typeName} doesn't have a member named ${node.member}`);
      return UNKNOWN_TYPE;
    }
    return { base: "unknown", enumName: enumType.name };
  }

  // Shorthand: resolve against the expected enum, else the unique enum with// the member.
  if (expectedEnum) {
    const enumType = ctx.enumTypes.get(expectedEnum)!;
    if (!enumType.cases.some((c) => c.name === node.member)) {
      ctx.emit("YS0050", `Type ${expectedEnum} does not have a member named ${node.member}`);
      return UNKNOWN_TYPE;
    }
    ctx.rewrites.push({ start: node.start, end: node.end, text: `${expectedEnum}.${node.member}` });
    return { base: "unknown", enumName: expectedEnum };
  }
  const matches = [...ctx.enumTypes.values()].filter((t) => t.cases.some((c) => c.name === node.member));
  if (matches.length === 1) {
    ctx.rewrites.push({ start: node.start, end: node.end, text: `${matches[0].name}.${node.member}` });
    return { base: "unknown", enumName: matches[0].name };
  }
  if (matches.length === 0) {
    ctx.emit("YS0050", `No type containing a member named ${node.member} could be found`);
    return UNKNOWN_TYPE;
  }
  ctx.emit(
    "YS0028",
    `.${node.member} is ambiguous (it could be ${matches.map((m) => `${m.name}.${node.member}`).join(" or ")})`,
  );
  return UNKNOWN_TYPE;
}

/**
 * Check call arguments against a known signature (shared by expression
 * calls and `<<call>>` statements): arity (YS0014) and enum-argument
 * convertibility (YS0050). Non-enum argument type mismatches are ticket
 * 42/43 scope; only enum arguments are checked here (spec ticket 41).
 */
function checkArgsAgainstSignature(
  fnName: string,
  args: Array<{ text: string; type: ExprType }>,
  signature: FunctionSignature,
  ctx: CheckContext,
): void {
  const expected = signature.params.length;
  const variadic = signature.variadic === true;
  if (args.length !== expected && !variadic) {
    ctx.emit("YS0014", `${fnName} expects ${expected} ${expected === 1 ? "parameter" : "parameters"}, not ${args.length}`);
    return;
  }
  if (variadic && args.length < Math.max(expected - 1, 0)) {
    ctx.emit("YS0014", `${fnName} expects at least ${Math.max(expected - 1, 0)} parameters`);
    return;
  }
  args.forEach((arg, i) => {
    const paramIndex = variadic && expected > 0 && i >= expected - 1 ? expected - 1 : i;
    const paramType = signature.params[paramIndex];
    if (!paramType || paramType === "any") return;
    if (!arg.type.enumName) return;
    const argEnum = ctx.enumTypes.get(arg.type.enumName);
    const compatible =
      (paramType === "string" && argEnum?.rawValueType === "string") ||
      (paramType === "number" && argEnum?.rawValueType === "number");
    if (!compatible) {
      ctx.emit("YS0050", `${arg.text} (${arg.type.enumName}) is not convertible to ${PRIM_NAME[paramType]}`);
    }
  });
}

function checkCall(node: Extract<ExprNode, { kind: "call" }>, ctx: CheckContext, expectedEnum?: string): ExprType {
  // Built-in conversions (upstream Types.Number/String/Boolean functions).
  if (node.name === "string" || node.name === "number" || node.name === "bool") {
    for (const arg of node.args) checkNode(arg, ctx, expectedEnum);
    return { base: node.name as "string" | "number" | "bool" };
  }

  const args = node.args.map((arg, i) => ({
    text: node.argTexts[i],
    type: checkNode(arg, ctx, expectedEnum),
  }));

  const signature = ctx.functionSignatures.get(node.name);
  if (!signature) {
    // Unknown function: upstream infers its type implicitly from usage
    // (the Inference-* fixtures own that gap); nothing to check here.
    return UNKNOWN_TYPE;
  }
  checkArgsAgainstSignature(node.name, args, signature, ctx);
  return signature.returns === "number" || signature.returns === "string" || signature.returns === "bool"
    ? { base: signature.returns }
    : UNKNOWN_TYPE;
}

function checkBinary(node: Extract<ExprNode, { kind: "bin" }>, ctx: CheckContext, expectedEnum?: string): ExprType {
  const left = checkNode(node.left, ctx, expectedEnum);
  const right = checkNode(node.right, ctx, expectedEnum);

  if (node.op === "==" || node.op === "!=") {
    const describe = (t: ExprType) => t.enumName ?? (t.base === "unknown" ? undefined : PRIM_NAME[t.base]);
    const leftName = describe(left);
    const rightName = describe(right);
    // Same-enum restriction (upstream: enum types are only equal to
    // themselves; a value of enum type never equals a primitive).
    if (leftName && rightName && leftName !== rightName) {
      ctx.emit(
        "YS0050",
        `Operation '${node.op}'s values must both be the same type, not ${leftName} and ${rightName}`,
      );
    }
    return { base: "bool" };
  }
  if (["<", ">", "<=", ">="].includes(node.op)) return { base: "bool" };
  if (node.op === "&&" || node.op === "||" || node.op === "^") return { base: "bool" };
  if (node.op === "+") {
    if (left.base === "string" || right.base === "string") return { base: "string" };
    if (left.base === "number" && right.base === "number") return { base: "number" };
    return UNKNOWN_TYPE;
  }
  if (["-", "*", "/", "%"].includes(node.op)) return { base: "number" };
  return UNKNOWN_TYPE;
}

/**
 * Type-check one expression. Returns its type and the expression rewritten
 * with resolved `.Case` shorthand (unchanged when nothing resolved).
 */
function checkExpression(
  expr: string,
  ctx: CheckContext,
  expectedEnum?: string,
): { type: ExprType; rewritten: string } {
  ctx.rewrites.length = 0;
  const toks = tokenize(expr);
  const parsed = new ExprParser(toks, expr).parse();
  if (!parsed) return { type: UNKNOWN_TYPE, rewritten: expr };
  const type = checkNode(parsed, ctx, expectedEnum);
  let rewritten = expr;
  if (ctx.rewrites.length > 0) {
    // Spans are non-overlapping; apply right-to-left.
    const sorted = [...ctx.rewrites].sort((a, b) => b.start - a.start);
    for (const r of sorted) {
      rewritten = rewritten.slice(0, r.start) + r.text + rewritten.slice(r.end);
    }
  }
  return { type, rewritten };
}

// --- Statement walk -----------------------------------------------------------

function primOrDefault(expr: string, enumTypes: Map<string, EnumType>): VariableDeclaration["defaultValue"] {
  const trimmed = expr.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  const member = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (member) {
    const rawValue = enumTypes.get(member[1])?.cases.find((c) => c.name === member[2])?.rawValue;
    if (rawValue !== undefined) return rawValue;
  }
  return undefined;
}

function walkStatements(stmts: Statement[], ctx: CheckContext): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Command": {
        const content = s.content;

        const declare = content.match(/^declare\s+\$(\w+)\s*=\s*([\s\S]+)$/);
        if (declare) {
          const [, name, rest] = declare;
          const asMatch = rest.match(/\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
          const declaredType = asMatch?.[1];
          const expr = (asMatch ? rest.slice(0, asMatch.index) : rest).trim();
          const expectedEnum = declaredType && ctx.enumTypes.has(declaredType) ? declaredType : undefined;
          const { type, rewritten } = checkExpression(expr, ctx, expectedEnum);
          if (rewritten !== expr) s.content = `declare $${name} = ${rewritten}${asMatch ? ` as ${declaredType}` : ""}`;
          if (declaredType) {
            ctx.variableTypes.set(name, declaredType);
          } else if (type.enumName) {
            ctx.variableTypes.set(name, type.enumName);
          } else if (type.base !== "unknown") {
            ctx.variableTypes.set(name, type.base);
          }
          ctx.declarations.push({
            name,
            type: declaredType ?? type.enumName ?? (type.base !== "unknown" ? type.base : "unknown"),
            defaultValue: primOrDefault(rewritten, ctx.enumTypes),
          });
          break;
        }

        const set = content.match(/^set\s+\$(\w+)\s+(to|=)\s*([\s\S]+)$/);
        if (set) {
          const [, name, op, rest] = set;
          const varType = ctx.variableTypes.get(name);
          const expectedEnum = varType && ctx.enumTypes.has(varType) ? varType : undefined;
          const { type, rewritten } = checkExpression(rest.trim(), ctx, expectedEnum);
          if (rewritten !== rest.trim()) s.content = `set $${name} ${op} ${rewritten}`;
          const describe = (t: ExprType) => t.enumName ?? (t.base === "unknown" ? undefined : PRIM_NAME[t.base]);
          if (varType) {
            const varIsEnum = ctx.enumTypes.has(varType);
            const typeName = describe(type);
            if (typeName && typeName !== varType && (varIsEnum || type.enumName)) {
              ctx.emit(
                "YS0050",
                `Operation '${op}'s values must both be the same type, not ${varType} and ${typeName}`,
              );
            }
          } else if (type.enumName) {
            // Upstream infers a variable's type from an enum-typed assignment.
            ctx.variableTypes.set(name, type.enumName);
          }
          break;
        }

        const call = content.match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/);
        if (call) {
          const [, fnName, argsSrc] = call;
          const args = argsSrc.trim() ? splitArgs(argsSrc) : [];
          const checkedArgs = args.map((arg) => ({ text: arg, type: checkExpression(arg, ctx).type }));
          const signature = ctx.functionSignatures.get(fnName);
          if (signature) checkArgsAgainstSignature(fnName, checkedArgs, signature, ctx);
          break;
        }
        break;
      }
      case "If":
        for (const b of s.branches) {
          if (b.condition !== null) {
            const { rewritten } = checkExpression(b.condition, ctx);
            if (rewritten !== b.condition) b.condition = rewritten;
          }
          walkStatements(b.body, ctx);
        }
        break;
      case "Once":
        walkStatements(s.body, ctx);
        break;
      case "OptionGroup":
        for (const o of s.options) {
          if (o.condition) {
            const { rewritten } = checkExpression(o.condition, ctx);
            if (rewritten !== o.condition) o.condition = rewritten;
          }
          walkStatements(o.body, ctx);
        }
        break;
      default:
        break;
    }
  }
}

/** Split an argument list on top-level commas (quote- and paren-aware). */
function splitArgs(src: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  for (const c of src) {
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/**
 * Run the enum-aware type checking pass over the document. Mutates the AST
 * in place (resolves `.Case` shorthand) so the compiler emits the resolved
 * form; returns the declarations and enum registry for the compile result.
 */
export function typeCheck(
  doc: YarnDocument,
  opts: { declarations?: ExternalDeclarations },
  emitDiagnostic: (d: Diagnostic) => void,
): TypeCheckResult {
  const hostEnums: EnumType[] = [];
  for (const host of opts.declarations?.enums ?? []) {
    if (host instanceof EnumTypeBuilder) {
      try {
        hostEnums.push(host.build());
      } catch (e) {
        // A half-built builder passed to the compile seam is host misuse;
        // keep the seam throw-free by reporting it as a diagnostic.
        emitDiagnostic(
          makeDiagnostic("YS0035", e instanceof Error ? e.message : String(e)),
        );
      }
      continue;
    }
    hostEnums.push(host);
  }

  const enumTypes = buildEnumTypes(collectEnumBlocks(doc), hostEnums, (code, message) =>
    emitDiagnostic(makeDiagnostic(code, message)),
  );

  const functionSignatures = new Map(Object.entries(opts.declarations?.functions ?? {}));
  const variableTypes = new Map<string, string>();
  const declarations: VariableDeclaration[] = [];
  const ctx: CheckContext = {
    enumTypes,
    variableTypes,
    functionSignatures,
    emit: (code, message) => emitDiagnostic(makeDiagnostic(code, message)),
    rewrites: [],
    declarations,
  };

  for (const node of doc.nodes) walkStatements(node.body, ctx);

  return { declarations, enumTypes };
}
