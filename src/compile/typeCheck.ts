// SPDX-License-Identifier: CC0-1.0
/**
 * Enum-aware type checking pass.
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

import type { YarnDocument, Statement, Line } from "../model/ast.js";
import { EnumTypeBuilder, buildEnumTypes, collectEnumBlocks } from "./enums.js";
import { IDENTIFIER, IDENTIFIER_HEAD_TEST } from "../parse/identifier.js";
import type { EnumRawValue, EnumType } from "./enums.js";
import { makeDiagnostic } from "./diagnostics.js";
import type { Diagnostic, YarnRange } from "./diagnostics.js";
import { isSmartVariableInitializer } from "./smartVariables.js";
import { parseStateStatement } from "../parse/stateStatement.js";
import { parseSaliencyCondition } from "../runtime/saliency.js";
import type { DeclaredValueType, FunctionSignature } from "../runtime/library.js";
import { inlineExpressionSpans } from "../runtime/interpolate.js";
import { describeError } from "../describeError.js";

// Re-exported so the declarations surface keeps its historical home in the
// public API (the runtime Library owns the definition).
export type { DeclaredValueType, FunctionSignature };

/** A `<<declare>>`d variable, as surfaced in the compile result. */
export interface VariableDeclaration {
  /** Bare variable name (no `$` prefix), matching variable-storage keys. */
  name: string;
  /** Declared or inferred type name ("number"/"string"/"bool" or an enum name). */
  type: string;
  /** The static initial value when the initializer is a constant. */
  defaultValue?: EnumRawValue | boolean;
  /**
   * The `///` documentation comment above the declaration (upstream
   * `Declaration.Description` — the variable's purpose, shown in
   * editor hovers).
   */
  description?: string;
  /**
   * True when the declaration is a smart variable (upstream
   * `Declaration.IsInlineExpansion`): the initializer is not a plain literal,
   * the variable is read-only (YS0030), and its value is recomputed on every
   * access.
   */
  isSmartVariable?: boolean;
  /**
   * True when the declaration was inferred from usage rather than authored
   * (upstream `Declaration.IsImplicit`): the variable never carried a
   * `<<declare>>`, so its initial value is the type's default.
   */
  isImplicit?: boolean;
}

/**
 * A host-provided external variable declaration (upstream a `Declaration`
 * for a variable in `CompilationJob.Declarations`): known to the compiler
 * without appearing in `.yarn`.
 */
export interface ExternalVariableDeclaration {
  /** "number" / "string" / "bool", or a registered enum type name. */
  type: DeclaredValueType | string;
  /** The variable's initial value (upstream `Declaration.DefaultValue`). */
  defaultValue?: EnumRawValue | boolean;
}

/** Host-provided external declarations feeding the type checker. */
export interface ExternalDeclarations {
  /** Host-defined enum types (built EnumTypeBuilder outputs or plain EnumTypes). */
  enums?: Array<EnumType | EnumTypeBuilder>;
  /** Function signatures for compile-time argument checking (upstream Library declarations). */
  functions?: Record<string, FunctionSignature>;
  /** External variables (upstream variable `Declaration`s); conflicts with in-script `<<declare>>`s produce YS0039. */
  variables?: Record<string, ExternalVariableDeclaration>;
}

export interface TypeCheckResult {
  declarations: VariableDeclaration[];
  enumTypes: Map<string, EnumType>;
}

/** Upstream type display names as they appear in diagnostic messages
 *  (upstream `Types.Number`/`Types.String`/`Types.Boolean`; the Boolean type
 *  renders "Bool" — verified against the upstream v3.2.2 compiler). */
const PRIM_NAME: Record<string, string> = { number: "Number", string: "String", bool: "Bool" };

type ExprBase = "number" | "string" | "bool" | "unknown";

interface ExprType {
  base: ExprBase;
  enumName?: string;
  /**
   * True when the type is unknown because validation already failed
   * (unresolvable member access, wrong arity, unparseable expression).
   * Upstream marks such contexts with the Error type, which suppresses
   * the solver's downstream YS0029 cascades — so does this flag.
   */
  error?: boolean;
}

const UNKNOWN_TYPE: ExprType = { base: "unknown" };
/** The Error type: validation already failed here; suppress cascades. */
const ERROR_TYPE: ExprType = { base: "unknown", error: true };

interface Rewrite {
  start: number;
  end: number;
  text: string;
}

