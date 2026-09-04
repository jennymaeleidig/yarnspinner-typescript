// SPDX-License-Identifier: CC0-1.0
/**
 * Safe expression evaluator for Yarn Spinner conditions.
 * Supports variables, functions, comparisons, and logical operators.
 */

import { InMemoryVariableStorage, type VariableStorage } from "./variableStorage.js";
import { applyBinaryOp, applyUnaryOp } from "./operands.js";

// The operand primitives moved to ./operands.ts (the one operand-semantics
// module); this re-export keeps their historical import path — and the
// package's public surface (index.ts `export *`) — unchanged.
export { stringifyOperand, toNumberOperand, deepEqualsOperands } from "./operands.js";

/** One character's structural position in an expression: the open-paren
 * depth once the character is consumed, and whether it sits inside a
 * string literal (opening and closing quote characters included). The
 * shared scan both the logical splitter and the paren unwrapper walk —
 * quote/depth tracking stated once (the standards review's Duplicated
 * Code finding: two hand-rolled copies of the same loop). */
interface ScanChar {
  char: string;
  index: number;
  depth: number;
  inString: boolean;
}

function scanStructure(expr: string): ScanChar[] {
  const chars: ScanChar[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (quote) {
      chars.push({ char, index: i, depth, inString: true });
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      chars.push({ char, index: i, depth, inString: true });
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") depth--;
    chars.push({ char, index: i, depth, inString: false });
  }
  return chars;
}

export class ExpressionEvaluator {
  /** variable name → recomputing read (compiled bytecode). */
  private smartVariables: Record<string, () => unknown> = {}; // variable name -> read
  
  constructor(
    private variables: VariableStorage = new InMemoryVariableStorage(),
    /** Function lookup — reads through the runtime's Library. */
    private functions: { get(name: string): ((...args: unknown[]) => unknown) | undefined } = { get: () => undefined },
    /** Enum registry: enum name → case name → raw value. */
    private enums: Record<string, Record<string, number | string>> = {}
  ) {}

  /**
   * Evaluate a condition expression and return a boolean result.
   * Supports: variables, literals (numbers, strings, booleans), comparisons, logical ops, function calls.
   */
  evaluate(expr: string): boolean {
    try {
      const result = this.evaluateExpression(expr);
      return !!result;
    } catch {
      return false;
    }
  }

  /**
   * Evaluate an expression that can return any value (not just boolean).
   *
   * The dispatch follows the checker/codegen grammar layering (upstream's
   * single expression grammar) — loosest first, so a mixed expression
   * parses against the same tree the type checker validated:
   * and/or/xor level → comparison → negation → arithmetic → value.
   * (The old order — comparison dispatch before logical — parsed
   * `$a == 1 && $b > 2` as `$a == ((1 && $b) > 2)`; a leading `!` claimed
   * the comparison dispatcher and threw on any negated expression; and a
   * fully parenthesized logical `(1 && 0)` recursed infinitely. All fixed
   * here — deepening-wave-2 ticket 09.)
   */
  evaluateExpression(expr: string): unknown {
    const trimmed = this.preprocess(expr.trim());
    if (!trimmed) return false;

    // Handle function calls like `functionName(arg1, arg2)`
    if (this.looksLikeFunctionCall(trimmed)) {
      return this.evaluateFunctionCall(trimmed);
    }

    // A fully parenthesized expression is a primary (the checker's
    // parsePrimary unwraps it): strip the outer parens and re-enter, so
    // `(1 && 0)` evaluates instead of degrading to a value lookup (the
    // old dispatcher recursed infinitely here).
    const unwrapped = this.unwrapParens(trimmed);
    if (unwrapped !== null) {
      return this.evaluateExpression(unwrapped);
    }

    // Logical level FIRST — the loosest operators split before anything
    // claims their operands (the checker's parseOr is the layering).
    const logicalParts = this.splitLogical(trimmed);
    if (logicalParts) {
      return this.evaluateLogical(logicalParts);
    }

    // Handle comparisons. Every comparison operator contains `=`, `<`, or
    // `>` — a leading `!` that isn't `!=`/`!==` must not claim this
    // dispatcher (that made `!true` throw). A leading `!` over a
    // comparison expression still lands here: `!x == y` parses as
    // `(!x) == y` (upstream unary), and evaluateComparison's left side
    // recurses into the negation.
    if (this.containsComparison(trimmed)) {
      return this.evaluateComparison(trimmed);
    }

    // Handle negation (unary `!` binds tightest — after the comparison
    // level, matching the checker's parseUnary placement).
    if (trimmed.startsWith("!")) {
      return !this.evaluateExpression(trimmed.slice(1).trim());
    }

     // Handle arithmetic expressions (+, -, *, /, %)
     if (this.containsArithmetic(trimmed)) {
       return this.evaluateArithmetic(trimmed);
     }

    // Simple variable or literal
    return this.resolveValue(trimmed);
  }

  private preprocess(expr: string): string {
    // Normalize operator word aliases to JS-like symbols
    // Whole word replacements only
    return expr
      .replace(/\bnot\b/gi, "!")
      .replace(/\band\b/gi, "&&")
      .replace(/\bor\b/gi, "||")
      .replace(/\bxor\b/gi, "^")
      .replace(/\beq\b|\bis\b/gi, "==")
      .replace(/\bneq\b/gi, "!=")
      .replace(/\bgte\b/gi, ">=")
      .replace(/\blte\b/gi, "<=")
      .replace(/\bgt\b/gi, ">")
      .replace(/\blt\b/gi, "<");
  }

  private evaluateFunctionCall(expr: string): unknown {
    const match = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)$/);
    if (!match) throw new Error(`Invalid function call: ${expr}`);

    const [, name, argsStr] = match;
    const func = this.functions.get(name);
    if (!func) throw new Error(`Function not found: ${name}`);

    const args = this.parseArguments(argsStr);
    const evaluatedArgs = args.map((arg) => this.evaluateExpression(arg.trim()));

    return func(...evaluatedArgs);
  }

  private parseArguments(argsStr: string): string[] {
    if (!argsStr.trim()) return [];
    const args: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of argsStr) {
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim()) args.push(current.trim());
    return args;
  }

  private containsComparison(expr: string): boolean {
    // Every comparison operator contains `=`, `<`, or `>` (including the
    // `!=`/`!==` spellings) — a bare leading `!` must not claim the
    // comparison dispatcher, or any negated expression throws.
    return /[<>=]/.test(expr);
  }

  private looksLikeFunctionCall(expr: string): boolean {
    return /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(.*\)$/.test(expr);
  }
  private containsArithmetic(expr: string): boolean {
    // Remove quoted strings to avoid false positives on "-" or "+" inside literals
    const unquoted = expr.replace(/"[^"]*"|'[^']*'/g, "");
    return /[+\-*/%]/.test(unquoted);
  }

  private evaluateArithmetic(expr: string): unknown {
    const input = expr;
    let index = 0;

    const skipWhitespace = () => {
      while (index < input.length && /\s/.test(input[index])) {
        index++;
      }
    };

    const readToken = (): string => {
      skipWhitespace();
      const start = index;
      let depth = 0;
      let inQuotes = false;
      let quoteChar = "";

      while (index < input.length) {
        const char = input[index];
        if (inQuotes) {
          if (char === quoteChar) {
            inQuotes = false;
            quoteChar = "";
          }
          index++;
          continue;
        }

        if (char === '"' || char === "'") {
          inQuotes = true;
          quoteChar = char;
          index++;
          continue;
        }

        if (char === "(") {
          depth++;
          index++;
          continue;
        }

        if (char === ")") {
          if (depth === 0) break;
          depth--;
          index++;
          continue;
        }

        if (depth === 0 && "+-*/%".includes(char)) {
          break;
        }

        if (depth === 0 && /\s/.test(char)) {
          break;
        }

        index++;
      }

      return input.slice(start, index).trim();
    };

    const parsePrimary = (): unknown => {
      skipWhitespace();
      if (index >= input.length) {
        throw new Error("Unexpected end of expression");
      }

      const char = input[index];
      if (char === "(") {
        index++;
        const value = parseAddSub();
        skipWhitespace();
        if (input[index] !== ")") {
          throw new Error("Unmatched parenthesis in expression");
        }
        index++;
        return value;
      }

      const token = readToken();
      if (!token) {
        throw new Error("Invalid expression token");
      }
      return this.evaluateExpression(token);
    };

    const parseUnary = (): unknown => {
      skipWhitespace();
      if (input[index] === "+") {
        index++;
        return parseUnary();
      }
      if (input[index] === "-") {
        index++;
        return applyUnaryOp("negate", parsePrimary());
      }
      return parsePrimary();
    };

    const parseMulDiv = (): unknown => {
      let value = parseUnary();
      while (true) {
        skipWhitespace();
        const char = input[index];
        if (char === "*" || char === "/" || char === "%") {
          index++;
          const op = char === "*" ? "multiply" : char === "/" ? "divide" : "modulo";
          value = applyBinaryOp(op, value, parseUnary());
          continue;
        }
        break;
      }
      return value;
    };

    const parseAddSub = (): unknown => {
      let value = parseMulDiv();
      while (true) {
        skipWhitespace();
        const char = input[index];
        if (char === "+" || char === "-") {
          index++;
          // applyBinaryOp owns the rule (string concat with upstream
          // rendering, else numeric) — the same statement the VM's add
          // applies.
          value = applyBinaryOp(char === "+" ? "add" : "subtract", value, parseMulDiv());
          continue;
        }
        break;
      }
      return value;
    };

    const result = parseAddSub();
    skipWhitespace();
    if (index < input.length) {
      throw new Error(`Unexpected token "${input.slice(index)}" in expression`);
    }
    return result;
  }

  private evaluateComparison(expr: string): boolean {
    // Match comparison operators (avoid matching !=, <=, >=)
    const match = expr.match(/^(.+?)\s*(===|==|!==|!=|=|<=|>=|<|>)\s*(.+)$/);
    if (!match) throw new Error(`Invalid comparison: ${expr}`);

    const [, left, rawOp, right] = match;
    const op = rawOp === "=" ? "==" : rawOp;
    const leftVal = this.evaluateExpression(left.trim());
    const rightVal = this.evaluateExpression(right.trim());

    switch (op) {
      case "===":
      case "==":
        return !!applyBinaryOp("equalTo", leftVal, rightVal);
      case "!==":
      case "!=":
        return !!applyBinaryOp("notEqualTo", leftVal, rightVal);
      case "<":
        return !!applyBinaryOp("lessThan", leftVal, rightVal);
      case ">":
        return !!applyBinaryOp("greaterThan", leftVal, rightVal);
      case "<=":
        return !!applyBinaryOp("lessThanOrEqualTo", leftVal, rightVal);
      case ">=":
        return !!applyBinaryOp("greaterThanOrEqualTo", leftVal, rightVal);
      default:
        throw new Error(`Unknown operator: ${op}`);
    }
  }

  /** The whole expression wrapped in one balanced paren pair (a primary's
   * parens): the inner text, or null. Quote-aware. */
  private unwrapParens(expr: string): string | null {
    if (!expr.startsWith("(") || !expr.endsWith(")")) return null;
    const chars = scanStructure(expr);
    for (const sc of chars) {
      if (sc.char === ")" && sc.depth === 0 && sc.index !== expr.length - 1) {
        return null; // closes early — not one wrapper
      }
    }
    const last = chars[chars.length - 1];
    return last && last.depth === 0 ? expr.slice(1, -1).trim() : null;
  }

  /**
   * The and/or/xor level (upstream ExpAndOrXor): ONE flat left-associative
   * level, paren- and quote-aware. Splitting here happens BEFORE the
   * comparison dispatcher can claim the chain's operands — the layering
   * the checker's parseOr and the codegen's parseOr both implement.
   * Returns the operand/op chain, or null when the expression has no
   * top-level logical operator (the caller falls through the layering).
   */
  private splitLogical(expr: string): Array<{ expr: string; op: "&&" | "||" | "^" | null }> | null {
    const chars = scanStructure(expr);
    const parts: Array<{ expr: string; op: "&&" | "||" | "^" | null }> = [];
    let current = "";
    let lastOp: "&&" | "||" | "^" | null = null;

    for (let k = 0; k < chars.length; k++) {
      const sc = chars[k];
      if (sc.depth === 0 && !sc.inString) {
        const two = expr.slice(sc.index, sc.index + 2);
        const op = two === "&&" || two === "||" ? two : sc.char === "^" ? "^" : null;
        if (op) {
          parts.push({ expr: current.trim(), op: lastOp });
          current = "";
          lastOp = op;
          if (op !== "^") k++; // skip the second char of && / ||
          continue;
        }
      }
      current += sc.char;
    }
    if (parts.length === 0) return null;
    if (current.trim()) parts.push({ expr: current.trim(), op: lastOp });
    return parts;
  }

  private evaluateLogical(
    parts: Array<{ expr: string; op: "&&" | "||" | "^" | null }>,
  ): boolean {
    // Evaluate parts — and/or/xor share one flat left-associative level
    // (upstream ExpAndOrXor), applied through the operand-semantics module
    // (the same rules the VM's stack ops execute).
    let result = this.evaluateExpression(parts[0].expr);
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const val = this.evaluateExpression(part.expr);
      if (part.op === "&&") {
        result = applyBinaryOp("and", result, val);
      } else if (part.op === "||") {
        result = applyBinaryOp("or", result, val);
      } else if (part.op === "^") {
        result = applyBinaryOp("xor", result, val);
      }
    }

    return !!result;
  }

  private resolveValue(expr: string): unknown {
    // Enum member access: EnumName.Case evaluates to the case's raw value
    // (upstream contract — the raw value is what variables hold at runtime;
    // string()/number() conversions of enum cases yield the raw value).
    const enumMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (enumMatch && Object.prototype.hasOwnProperty.call(this.enums, enumMatch[1])) {
      return this.enums[enumMatch[1]][enumMatch[2]];
    }

    // Unresolved .Case shorthand: the compile-time type checker rewrites
    // resolvable shorthand to the full form; leftovers have no runtime value.
    if (expr.startsWith(".") && expr.length > 1) {
      return undefined;
    }

    // Try as variable first (a stored value shadows a smart variable of the
    // same name — upstream VariableKind.Stored wins over VariableKind.Smart).
    const key = expr.startsWith("$") ? expr.slice(1) : expr;

    if (this.variables.has(key)) {
      return this.variables.get(key);
    }

    // Smart variable: re-evaluate on every access.
    if (Object.prototype.hasOwnProperty.call(this.smartVariables, key)) {
      return this.smartVariables[key]();
    }

    // Try as number
    const num = Number(expr);
    if (!isNaN(num) && expr.trim() === String(num)) {
      return num;
    }

    // Try as boolean
    if (expr === "true") return true;
    if (expr === "false") return false;

    // Try as string (quoted)
    if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
      return expr.slice(1, -1);
    }

    // Default: treat as variable (may be undefined)
    return this.variables.get(key);
  }
  
  /**
   * Update variables. Can be used to mutate state during dialogue.
   *
   * Note: a write to a smart variable's name shadows its expression (upstream
   * `VariableKind.Stored` wins); `<<set>>` to a smart variable is a compile
   * error (YS0030), so only host writes can shadow.
   */
  setVariable(name: string, value: unknown): void {
    this.variables.set(name, value);
  }
  
  /**
   * Register a smart variable (variable with a value that recalculates on
   * each access). Registered from the program's compiled smart variables at
   * start-up: the VM evaluates the initializer's bytecode. Smart variables
   * never take an initial stored value.
   */
  setSmartVariable(name: string, compute: () => unknown): void {
    this.smartVariables[name] = compute;
  }
  
  /**
   * Check if a variable is a smart variable.
   */
  isSmartVariable(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.smartVariables, name);
  }

  /**
   * Upstream `Dialogue.TryGetSmartVariable`: compute a smart variable's
   * current value. Reports failure when the name is not a smart variable.
   * A stored value under the same name (a host write) shadows the
   * computation, mirroring upstream's VariableKind.Stored precedence.
   */
  tryGetSmartVariable(name: string): { ok: true; value: unknown } | { ok: false } {
    if (!this.isSmartVariable(name)) return { ok: false };
    if (this.variables.has(name)) {
      return { ok: true, value: this.variables.get(name) };
    }
    return { ok: true, value: this.smartVariables[name]() };
  }

  /**
   * Get variable value (upstream `VariableStorage.TryGetValue`: a smart
   * variable recomputes; a stored value wins when shadowed).
   */
  getVariable(name: string): unknown {
    if (this.isSmartVariable(name) && !this.variables.has(name)) {
      return this.smartVariables[name]();
    }
    return this.variables.get(name);
  }
}

