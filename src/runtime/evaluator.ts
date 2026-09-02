/**
 * Safe expression evaluator for Yarn Spinner conditions.
 * Supports variables, functions, comparisons, and logical operators.
 */

/**
 * Render a value for string concatenation and composed text, the way upstream
 * does (C# value.ToString()): booleans as "True"/"False". This is the
 * observable text contract the upstream conformance corpus asserts.
 */
export function stringifyOperand(value: unknown): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value ?? "");
}

/** The implicit default a variable has when compared against a typed value. */
function defaultValueFor(value: unknown): unknown {
  switch (typeof value) {
    case "boolean": return false;
    case "number": return 0;
    case "string": return "";
    default: return undefined;
  }
}

export class ExpressionEvaluator {
  private smartVariables: Record<string, string> = {}; // variable name -> expression
  
  constructor(
    private variables: Record<string, unknown> = {},
    /** Function lookup — reads through the runtime's Library (ticket 43). */
    private functions: { get(name: string): ((...args: unknown[]) => unknown) | undefined } = { get: () => undefined },
    /** Enum registry: enum name → case name → raw value (ticket 41). */
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
   */
  evaluateExpression(expr: string): unknown {
    const trimmed = this.preprocess(expr.trim());
    if (!trimmed) return false;

    // Handle function calls like `functionName(arg1, arg2)`
    if (this.looksLikeFunctionCall(trimmed)) {
      return this.evaluateFunctionCall(trimmed);
    }

    // Handle comparisons
    if (this.containsComparison(trimmed)) {
      return this.evaluateComparison(trimmed);
    }

    // Handle logical operators
    if (trimmed.includes("&&") || trimmed.includes("||")) {
      return this.evaluateLogical(trimmed);
    }

    // Handle negation
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
    return /[<>=!]/.test(expr);
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

    const toNumber = (value: unknown): number => {
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      if (value == null || value === "") return 0;
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`Cannot convert ${String(value)} to number`);
      }
      return num;
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
        return -toNumber(parsePrimary());
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
          const right = toNumber(parseUnary());
          const left = toNumber(value);
          if (char === "*") {
            value = left * right;
          } else if (char === "/") {
            value = left / right;
          } else {
            value = left % right;
          }
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
          const right = parseMulDiv();
          if (char === "+") {
            // String addition concatenates (upstream: string + anything);
            // booleans render as upstream's C# ToString ("True"/"False").
            if (typeof value === "string" || typeof right === "string") {
              value = stringifyOperand(value) + stringifyOperand(right);
            } else {
              value = toNumber(value) + toNumber(right);
            }
          } else {
            value = toNumber(value) - toNumber(right);
          }
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
        return this.deepEquals(leftVal, rightVal);
      case "!==":
      case "!=":
        return !this.deepEquals(leftVal, rightVal);
      case "<":
        return Number(leftVal) < Number(rightVal);
      case ">":
        return Number(leftVal) > Number(rightVal);
      case "<=":
        return Number(leftVal) <= Number(rightVal);
      case ">=":
        return Number(leftVal) >= Number(rightVal);
      default:
        throw new Error(`Unknown operator: ${op}`);
    }
  }

  private evaluateLogical(expr: string): boolean {
    // Split by && or ||, respecting parentheses
    const parts: Array<{ expr: string; op: "&&" | "||" | null }> = [];
    let depth = 0;
    let current = "";
    let lastOp: "&&" | "||" | null = null;

    for (const char of expr) {
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (depth === 0 && expr.includes(char === "&" ? "&&" : char === "|" ? "||" : "")) {
        // Check for && or ||
        const remaining = expr.slice(expr.indexOf(char));
        if (remaining.startsWith("&&")) {
          if (current.trim()) {
            parts.push({ expr: current.trim(), op: lastOp });
            current = "";
          }
          lastOp = "&&";
          // skip &&
          continue;
        } else if (remaining.startsWith("||")) {
          if (current.trim()) {
            parts.push({ expr: current.trim(), op: lastOp });
            current = "";
          }
          lastOp = "||";
          // skip ||
          continue;
        }
      }
      current += char;
    }
    if (current.trim()) parts.push({ expr: current.trim(), op: lastOp });

    // Simple case: single expression
    if (parts.length === 0) return !!this.evaluateExpression(expr);

    // Evaluate parts (supports &&, ||, ^ as xor)
    let result = this.evaluateExpression(parts[0].expr);
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const val = this.evaluateExpression(part.expr);
      if (part.op === "&&") {
        result = result && val;
      } else if (part.op === "||") {
        result = result || val;
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

    if (Object.prototype.hasOwnProperty.call(this.variables, key)) {
      return this.variables[key];
    }

    // Smart variable: re-evaluate its expression on every access (ticket 42).
    if (Object.prototype.hasOwnProperty.call(this.smartVariables, key)) {
      return this.evaluateExpression(this.smartVariables[key]);
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
    return this.variables[key];
  }
  
  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    // Unset variables carry their implicit default (upstream: bool→false,
    // number→0, string→"") inferred from the other side of the comparison.
    if (a === undefined && b !== undefined) return this.deepEquals(b, defaultValueFor(b));
    if (b === undefined && a !== undefined) return this.deepEquals(a, defaultValueFor(a));
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a === "object") {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }

  /**
   * Update variables. Can be used to mutate state during dialogue.
   *
   * Note: a write to a smart variable's name shadows its expression (upstream
   * `VariableKind.Stored` wins); `<<set>>` to a smart variable is a compile
   * error (YS0030), so only host writes can shadow.
   */
  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }
  
  /**
   * Register a smart variable (variable with expression that recalculates on
   * each access). Expressions are seeded from `program.smartVariables` at
   * start-up; smart variables never take an initial stored value.
   */
  setSmartVariable(name: string, expression: string): void {
    this.smartVariables[name] = expression;
  }
  
  /**
   * Check if a variable is a smart variable.
   */
  isSmartVariable(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.smartVariables, name);
  }

  /**
   * Upstream `Dialogue.TryGetSmartVariable`: recompute a smart variable's
   * current value. A stored value under the same name (a host write) shadows
   * the expression, mirroring upstream's VariableKind.Stored precedence.
   */
  tryGetSmartVariable(name: string): { ok: true; value: unknown } | { ok: false } {
    if (!this.isSmartVariable(name)) return { ok: false };
    if (Object.prototype.hasOwnProperty.call(this.variables, name)) {
      return { ok: true, value: this.variables[name] };
    }
    return { ok: true, value: this.evaluateExpression(this.smartVariables[name]) };
  }

  /**
   * Get variable value (upstream `VariableStorage.TryGetValue`: a smart
   * variable recomputes; a stored value wins when shadowed).
   */
  getVariable(name: string): unknown {
    if (this.isSmartVariable(name) && !Object.prototype.hasOwnProperty.call(this.variables, name)) {
      return this.evaluateExpression(this.smartVariables[name]);
    }
    return this.variables[name];
  }
}