interface CheckContext {
  enumTypes: Map<string, EnumType>;
  variableTypes: Map<string, string>;
  functionSignatures: Map<string, FunctionSignature>;
  emit: (code: string, message: string, file?: string, range?: YarnRange) => void;
  rewrites: Rewrite[];
  declarations: VariableDeclaration[];
  /** Every `<<declare>>`d variable: smart flag + initializer expression (first declaration wins). */
  declaredVariables: Map<string, { isSmart: boolean; expression: string; file?: string }>;
  /** Variables declared externally by the host (YS0039 on in-script redeclaration). */
  externalVariables: Set<string>;
  /** Source file of the node being walked (diagnostic attribution). */
  currentFile?: string;
  /**
   * File position (0-based line/column) where the expression currently
   * being checked begins — set by the caller that knows the expression's
   * source site (inline `{expr}` spans carry their line's position). When
   * absent, signature-mismatch diagnostics carry no range (the AST's
   * statement nodes don't record command/header positions — a parser-side
   * gap noted on the ticket).
   */
  currentRange?: { line: number; col: number };
  /**
   * Implicit function inferences (the upstream Inference-* fixtures): the
   * first call to an unknown function in a typed context pins its return
   * type and arity; later calls must agree (upstream TypeCheckerListener
   * creates an implicit Declaration with type variables on first call and
   * constrains them through usage).
   */
  inferredFunctions: Map<string, { returns: ExprType; arity: number }>;
  /**
   * Variables referenced by inline `{expr}` expressions in line, option,
   * and command text (upstream's Variables-MustBeAbleToInferDefinition).
   * Resolved after the walk: a variable nothing can type is YS0029.
   */
  inlineVarUses: Set<string>;
  /**
   * Set/declare statements whose value expression (and possibly target)
   * were undetermined at walk time. Upstream's solver resolves these
   * globally — a variable pinned anywhere (later statement, another
   * operand) resolves every site — so emission is deferred to the post-walk
   * resolution pass, which reports YS0029 only for the still-untyped.
   */
  undeterminedSites: Array<{ text: string; target: string }>;
  /**
   * `<<set>>` targets whose variable has no `<<declare>>` and no
   * external declaration — YS0003 per site after the walk. Reads are not
   * recorded: condition reads are Boolean-constrained (upstream) and
   * unresolvable inline uses keep their fixture-pinned YS0029.
   */
  undeclaredUses: Array<{ name: string; file?: string }>;
  /**
   * Variables already reported via YS0028: the expression they
   * appear in typed fine (e.g. inside a number()/string() conversion) but
   * the variable itself could not be inferred — reported once per variable,
   * and excluded from the inline-use YS0029 pass.
   */
  inferenceFailures: Set<string>;
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

/** A variable reference `$name` — the name is an upstream ID (the shared
 *  unicode identifier classes). */
const VARIABLE_TOKEN = new RegExp(`^\\$${IDENTIFIER}`, "u");
/** An identifier token (keyword aliases and bare names share the read). */
const IDENT_TOKEN = new RegExp(`^${IDENTIFIER}`, "u");
/** `EnumName.Case` — both names are upstream IDs. */
const MEMBER_ACCESS = new RegExp(`^(${IDENTIFIER})\\.(${IDENTIFIER})$`, "u");
/** `<<call name(args)>>` — the function name is an upstream ID. */
const CALL_STATEMENT = new RegExp(`^call\\s+(${IDENTIFIER})\\s*\\(([\\s\\S]*)\\)\\s*$`, "u");

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
      // Upstream lexer STRING: `\"` and `\\` are the escapes — a
      // backslash keeps the literal next character so `"a\"b"` lexes one
      // string. LOCKSTEP: the codegen tokenizer (expressionCodegen.ts
      // tokenize) implements the same escape walk — change both together.
      let j = i + 1;
      let value = "";
      while (j < expr.length && expr[j] !== c) {
        if (expr[j] === "\\" && j + 1 < expr.length) {
          value += expr[j + 1]; // escaped quote/backslash: keep the literal char
          j += 2;
          continue;
        }
        value += expr[j];
        j++;
      }
      toks.push({ kind: "str", text: value, start: i, end: Math.min(j + 1, expr.length) });
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
      const m = VARIABLE_TOKEN.exec(expr.slice(i));
      if (!m) {
        i++;
        continue;
      }
      toks.push({ kind: "var", text: m[0], start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (IDENTIFIER_HEAD_TEST.test(c)) {
      const m = IDENT_TOKEN.exec(expr.slice(i))!;
      const word = m[0].toLowerCase();
      if (WORD_OPS.has(word)) {
        toks.push({ kind: "wordop", text: WORD_OPS.get(word)!, start: i, end: i + m[0].length });
      } else {
        toks.push({ kind: "ident", text: m[0], start: i, end: i + m[0].length });
      }
      i += m[0].length;
      continue;
    }
    if (c === "." && IDENTIFIER_HEAD_TEST.test(expr[i + 1] ?? "")) {
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
  | {
      kind: "call";
      name: string;
      args: ExprNode[];
      argTexts: string[];
      /** The call node's token offsets in the source expression (YS0014's range). */
      nameStart: number;
      nameEnd: number;
      /** Per-argument token offsets in the source expression (YS0050's range). */
      argStarts: number[];
      argEnds: number[];
    }
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
    // Upstream's ExpAndOrXor grammar rule: and/or/xor share ONE
    // precedence level (left-associative) — deliberately not C's
    // two-level and/or split. xor maps to `^` via WORD_OPS.
    // LOCKSTEP: the codegen parser (expressionCodegen.ts parseOr) mirrors
    // this rule and its operator order — change both together (one
    // upstream grammar, two hand-rolled parsers).
    let left = this.parseEquality();
    while (true) {
      const op = this.takeOp(["||", "&&", "^"]);
      if (!op) return left;
      left = { kind: "bin", op, left, right: this.parseEquality() };
    }
  }

  private parseEquality(): ExprNode {
    // Upstream's ExpEquality level (the ANTLR precedence ladder binds
    // comparison TIGHTER than equality: expComparison sits below
    // expEquality). A single `=` is the runtime's tolerated equality
    // spelling (the evaluator and codegen accept it), so the checker's
    // mini-parser must mirror that tolerance instead of reporting trailing
    // garbage (ADR 0005; recorded in docs/compatibility.md).
    // LOCKSTEP: the codegen parser (expressionCodegen.ts parseEquality)
    // mirrors this level and its operator order — change both together.
    let left = this.parseComparison();
    while (true) {
      const op = this.takeOp(["==", "!="]);
      if (!op) {
        const eq = this.takeOp(["="]);
        if (!eq) return left;
        left = { kind: "bin", op: "==", left, right: this.parseComparison() };
        continue;
      }
      left = { kind: "bin", op, left, right: this.parseComparison() };
    }
  }

  private parseComparison(): ExprNode {
    // Upstream's ExpComparison level: < > <= >= (and word aliases via
    // WORD_OPS), binding tighter than equality.
    // LOCKSTEP: the codegen parser (expressionCodegen.ts parseRelational)
    // mirrors this level — change both together.
    let left = this.parseAdditive();
    while (true) {
      const op = this.takeOp(["<=", ">=", "<", ">"]);
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
        const groups: Tok[][] = [];
        if (inner.length > 0) {
          let argDepth = 0;
          let startIdx = 0;
          inner.forEach((tok, idx) => {
            if (tok.kind === "lparen") argDepth++;
            if (tok.kind === "rparen") argDepth--;
            if (tok.kind === "comma" && argDepth === 0) {
              groups.push(inner.slice(startIdx, idx));
              startIdx = idx + 1;
            }
          });
          groups.push(inner.slice(startIdx));
        }
        for (const g of groups) {
          if (g.length === 0) return { kind: "bad" };
          const sub = new ExprParser(g, this.expr).parse();
          if (!sub) return { kind: "bad" };
          args.push(sub);
          argTexts.push(this.expr.slice(g[0].start, g[g.length - 1].end).trim());
        }
        this.i = close + 1;
        return {
          kind: "call",
          name: t.text,
          args,
          argTexts,
          nameStart: t.start,
          nameEnd: t.end,
          argStarts: groups.map((g) => g[0].start),
          argEnds: groups.map((g) => g[g.length - 1].end),
        };
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
      return ERROR_TYPE;
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
      return ERROR_TYPE;
    }
    if (!enumType.cases.some((c) => c.name === node.member)) {
      ctx.emit("YS0038", `${node.typeName} doesn't have a member named ${node.member}`);
      return ERROR_TYPE;
    }
    return { base: "unknown", enumName: enumType.name };
  }

  // Shorthand: resolve against the expected enum, else the unique enum with// the member.
  if (expectedEnum) {
    const enumType = ctx.enumTypes.get(expectedEnum)!;
    if (!enumType.cases.some((c) => c.name === node.member)) {
      ctx.emit("YS0050", `Type ${expectedEnum} does not have a member named ${node.member}`);
      return ERROR_TYPE;
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
    return ERROR_TYPE;
  }
  ctx.emit(
    "YS0028",
    `.${node.member} is ambiguous (it could be ${matches.map((m) => `${m.name}.${node.member}`).join(" or ")})`,
  );
  return ERROR_TYPE;
}

/** The source range of a diagnostic anchored at an expression offset: the
 *  current expression's file position plus the offending token's offset
 *  within it. Upstream pins signature-mismatch ranges to the argument's /
 *  function-name's token range (ErrorHandlingTests). */
function rangeAt(ctx: CheckContext, start: number, end: number): YarnRange | undefined {
  if (!ctx.currentRange) return undefined;
  return {
    startLine: ctx.currentRange.line,
    startCol: ctx.currentRange.col + start,
    endLine: ctx.currentRange.line,
    endCol: ctx.currentRange.col + end,
  };
}

/**
 * Check call arguments against a known signature (shared by expression
 * calls and `<<call>>` statements): arity (YS0014) and enum-argument
 * convertibility (YS0050). Non-enum argument type mismatches are the
 * smart-variable/Library scope; only enum arguments are checked here.
 */
function checkArgsAgainstSignature(
  fnName: string,
  args: Array<{ text: string; type: ExprType }>,
  signature: FunctionSignature,
  ctx: CheckContext,
  offsets?: { nameStart: number; nameEnd: number; argStarts: number[]; argEnds: number[] },
): void {
  const expected = signature.params.length;
  const variadic = signature.variadic === true;
  if (args.length !== expected && !variadic) {
    // YS0014's registry template is "Invalid function call: {0}"; upstream
    // pins the range to the function-name token.
    ctx.emit(
      "YS0014",
      `Invalid function call: ${fnName} expects ${expected} ${expected === 1 ? "parameter" : "parameters"}, not ${args.length}`,
      ctx.currentFile,
      rangeAt(ctx, offsets?.nameStart ?? 0, offsets?.nameEnd ?? 0),
    );
    return;
  }
  if (variadic && args.length < Math.max(expected - 1, 0)) {
    ctx.emit(
      "YS0014",
      `Invalid function call: ${fnName} expects at least ${Math.max(expected - 1, 0)} parameters`,
      ctx.currentFile,
      rangeAt(ctx, offsets?.nameStart ?? 0, offsets?.nameEnd ?? 0),
    );
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
      ctx.emit(
        "YS0050",
        `${arg.text} (${arg.type.enumName}) is not convertible to ${PRIM_NAME[paramType]}`,
        ctx.currentFile,
        rangeAt(ctx, offsets?.argStarts[i] ?? 0, offsets?.argEnds[i] ?? 0),
      );
    }
  });
  checkPrimitiveArgTypes(fnName, args, signature, ctx, offsets);
}

/**
 * Primitive argument checking against a known signature: enum
 * compatibility is checked above; a concrete primitive argument that can't
 * convert to its parameter's type is upstream's catch-all YS0050. Unknown
 * operands are skipped (the solver may still resolve them elsewhere).
 */
function checkPrimitiveArgTypes(
  fnName: string,
  args: Array<{ text: string; type: ExprType }>,
  signature: FunctionSignature,
  ctx: CheckContext,
  offsets?: { argStarts: number[]; argEnds: number[] },
): void {
  const expected = signature.params.length;
  args.forEach((arg, i) => {
    const paramIndex = signature.variadic && expected > 0 && i >= expected - 1 ? expected - 1 : i;
    const paramType = signature.params[paramIndex];
    if (!paramType || paramType === "any") return;
    if (arg.type.enumName || arg.type.error) return;
    if (arg.type.base === "unknown") return;
    if (arg.type.base === paramType) return;
    // Upstream's message carries no function-name prefix (upstream
    // TypeCheckerListener's convertible-constraint failure text).
    ctx.emit(
      "YS0050",
      `${arg.text} (${PRIM_NAME[arg.type.base]}) is not convertible to ${PRIM_NAME[paramType]}`,
      ctx.currentFile,
      rangeAt(ctx, offsets?.argStarts[i] ?? 0, offsets?.argEnds[i] ?? 0),
    );
  });
}

function checkCall(node: Extract<ExprNode, { kind: "call" }>, ctx: CheckContext, expectedEnum?: string): ExprType {
  // Built-in conversions (upstream Types.Number/String/Boolean functions).
  if (node.name === "string" || node.name === "number" || node.name === "bool") {
    for (const arg of node.args) {
      const argType = checkNode(arg, ctx, expectedEnum);
      // YS0028: the conversion expression itself types (its
      // return is the target type), but a constituent variable whose type
      // nothing could determine is upstream's TypeInferenceFailure —
      // distinct from YS0029, whose expression stays untyped.
      if (
        arg.kind === "var" &&
        argType.base === "unknown" &&
        !argType.enumName &&
        !argType.error &&
        !ctx.variableTypes.has(arg.name) &&
        !ctx.declaredVariables.has(arg.name) &&
        !ctx.externalVariables.has(arg.name) &&
        !ctx.inferenceFailures.has(arg.name)
      ) {
        ctx.inferenceFailures.add(arg.name);
        ctx.emit(
          "YS0028",
          `Can't determine type of $${arg.name} given its usage. Manually specify its type with a declare statement.`,
          ctx.currentFile,
        );
      }
    }
    return { base: node.name as "string" | "number" | "bool" };
  }

  const args = node.args.map((arg, i) => ({
    text: node.argTexts[i],
    type: checkNode(arg, ctx, expectedEnum),
  }));

  const signature = ctx.functionSignatures.get(node.name);
  if (!signature) {
    // Unknown function: its return type is inferred implicitly from usage
    // (upstream's implicit function declarations). A later call must agree
    // with the inferred return type and arity.
    const inferred = ctx.inferredFunctions.get(node.name);
    if (inferred) {
      if (node.args.length !== inferred.arity) {
        const plural = (n: number) => (n === 1 ? "parameter" : "parameters");
        ctx.emit(
          "YS0014",
          `Invalid function call: ${node.name} was called elsewhere with ${inferred.arity} ${plural(inferred.arity)}, but is called with ${node.args.length} ${plural(node.args.length)} here`,
        );
        return ERROR_TYPE;
      }
      return inferred.returns;
    }
    return UNKNOWN_TYPE;
  }
  checkArgsAgainstSignature(node.name, args, signature, ctx, node);
  return signature.returns === "number" || signature.returns === "string" || signature.returns === "bool"
    ? { base: signature.returns }
    : UNKNOWN_TYPE;
}

function checkBinary(node: Extract<ExprNode, { kind: "bin" }>, ctx: CheckContext, expectedEnum?: string): ExprType {
  const left = checkNode(node.left, ctx, expectedEnum);
  const right = checkNode(node.right, ctx, expectedEnum);

  /** Upstream's solver pins an unknown variable operand to its concrete
   *  co-operand's type (equality constraints); mirror that so uses like
   *  `<<declare $a = $a + 1>>` resolve instead of reporting YS0029. */
  const pinFrom = (operand: ExprNode, type: ExprType, fallback: string | undefined) => {
    if (operand.kind !== "var") return;
    const resolved = type.enumName ?? (type.base !== "unknown" && !type.error ? type.base : fallback);
    if (resolved && !ctx.variableTypes.has(operand.name)) ctx.variableTypes.set(operand.name, resolved);
  };

  if (node.op === "==" || node.op === "!=") {
    const leftName = describeUpstream(left);
    const rightName = describeUpstream(right);
    // Same-enum restriction (upstream: enum types are only equal to
    // themselves; a value of enum type never equals a primitive).
    if (leftName && rightName && leftName !== rightName) {
      ctx.emit(
        "YS0050",
        `Operation '${node.op}'s values must both be the same type, not ${leftName} and ${rightName}`,
      );
    }
    // Equality constrains the operands to the same type.
    if (leftName) pinFrom(node.right, left, undefined);
    if (rightName) pinFrom(node.left, right, undefined);
    return { base: "bool" };
  }
  if (["<", ">", "<=", ">="].includes(node.op)) {
    // Comparisons require identical operand types — but unlike the
    // arithmetic operators, upstream imposes no base type, so two unknown
    // operands stay unresolved (no Number fallback).
    pinFrom(node.right, left, undefined);
    pinFrom(node.left, right, undefined);
    return { base: "bool" };
  }
  if (node.op === "&&" || node.op === "||" || node.op === "^") {
    // Logical operands are constrained to Boolean.
    pinFrom(node.left, UNKNOWN_TYPE, "bool");
    pinFrom(node.right, UNKNOWN_TYPE, "bool");
    return { base: "bool" };
  }
  // Operator typing (upstream ExitExpAddSub/ExitExpMultDivMod):
  // '+' requires numbers or strings; the other arithmetic operators require
  // numbers. A concrete operand outside the permitted set is YS0050.
  const arithmeticOp = node.op === "+" || ["-", "*", "/", "%"].includes(node.op);
  if (arithmeticOp) {
    const permitted = node.op === "+" ? ["number", "string"] : ["number"];
    const offenders = [left, right].filter(
      (t) => t.base !== "unknown" && !t.enumName && !permitted.includes(t.base),
    );
    if (offenders.length > 0) {
      ctx.emit(
        "YS0050",
        `Operation '${node.op}' can't be used with a value of type ${PRIM_NAME[offenders[0].base]}`,
      );
      // Upstream resolves a failed operand constraint's type to the error
      // type, which suppresses downstream cascades. Pin the result to the
      // arithmetic result type (the evaluator's JS `+`/`-` coercion) for
      // the same effect.
      return { base: "number" };
    }
  }
  if (node.op === "+") {
    // The operands are equal to the result, which is a Number or String:
    // a concrete operand pins unknown variable co-operands.
    if (left.base === "string" || right.base === "string") {
      pinFrom(node.left, left, "string");
      pinFrom(node.right, right, "string");
      return { base: "string" };
    }
    if (left.base === "number" || right.base === "number") {
      pinFrom(node.left, left, "number");
      pinFrom(node.right, right, "number");
      return { base: "number" };
    }
    return UNKNOWN_TYPE;
  }
  if (["-", "*", "/", "%"].includes(node.op)) {
    // All arithmetic operands are Numbers.
    pinFrom(node.left, left, "number");
    pinFrom(node.right, right, "number");
    return { base: "number" };
  }
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
  if (!parsed || containsBadNode(parsed)) {
    // Expression syntax failure: the mini-parser's `bad` nodes
    // all arise from malformed operand/group/call shapes (semantic failures
    // return typed nodes with their own diagnostics), and a null parse is
    // trailing garbage — upstream's parser reports both as YS0005. The
    // Error type still suppresses downstream type cascades.
    ctx.emit("YS0005", `Syntax error: ${expr.trim()}`, ctx.currentFile);
    return { type: ERROR_TYPE, rewritten: expr };
  }
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

/** True when the parsed tree contains a malformed-operand node (`bad`) —
 *  the ExprParser's only way to say "this shape is not an expression". */
function containsBadNode(node: ExprNode): boolean {
  switch (node.kind) {
    case "bad":
      return true;
    case "un":
      return containsBadNode(node.operand);
    case "bin":
      return containsBadNode(node.left) || containsBadNode(node.right);
    case "call":
      return node.args.some(containsBadNode);
    default:
      return false;
  }
}

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
  const member = trimmed.match(MEMBER_ACCESS);
  if (member) {
    const rawValue = enumTypes.get(member[1])?.cases.find((c) => c.name === member[2])?.rawValue;
    if (rawValue !== undefined) return rawValue;
  }
  return undefined;
}

/** Display name for an expression's type as upstream renders it in
 *  messages; undefined when the type is undetermined. */
function describeUpstream(type: ExprType): string | undefined {
  return type.enumName ?? (type.base === "unknown" ? undefined : PRIM_NAME[type.base]);
}

/** YS0029 (upstream ExpressionTypeUndetermined): the type of this expression
 *  could not be determined. `text` is the expression's source text. */
function emitUndetermined(text: string, ctx: CheckContext): void {
  ctx.emit("YS0029", `Can't determine the type of the expression ${text}.`);
}

/** Parse an expression's source with the checker's mini-parser, or null when
 *  it doesn't parse (syntax problems belong to YS0005's parser, not here). */
function parseExpression(expr: string): ExprNode | null {
  return new ExprParser(tokenize(expr), expr).parse();
}

/** Resolve a type name — a primitive (`number`/`string`/`bool`) or an enum —
 *  to an ExprType; undefined when the name names no known type. */
function typeFromName(name: string, ctx: CheckContext): ExprType | undefined {
  if (ctx.enumTypes.has(name)) return { base: "unknown", enumName: name };
  return ["number", "string", "bool"].includes(name) ? { base: name as ExprBase } : undefined;
}

/**
 * Pin an implicit function's return type from the context that first uses
 * it (upstream: the first call creates an implicit Declaration whose type
 * variables the solver resolves through usage). Records the return type and
 * the called arity; returns true when this call was a recordable first use.
 */
function pinImplicitFunction(expr: string, returns: ExprType, ctx: CheckContext): boolean {
  const parsed = parseExpression(expr);
  if (!parsed || parsed.kind !== "call") return false;
  if (ctx.functionSignatures.has(parsed.name) || ctx.inferredFunctions.has(parsed.name)) return false;
  ctx.inferredFunctions.set(parsed.name, { returns, arity: parsed.args.length });
  return true;
}

/**
 * Record an unknown expression used as a condition: upstream constrains
 * condition expressions to Boolean, so an unknown variable or implicit
 * function call resolves to bool rather than reporting YS0029.
 */
function constrainCondition(type: ExprType, expr: string, ctx: CheckContext): void {
  if (type.base !== "unknown" || type.enumName || type.error) return;
  const parsed = parseExpression(expr);
  if (!parsed) return;
  if (parsed.kind === "var" && !ctx.variableTypes.has(parsed.name)) {
    ctx.variableTypes.set(parsed.name, "bool");
  } else if (parsed.kind === "call") {
    pinImplicitFunction(expr, { base: "bool" }, ctx);
  }
}

/** Type-check a condition expression: check, resolve `.Case` shorthand, and
 *  bool-constrain unknown operands (the shared shape of every condition
 *  site: if-branches, once blocks, options, and line conditions). */
function checkCondition(expr: string, ctx: CheckContext): { type: ExprType; rewritten: string } {
  const checked = checkExpression(expr, ctx);
  constrainCondition(checked.type, checked.rewritten, ctx);
  return checked;
}

/** Collect variable references from a text's inline `{expr}` spans and
 *  type-check each as an expression — the spans come from the runtime's
 *  scanner (src/runtime/interpolate.ts), so the checker classifies exactly
 *  what delivery will evaluate (its own loop had already drifted: it
 *  skipped two chars after any backslash, where the runtime only escapes
 *  `\{` / `\}`). `base` is the text's file position when known (a line's
 *  1-based `lineNumber` — column 0 of the text is taken as column 0 of the
 *  source line; indented lines shift, an approximation noted on the
 *  ticket). */
function collectInlineExpressionVars(
  text: string,
  ctx: CheckContext,
  base?: { line: number; col: number },
): void {
  for (const span of inlineExpressionSpans(text)) {
    const exprSrc = span.source;
    const parsed = parseExpression(exprSrc);
    const collect = (node: ExprNode): void => {
      switch (node.kind) {
        case "var":
          ctx.inlineVarUses.add(node.name);
          break;
        case "un":
          collect(node.operand);
          break;
        case "bin":
          collect(node.left);
          collect(node.right);
          break;
        case "call":
          node.args.forEach(collect);
          break;
        default:
          break;
      }
    };
    if (parsed) collect(parsed);
      // Type-check the inline span too: the runtime evaluates
      // every `{...}` span as an expression, so the checker validates them
      // as expressions — YS0028 for a variable inside a conversion that
      // still can't be inferred, YS0005 for a malformed span. Rewrites are
      // discarded: inline-text `.Case` resolution happens in lowering.
      // The span's expression starts one column past the opening brace.
      ctx.currentRange = base ? { line: base.line, col: base.col + span.start + 1 } : undefined;
      checkExpression(exprSrc, ctx);
      ctx.currentRange = undefined;
  }
}

function walkStatements(stmts: Statement[], ctx: CheckContext): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Command": {
        const content = s.content;

