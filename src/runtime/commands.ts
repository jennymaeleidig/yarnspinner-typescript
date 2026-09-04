// SPDX-License-Identifier: CC0-1.0
/**
 * Command utilities for Yarn Spinner commands: parsing (`parseCommand`),
 * the one classification of command names across the compile↔runtime seam
 * (`commandKind`), and state-statement execution
 * (`executeStateStatement`).
 * Commands like <<command_name arg1 arg2>> or <<command_name "arg with spaces">>
 *
 * The kind classification is the seam's single home (deepening-wave-3
 * ticket 03): both drivers that branch on command names dispatch on it.
 * Each driver keeps its own per-kind POLICY — this table is the lockstep
 * obligation, stated once:
 *
 * | kind        | compiler (`lowerCommand`)          | VM (`runCommand`)                     |
 * |-------------|------------------------------------|---------------------------------------|
 * | set         | lower to bytecode (fallback: raw)  | execute via the state-statement module|
 * | declare     | hoist to initialValues (no instr.) | execute via the state-statement module|
 * | stop        | lower to the `stop` op             | unreachable (dedicated op)            |
 * | return      | lower to the `return` op           | unreachable (dedicated op)            |
 * | call        | keep raw (host-delivered shape)    | execute: invoke, discard the result   |
 * | setSaliency | unreachable (compiler-generated)   | execute: switch the saliency strategy |
 * | host        | keep raw                           | deliver as a Command event            |
 *
 * The deliberate asymmetry on `call` (compiler keeps it raw; the VM
 * executes it internally) is upstream's shape, made explicit here instead
 * of hidden across two name lists.
 */

import type { ExpressionEvaluator } from "./evaluator.js";
import { applyBinaryOp } from "./operands.js";
import { compoundOperatorToStackOp, parseStateStatement } from "../parse/stateStatement.js";
import type { VariableStorage } from "./variableStorage.js";

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

/** The one classification of a command's name (case-insensitive), stated
 * once for both drivers that branch on it — the compiler's `lowerCommand`
 * and the VM's `runCommand` (see the module header's policy table for each
 * driver's per-kind obligation). */
export type CommandKind = "set" | "declare" | "call" | "setSaliency" | "stop" | "return" | "host";

export function commandKind(name: string): CommandKind {
  switch (name.toLowerCase()) {
    case "set":
      return "set";
    case "declare":
      return "declare";
    case "call":
      return "call";
    // Upstream's strategy-switch command (Try Yarn Spinner's built-in
    // `<<set_saliency first|random|best|...>>`) — compiler-generated, but
    // classified so the VM's arm has a kind to dispatch on.
    case "set_saliency":
      return "setSaliency";
    case "stop":
      return "stop";
    case "return":
      return "return";
    default:
      return "host";
  }
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

/** Collect-don't-throw (coding standards §3): evaluate one statement
 * expression through the evaluator's out-of-band failure signal — a
 * failing evaluation is a runtime diagnostic naming the statement, not a
 * crash (the one failure-policy statement for all three statement
 * branches). */
function evaluateStatementValue(
  evaluator: ExpressionEvaluator,
  expression: string,
  content: string,
  logError: (message: string) => void,
): { ok: true; value: unknown } | { ok: false } {
  const result = evaluator.tryEvaluateExpression(expression);
  if (!result.ok) {
    logError(`Failed to evaluate expression "${expression}" in statement "${content}"`);
  }
  return result;
}

/**
 * Execute a state statement's effect on variable storage (`<<set>>`/
 * `<<declare>>` grammar: `set $var (to|=) expr`, compound assignment
 * operators, `declare $var = expr (as TYPE)?`).
 *
 * The one execution driver (the instruction-stream VM): `<<set>>`
 * expressions compile to bytecode, but an uncompilable `<<set>>` keeps its
 * authored command (the compiler's documented fallback) and lands here —
 * the runtime's error handling applies unchanged. The statement's shape
 * comes from the shared state-statement grammar
 * (src/parse/stateStatement.ts) — the same parse the type checker and the
 * compiler's lowering consume.
 *
 * Collect-don't-throw (coding standards §3): a failing statement is a
 * runtime diagnostic, not a crash.
 */
export function executeStateStatement(host: StateStatementHost, content: string): void {
  const { variables, evaluator, logError } = host;
  const setVariable = (name: string, value: unknown): void => {
    variables.set(name, value);
    evaluator.setVariable(name, value);
  };
  try {
    // The shared state-statement grammar (src/parse/stateStatement.ts) —
    // the same parse the type checker and compiler's lowering consume, so
    // the fallback path agrees with them structurally.
    const statement = parseStateStatement(content);
    if (!statement) return;
    if (statement.kind === "set") {
      const { name: key, compoundOp, expression } = statement;
      if (compoundOp) {
        // The compound assignment applies the base operator through the
        // operand-semantics module — the same add/concat rule the VM's add
        // op applies (one statement, not a third copy).
        const rhs = evaluateStatementValue(evaluator, expression, content, logError);
        if (!rhs.ok) return;
        const value = applyBinaryOp(compoundOperatorToStackOp(compoundOp), variables.get(key), rhs.value);
        setVariable(key, value);
        return;
      }

      // The out-of-band failure signal distinguishes "evaluation failed"
      // from a legitimate `undefined` (a void host function): a failing
      // expression logs a diagnostic and skips the write instead of
      // silently clobbering a prior value (deepening-wave-3 ticket 01).
      const result = evaluateStatementValue(evaluator, expression, content, logError);
      if (!result.ok) return;
      const value = result.value;
      // A script-level set of a smart variable is a compile error (YS0030),
      // so this write only ever lands on stored variables — or shadows a
      // smart variable when a host drives the storage directly (upstream
      // VariableKind.Stored precedence). No smart-to-regular downgrade:
      // the smart expression stays registered.
      setVariable(key, value);
      return;
    }
    // declare: the ` as TYPE` postfix is compile metadata; the module has
    // already stripped it from the expression.
    {
      const { name: key, expression: expr } = statement;

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
      // case's raw value via the evaluator's enum registry. A failing
      // evaluation logs a diagnostic and skips the write (the same
      // out-of-band signal the set branch consumes — declares are
      // fallback-path initializers, and a failed initializer must not
      // write `undefined` over a host-seeded value either).
      const declared = evaluateStatementValue(evaluator, expr, content, logError);
      if (!declared.ok) return;
      setVariable(key, declared.value);
    }
  } catch (e) {
    // collect-don't-throw: a failing state statement is a runtime
    // diagnostic, not a crash.
    logError(`Failed to execute statement "${content}": ${e instanceof Error ? e.message : String(e)}`);
  }
}
