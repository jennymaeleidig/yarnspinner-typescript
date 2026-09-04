// SPDX-License-Identifier: CC0-1.0
/**
 * Command utilities for Yarn Spinner commands: parsing (`parseCommand`)
 * and state-statement execution (`executeStateStatement`).
 * Commands like <<command_name arg1 arg2>> or <<command_name "arg with spaces">>
 */

import type { ExpressionEvaluator } from "./evaluator.js";
import { applyBinaryOp, type BinaryOperator } from "./operands.js";
import type { VariableStorage } from "./variableStorage.js";

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

/** What a state-statement executor needs from its driver: the storage, an evaluator over it, and the error sink. */
export interface StateStatementHost {
  /** The variable storage (generated keys included). */
  variables: VariableStorage;
  evaluator: ExpressionEvaluator;
  logError(message: string): void;
}

/** Strip one layer of surrounding quotes from a command parameter. */
export function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Execute a state statement's effect on variable storage (`<<set>>`/
 * `<<declare>>` grammar: `set $var (to|=) expr`, compound assignment
 * operators, `declare $var = expr (as TYPE)?`).
 *
 * The one execution driver (the instruction-stream VM): `<<set>>`
 * expressions compile to bytecode, but an uncompilable `<<set>>` keeps its
 * authored command (the compiler's documented fallback) and lands here —
 * the runtime's error handling applies unchanged.
 *
 * Collect-don't-throw (coding standards §3): a failing statement is a
 * runtime diagnostic, not a crash.
 */
export function executeStateStatement(host: StateStatementHost, content: string, parsed?: ParsedCommand): void {
  const { variables, evaluator, logError } = host;
  const setVariable = (name: string, value: unknown): void => {
    variables.set(name, value);
    evaluator.setVariable(name, value);
  };
  try {
    const command = parsed ?? parseCommand(content);
    const name = command.name.toLowerCase();
    const args = command.args;
    if (name === "set") {
      if (args.length < 2) return;
      const varNameRaw = args[0];
      let exprParts = args.slice(1);
      if (exprParts[0] === "to") exprParts = exprParts.slice(1);
      if (exprParts[0] === "=") exprParts = exprParts.slice(1);
      const key = varNameRaw.startsWith("$") ? varNameRaw.slice(1) : varNameRaw;

      const compoundOp = exprParts[0];
      if (compoundOp === "+=" || compoundOp === "-=" || compoundOp === "*=" || compoundOp === "/=" || compoundOp === "%=") {
        // The compound assignment applies the base operator through the
        // operand-semantics module — the same add/concat rule the VM's add
        // op applies (one statement, not a third copy).
        const op: BinaryOperator =
          compoundOp === "+=" ? "add"
          : compoundOp === "-=" ? "subtract"
          : compoundOp === "*=" ? "multiply"
          : compoundOp === "/=" ? "divide"
          : "modulo";
        const rhs = evaluator.evaluateExpression(exprParts.slice(1).join(" "));
        const value = applyBinaryOp(op, variables.get(key), rhs);
        setVariable(key, value);
        return;
      }

      const value = evaluator.evaluateExpression(exprParts.join(" "));
      // A script-level set of a smart variable is a compile error (YS0030),
      // so this write only ever lands on stored variables — or shadows a
      // smart variable when a host drives the storage directly (upstream
      // VariableKind.Stored precedence). No smart-to-regular downgrade:
      // the smart expression stays registered.
      setVariable(key, value);
      return;
    }
    if (name === "declare") {
      if (args.length < 3) return; // name, '=', expr
      const varNameRaw = args[0];
      let exprParts = args.slice(1);
      if (exprParts[0] === "=") exprParts = exprParts.slice(1);
      // Upstream declare grammar: <<declare $var = expr (as TYPE)?>> — the
      // type postfix is compile metadata; evaluate the expression alone.
      const expr = exprParts.join(" ").replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/, "");
      const key = varNameRaw.startsWith("$") ? varNameRaw.slice(1) : varNameRaw;

      // Smart variables were classified at compile time and
      // registered from the program's smart variables at start-up: read-only,
      // recomputed on every access, no initial stored value (upstream:
      // they are not in Program.InitialValues).
      if (evaluator.isSmartVariable(key)) return;

      // A declare is an initial value (upstream: Program.InitialValues,
      // seeded at SetProgram time): it initializes, it never re-assigns.
      // Upstream compiles declares to no instruction at all; this handling
      // stays for the compiler's fallback paths, but its effect must not
      // clobber storage that already
      // holds a value (host writes win — upstream VariableKind.Stored
      // precedence).
      if (variables.has(key)) return;

      // Regular variable - evaluate once and store. Enum member access
      // (Enum.Case, or compile-time-resolved shorthand) evaluates to the
      // case's raw value via the evaluator's enum registry.
      const value = evaluator.evaluateExpression(expr);
      setVariable(key, value);
    }
  } catch (e) {
    // collect-don't-throw: a failing state statement is a runtime
    // diagnostic, not a crash.
    logError(`Failed to execute statement "${content}": ${e instanceof Error ? e.message : String(e)}`);
  }
}