        const stateStatement = parseStateStatement(content);

        if (stateStatement?.kind === "declare") {
          const { name, expression: expr, declaredType } = stateStatement;
          const expectedEnum = declaredType && ctx.enumTypes.has(declaredType) ? declaredType : undefined;
          let { type, rewritten } = checkExpression(expr, ctx, expectedEnum);
          if (rewritten !== expr) s.content = `declare $${name} = ${rewritten}${declaredType ? ` as ${declaredType}` : ""}`;
          if (type.base === "unknown" && !type.enumName && !type.error) {
            // The initializer's type is undetermined (the Inference-*
            // fixtures). An explicit `as` type pins it (also pinning an
            // implicit function's return); otherwise neither the expression
            // nor the variable can ever be typed — YS0029 for both, as
            // upstream's solver leaves both unresolved.
            const declared: ExprType | undefined = declaredType ? typeFromName(declaredType, ctx) : undefined;
            if (declared) {
              if (pinImplicitFunction(expr, declared, ctx)) type = declared;
            } else if (!declaredType) {
              ctx.undeterminedSites.push({ text: expr, target: name });
            }
          }
          // Smart-variable classification: an initializer that is
          // not a plain literal declares a smart variable (upstream
          // ResolveInitialValues → Declaration.IsInlineExpansion).
          const isSmart = isSmartVariableInitializer(rewritten);
          // YS0039 (upstream ExitDeclare_statement): a variable can only have
          // one declaration — an in-script `<<declare>>` conflicts with the
          // host's external declarations and with any earlier in-script
          // declaration. Upstream reports both occurrences — this one and
          // the original declaration's source.
          const originalDeclaration = ctx.declaredVariables.get(name);
          if (ctx.externalVariables.has(name) || originalDeclaration) {
            ctx.emit("YS0039", `Redeclaration of existing variable $${name}`, ctx.currentFile);
            if (originalDeclaration?.file !== undefined) {
              ctx.emit("YS0039", `Redeclaration of existing variable $${name}`, originalDeclaration.file);
            }
          }
          if (!originalDeclaration) {
            ctx.declaredVariables.set(name, { isSmart, expression: rewritten, file: ctx.currentFile });
          }
          if (declaredType) {
            ctx.variableTypes.set(name, declaredType);
          } else if (type.enumName) {
            ctx.variableTypes.set(name, type.enumName);
          } else if (type.base !== "unknown") {
            ctx.variableTypes.set(name, type.base);
          }
          // YS0053 (upstream ExitDeclare_statement's DeclarationValueDoesntMatchType
          // constraint): an explicit `as` type must match the initial value's
          // type. Upstream's message template (Definitions/YS0053):
          // "{0} is declared to be a {1}, but its initial value '{2}' is a {3}".
          if (declaredType && !type.error && (type.base !== "unknown" || type.enumName)) {
            const declaredDisplay = ctx.enumTypes.has(declaredType)
              ? declaredType
              : (PRIM_NAME[declaredType.toLowerCase()] ?? declaredType);
            const valueDisplay = describeUpstream(type);
            if (valueDisplay && valueDisplay !== declaredDisplay) {
              ctx.emit(
                "YS0053",
                `$${name} is declared to be a ${declaredDisplay}, but its initial value '${expr.trim()}' is a ${valueDisplay}`,
                ctx.currentFile,
              );
            }
          }
          ctx.declarations.push({
            name,
            type: declaredType ?? type.enumName ?? (type.base !== "unknown" ? type.base : "unknown"),
            defaultValue: isSmart ? undefined : primOrDefault(rewritten, ctx.enumTypes),
            ...(s.docComment ? { description: s.docComment } : {}),
            ...(isSmart ? { isSmartVariable: true } : {}),
          });
          break;
        }

