/**
 * Command parser and handler utilities for Yarn Spinner commands.
 * Commands like <<command_name arg1 arg2>> or <<command_name "arg with spaces">>
 */

import type { ExpressionEvaluator as Evaluator } from "./evaluator";
import { stringifyOperand } from "./evaluator.js";

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

/**
 * Parse a command string like "command_name arg1 arg2" or "set variable value"
 */
export function parseCommand(content: string): ParsedCommand {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Empty command");
  }

  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      // If we have accumulated non-quoted content (e.g. a function name and "(")
      // push it as its own part before entering quoted mode. This prevents the
      // surrounding text from being merged into the quoted content when we
      // later push the quoted value.
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (char === quoteChar && inQuotes) {
      inQuotes = false;
      // Preserve the surrounding quotes in the parsed part so callers that
      // reassemble the expression (e.g. declare handlers) keep string literals
      // intact instead of losing quote characters.
      parts.push(quoteChar + current + quoteChar);
      quoteChar = "";
      current = "";
      continue;
    }

    if (char === " " && !inQuotes) {
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  if (parts.length === 0) {
    throw new Error("No command name found");
  }

  return {
    name: parts[0],
    args: parts.slice(1),
    raw: content,
  };
}

/**
 * Built-in command handlers for common Yarn Spinner commands.
 */
export class CommandHandler {
  private handlers = new Map<string, (args: string[], evaluator?: Evaluator) => void | Promise<void>>();
  private variables: Record<string, unknown>;

  constructor(variables: Record<string, unknown> = {}) {
    this.variables = variables;
    this.registerBuiltins();
  }

  /**
   * Register a command handler.
   */
  register(name: string, handler: (args: string[], evaluator?: Evaluator) => void | Promise<void>): void {
    this.handlers.set(name.toLowerCase(), handler);
  }

  /**
   * Execute a parsed command.
   */
  async execute(parsed: ParsedCommand, evaluator?: Evaluator): Promise<void> {
    const handler = this.handlers.get(parsed.name.toLowerCase());
    if (handler) {
      await handler(parsed.args, evaluator);
    } else {
      console.warn(`Unknown command: ${parsed.name}`);
    }
  }

  private registerBuiltins(): void {
    // <<set $var to expr>> or <<set $var = expr>> or <<set $var expr>>
    // Also compound assignment: <<set $var += expr>> (and -=, *=, /=, %=)
    this.register("set", (args, evaluator) => {
      if (!evaluator) return;
      if (args.length < 2) return;
      const varNameRaw = args[0];
      let exprParts = args.slice(1);
      if (exprParts[0] === "to") exprParts = exprParts.slice(1);
      if (exprParts[0] === "=") exprParts = exprParts.slice(1);
      const key = varNameRaw.startsWith("$") ? varNameRaw.slice(1) : varNameRaw;

      const compoundOp = exprParts[0];
      if (compoundOp === "+=" || compoundOp === "-=" || compoundOp === "*=" || compoundOp === "/=" || compoundOp === "%=") {
        const rhs = evaluator.evaluateExpression(exprParts.slice(1).join(" "));
        const current = this.variables[key];
        let value: unknown;
        if (compoundOp === "+=" && (typeof current === "string" || typeof rhs === "string")) {
          // String concat renders operands the upstream way (C# ToString:
          // booleans as "True"/"False").
          value = stringifyOperand(current) + stringifyOperand(rhs);
        } else {
          const left = Number(current ?? 0);
          const right = Number(rhs ?? 0);
          switch (compoundOp) {
            case "+=": value = left + right; break;
            case "-=": value = left - right; break;
            case "*=": value = left * right; break;
            case "/=": value = left / right; break;
            case "%=": value = left % right; break;
          }
        }
        this.variables[key] = value;
        evaluator.setVariable(key, value);
        return;
      }

      const expr = exprParts.join(" ");
      const value = evaluator.evaluateExpression(expr);

      // A script-level set of a smart variable is a compile error (YS0030),
      // so this write only ever lands on stored variables — or shadows a
      // smart variable when a host drives the storage directly (upstream
      // VariableKind.Stored precedence). No smart-to-regular downgrade:
      // the smart expression stays registered.
      this.variables[key] = value;
      evaluator.setVariable(key, value);
    });

    // <<declare $var = expr>>
    this.register("declare", (args, evaluator) => {
      if (!evaluator) return;
      if (args.length < 3) return; // name, '=', expr
      
      const varNameRaw = args[0];
      let exprParts = args.slice(1);
      if (exprParts[0] === "=") exprParts = exprParts.slice(1);
      // Upstream declare grammar: <<declare $var = expr (as TYPE)?>> — the
      // type postfix is compile metadata; evaluate the expression alone.
      const expr = exprParts.join(" ").replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/, "");
      
      const key = varNameRaw.startsWith("$") ? varNameRaw.slice(1) : varNameRaw;

      // Smart variables (ticket 42) were classified at compile time and
      // registered from `program.smartVariables` at start-up: read-only,
      // recomputed on every access, no initial stored value (upstream: they
      // are not in Program.InitialValues).
      if (evaluator.isSmartVariable(key)) return;

      // Regular variable - evaluate once and store. Enum member access
      // (Enum.Case, or compile-time-resolved shorthand) evaluates to the
      // case's raw value via the evaluator's enum registry.
      const value = evaluator.evaluateExpression(expr);
      
      this.variables[key] = value;
      evaluator.setVariable(key, value);
    });

    // <<stop>> - no-op, just a marker
    this.register("stop", () => {
      // Dialogue stop marker
    });
  }
}