        // Compound assignment (`<<set $var += expr>>`):
        // assignment to a smart variable is read-only (YS0030), same as a
        // plain `<<set>>`.
        if (stateStatement?.kind === "set" && stateStatement.compoundOp) {
          const { name } = stateStatement;
          emitReadOnlyIfSmart(name, ctx);
          if (!ctx.declaredVariables.has(name) && !ctx.externalVariables.has(name)) {
            ctx.undeclaredUses.push({ name, file: ctx.currentFile });
          }
          break;
        }

        if (stateStatement?.kind === "set") {
          const { name, assignment: op, expression: rest } = stateStatement;
          emitReadOnlyIfSmart(name, ctx);
          const varType = ctx.variableTypes.get(name);
          const expectedEnum = varType && ctx.enumTypes.has(varType) ? varType : undefined;
          let { type, rewritten } = checkExpression(rest, ctx, expectedEnum);
          // YS0003 collection: a `<<set>>` target is a use of the
          // variable (the upstream YS0003 example pins `<<set $x = 3>>`). A
          // value expression that already failed validation suppresses the
          // report — upstream's Error type stops the cascade there (the
          // YS0038 pin: `<<set $x = Test.Failure>>` reports YS0038 only).
          if (type.error !== true && !ctx.declaredVariables.has(name) && !ctx.externalVariables.has(name)) {
            ctx.undeclaredUses.push({ name, file: ctx.currentFile });
          }
          if (rewritten !== rest) s.content = `set $${name} ${op} ${rewritten}`;
          if (type.base === "unknown" && !type.enumName && !type.error) {
            if (varType) {
              // The value's type is undetermined, but the target's is known:
              // upstream's solver resolves the value through the target
              // (pinning an implicit function's return type — the
              // Inference-* fixtures). No diagnostic.
              const target: ExprType = typeFromName(varType, ctx) ?? UNKNOWN_TYPE;
              if (target.base !== "unknown" || target.enumName) {
                if (pinImplicitFunction(rest.trim(), target, ctx)) type = target;
              }
            } else {
              // Neither side can be typed yet (e.g. `<<set $a = somefunc()>>`).
              // Resolution is deferred to the post-walk pass: a later
              // statement may pin the variable (upstream's solver is global).
              ctx.undeterminedSites.push({ text: rest.trim(), target: name });
              break;
            }
          }
          const typeName = describeUpstream(type);
          if (varType) {
            const varDisplay = ctx.enumTypes.has(varType) ? varType : PRIM_NAME[varType];
            if (typeName && varDisplay && typeName !== varDisplay) {
              // Upstream ExitSet_statement: convertible-to-target constraint
              // failure.
              ctx.emit("YS0050", `$${name} (${varDisplay}) cannot be assigned a ${typeName}`);
            }
          } else if (type.enumName) {
            // Upstream infers a variable's type from an enum-typed assignment.
            ctx.variableTypes.set(name, type.enumName);
          } else if (type.base !== "unknown") {
            // Implicit declaration from the assignment (upstream: a variable
            // first seen in a <<set>> carries the value's type).
            ctx.variableTypes.set(name, type.base);
          }
          break;
        }

        const call = content.match(CALL_STATEMENT);
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
            const { rewritten } = checkCondition(b.condition, ctx);
            if (rewritten !== b.condition) b.condition = rewritten;
          }
          walkStatements(b.body, ctx);
        }
        break;
      case "Once":
        if (s.condition) {
          const { rewritten } = checkCondition(s.condition, ctx);
          if (rewritten !== s.condition) s.condition = rewritten;
        }
        walkStatements(s.body, ctx);
        if (s.elseBody) walkStatements(s.elseBody, ctx);
        break;
      case "OptionGroup":
        for (const o of s.options) {
          const optionBase =
            o.lineNumber !== undefined ? { line: o.lineNumber - 1, col: 0 } : undefined;
          if (o.condition) {
            const at = optionBase ? locateCondition(o.text, o.condition) : undefined;
            ctx.currentRange = at ? { line: optionBase!.line, col: optionBase!.col + at } : undefined;
            const { rewritten } = checkCondition(o.condition, ctx);
            ctx.currentRange = undefined;
            if (rewritten !== o.condition) o.condition = rewritten;
          }
          if (o.once?.condition) {
            const at = optionBase ? locateCondition(o.text, o.once.condition) : undefined;
            ctx.currentRange = at ? { line: optionBase!.line, col: optionBase!.col + at } : undefined;
            const { rewritten } = checkCondition(o.once.condition, ctx);
            ctx.currentRange = undefined;
            if (rewritten !== o.once.condition) o.once.condition = rewritten;
          }
          collectInlineExpressionVars(o.text, ctx, optionBase);
          walkStatements(o.body, ctx);
        }
        break;
      case "Line":
        checkLineStatement(s, ctx);
        break;
      case "LineGroup":
        for (const item of s.items) {
          checkLineStatement(item, ctx);
          // The item's indented body checks as part of the item (upstream
          // visits line_group_item's statements with the node body).
          if (item.body) walkStatements(item.body, ctx);
        }
        break;
      case "Jump": {
        // Jump-target expressions must resolve to strings (upstream
        // ExitJumpToExpression's convertible-to-String constraint).
        const targetExpr = s.target.match(/^\{([\s\S]*)\}$/);
        if (targetExpr) {
          const { type } = checkExpression(targetExpr[1], ctx);
          if (type.base === "unknown" && !type.enumName && !type.error) {
            // Upstream's constraint resolves an unknown target to String —
            // record that so later uses of it don't report YS0029.
            pinImplicitFunction(targetExpr[1], { base: "string" }, ctx);
            const bare = parseExpression(targetExpr[1]);
            if (bare?.kind === "var") ctx.variableTypes.set(bare.name, "string");
          } else {
            const convertible =
              type.base === "string" ||
              (type.enumName !== undefined && ctx.enumTypes.get(type.enumName)?.rawValueType === "string");
            const display = describeUpstream(type);
            if (!convertible && display) {
              ctx.emit(
                "YS0050",
                `jump statement's expression must be convertible to String, but ${display} is not`,
              );
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Collect inline-expression uses and bool-constrain a line's conditions
 *  (lines and line-group items share the shape). */
function checkLineStatement(line: Line, ctx: CheckContext): void {
  // The line's file position (0-based) anchors signature-mismatch ranges;
  // conditions are located inside the line text when present (upstream pins
  // `when:`/condition ranges to the expression's columns).
  const base =
    line.lineNumber !== undefined ? { line: line.lineNumber - 1, col: 0 } : undefined;
  collectInlineExpressionVars(line.text, ctx, base);
  for (const condition of [line.condition, line.once?.condition]) {
    if (!condition) continue;
    const at = base ? locateCondition(line.text, condition) : undefined;
    ctx.currentRange = at ? { line: base!.line, col: base!.col + at } : undefined;
    const { rewritten } = checkCondition(condition, ctx);
    ctx.currentRange = undefined;
    if (rewritten !== condition) {
      if (line.condition === condition) line.condition = rewritten;
      else if (line.once) line.once.condition = rewritten;
    }
  }
}

/** A condition expression's column within its line's text (the expression
 *  appears verbatim after its `<<if`/`<<once if` introducer); undefined
 *  when it can't be located. */
function locateCondition(text: string, condition: string): number | undefined {
  const at = text.indexOf(condition);
  return at >= 0 ? at : undefined;
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
 * YS0030: smart variables are read-only — any assignment to one
 * is an error (upstream Compiler.AddErrorsForSettingReadonlyVariables).
 * The message carries the variable and its always-equal initializer
 * expression, per the upstream YS0030 registry definition.
 */
function emitReadOnlyIfSmart(name: string, ctx: CheckContext): void {
  const declaration = ctx.declaredVariables.get(name);
  if (declaration?.isSmart) {
    ctx.emit(
      "YS0030",
      `$${name} cannot be modified (it's a smart variable and is always equal to ${declaration.expression})`,
    );
  }
}

/**
 * YS0045: smart variables must not form reference loops
 * (upstream TypeCheckerListener.GetDependenciesForVariable). For each smart
 * declaration, a depth-tracking DFS over the initializer's variable
 * references follows smart-variable declarations only; re-reaching a
 * declaration at a different depth is a loop. Reaching one at the same depth
 * (`$E = $C || $C`) is fine, as upstream.
 */
function detectSmartVariableLoops(ctx: CheckContext): void {
  const children = (node: ExprNode): ExprNode[] => {
    switch (node.kind) {
      case "bin":
        return [node.left, node.right];
      case "un":
        return [node.operand];
      case "call":
        return node.args;
      default:
        return [];
    }
  };

  for (const [startName, startDecl] of ctx.declaredVariables) {
    if (!startDecl.isSmart) continue;
    const start = parseExpression(startDecl.expression);
    if (!start) continue;

    const seenLevels = new Map<string, Set<number>>([[startName, new Set([0])]]);
    const stack: Array<{ node: ExprNode; level: number }> = [{ node: start, level: 0 }];
    while (stack.length > 0) {
      const { node, level } = stack.pop()!;
      if (node.kind === "var") {
        const dependency = ctx.declaredVariables.get(node.name);
        if (!dependency || !dependency.isSmart) continue; // stored variables end the chain
        const levels = seenLevels.get(node.name);
        if (levels && [...levels].some((seen) => seen !== level)) {
          ctx.emit(
            "YS0045",
            `Smart variables cannot contain reference loops (referencing $${node.name} here creates a loop for the smart variable ${startName}).`,
          );
          break;
        }
        if (!levels) {
          seenLevels.set(node.name, new Set([level]));
        } else {
          levels.add(level);
        }
        const dependencyExpr = parseExpression(dependency.expression);
        if (dependencyExpr) stack.push({ node: dependencyExpr, level: level + 1 });
        continue;
      }
      for (const child of children(node)) stack.push({ node: child, level: level + 1 });
    }
  }
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
          makeDiagnostic("YS0035", describeError(e)),
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
  const externalVariables = new Set<string>();
  for (const [name, decl] of Object.entries(opts.declarations?.variables ?? {})) {
    externalVariables.add(name);
    variableTypes.set(name, decl.type);
    declarations.push({
      name,
      type: decl.type,
      ...(decl.defaultValue !== undefined ? { defaultValue: decl.defaultValue } : {}),
    });
  }
  const ctx: CheckContext = {
    enumTypes,
    variableTypes,
    functionSignatures,
    emit: (code, message, file, range) => emitDiagnostic(makeDiagnostic(code, message, { file, range })),
    rewrites: [],
    declarations,
    declaredVariables: new Map(),
    externalVariables,
    inferredFunctions: new Map(),
    inlineVarUses: new Set(),
    undeclaredUses: [],
    inferenceFailures: new Set(),
    undeterminedSites: [],
  };

  for (const node of doc.nodes) {
    ctx.currentFile = node.sourceFile;
    // `when:` headers carry expressions (upstream `header_when_expression`
    // is a grammar rule: an expression, `always`, or `once [if expr]` — a
    // malformed expression never parses, so `when: foo bar` / `when: $x &&`
    // are compile errors). Validate each header's expression with the same
    // checker the statements use, and bool-constrain its variables like
    // every other condition site.
    for (const raw of node.when ?? []) {
      const parsed = parseSaliencyCondition(raw);
      if (parsed.kind === "always" || parsed.kind === "once") continue;
      checkCondition(parsed.expression, ctx);
    }
    walkStatements(node.body, ctx);
  }

  // Undetermined set/declare sites (the upstream Inference-* fixtures):
  // upstream's solver resolves these globally, so a site only reports
  // YS0029 when — after the whole walk — neither its expression's function
  // nor its target variable got a type. Both the expression and the target
  // are reported, as upstream.
  for (const site of ctx.undeterminedSites) {
    if (ctx.variableTypes.has(site.target)) continue;
    emitUndetermined(site.text, ctx);
    emitUndetermined(`$${site.target}`, ctx);
  }

  // Undeclared variable uses (YS0003): a use whose variable has
  // no `<<declare>>` and no external declaration anywhere in the program
  // warns once per use site — the upstream YS0003 example pins that a
  // `<<set>>` target counts as a use.
  for (const use of ctx.undeclaredUses) {
    if (ctx.declaredVariables.has(use.name) || ctx.externalVariables.has(use.name)) continue;
    emitDiagnostic(
      makeDiagnostic(
        "YS0003",
        `Variable '$${use.name}' is used but not declared. Declare it with: <<declare $${use.name} = value>>`,
        { file: use.file },
      ),
    );
  }

  // Inline-expression uses: a variable referenced from line,
  // option, or command text that nothing could type has no implicit
  // declaration upstream can resolve — YS0029 for each such use site.
  // (YS0029 deliberately stays here, not YS0003: the fixture pin
  // is that an undeclared inline use is a compile-failing YS0029.)
  for (const name of ctx.inlineVarUses) {
    if (ctx.inferenceFailures.has(name)) continue;
    if (!ctx.variableTypes.has(name) && !ctx.declaredVariables.has(name)) {
      emitUndetermined(`$${name}`, ctx);
    }
  }

  // Implicit declarations (upstream TypeCheckerListener.AddDeclaration's
  // implicit declarations + Compiler.Compile's declaration surface): every
  // variable whose type the checker pinned without an authored
  // `<<declare>>` — from a `<<set>>` target, a Boolean-constrained
  // condition, an inline use, or a plain read — is surfaced in the
  // artifact with the implicit flag and the type's default value (upstream:
  // `decl.DefaultValue = typeLiteral.DefaultValue`). Variables whose type
  // never resolved report YS0029/YS0028 above and carry no declaration, and
  // enum-typed variables have no default to seed (upstream reports an
  // internal error for those; here they're simply omitted).
  for (const [name, type] of ctx.variableTypes) {
    if (type !== "number" && type !== "string" && type !== "bool") continue;
    if (ctx.declaredVariables.has(name) || ctx.externalVariables.has(name)) continue;
    if (ctx.inferenceFailures.has(name)) continue;
    ctx.declarations.push({
      name,
      type,
      defaultValue: type === "number" ? 0 : type === "bool" ? false : "",
      isImplicit: true,
    });
  }

  // Smart-variable validation: reference loops across the
  // declared smart variables (YS0045).
  detectSmartVariableLoops(ctx);

  return { declarations, enumTypes };
}
