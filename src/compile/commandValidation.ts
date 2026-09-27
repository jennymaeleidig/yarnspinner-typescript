// SPDX-License-Identifier: CC0-1.0
/**
 * Opt-in command validation: walk every `<<command ...>>` and check its name
 * and parameter count against the built-ins plus the project's declared
 * `.ysls.json` commands.
 *
 * Upstream marks both codes `generated_in: languageserver` and
 * `minimumSeverity: none`: its compiler never emits them, so this pass only
 * runs when `CompileOptions.validateCommands` is set. Without it, compile
 * output and diagnostics are byte-identical to before.
 *
 * Collect-don't-throw (coding standard §3): every problem is a diagnostic.
 * Interpolated names (`<<{ $cmd }>>`) are left alone — their command is only
 * known at runtime.
 */

import { parseCommand } from "../runtime/commands.js";
import type { Command, YarnDocument, YarnNode } from "../model/ast.js";
import { walkStatements } from "../model/walk.js";
import { makeDiagnostic } from "./diagnostics.js";
import type { Diagnostic } from "./diagnostics.js";
import type { CommandDefinition } from "./commandDefinitions.js";

/**
 * Built-in command names (case-insensitive) — anything else is unknown
 * (YS0060) unless a `.ysls.json` declares it. Some built-ins (`if`/`once`
 * … ) are consumed structurally by the parser and never reach the `Command`
 * AST node; they are listed anyway so a malformed standalone form is
 * recognised rather than mislabelled "unknown".
 */
export const BUILTIN_COMMAND_NAMES: readonly string[] = [
  "set",
  "declare",
  "call",
  "set_saliency",
  "stop",
  "return",
  "wait",
  "jump",
  "detour",
  "if",
  "elseif",
  "else",
  "endif",
  "once",
  "endonce",
];

/**
 * Parameter count for the built-ins where a count is meaningful and safe to
 * check. `set`/`declare`/`call` take expression clauses whose token split is
 * not a parameter list, so they are recognised by name but not counted.
 */
const BUILTIN_COMMAND_ARITY: Record<string, number> = {
  stop: 0,
  return: 0,
  wait: 1,
  jump: 1,
  detour: 1,
};

/** How many arguments a declared command accepts. */
interface Arity {
  min: number;
  /** `Infinity` for a trailing `isParamsArray`. */
  max: number;
}

function commandArity(parameters: CommandDefinition["parameters"]): Arity {
  const variadic = parameters.some((p) => p.isParamsArray);
  const required = parameters.filter(
    (p) => p.defaultValue === undefined && !p.isParamsArray,
  ).length;
  return { min: required, max: variadic ? Infinity : parameters.length };
}

/** The range of the command's first word, from the `<<` token position. */
function commandNameRange(command: Command, name: string): Diagnostic["range"] {
  const line = (command.lineNumber ?? 1) - 1;
  const open = (command.column ?? 1) - 1;
  // `content` is the trimmed inner text; skip any leading whitespace it lost.
  const offset = command.content.length - command.content.trimStart().length;
  const start = open + 2 + offset;
  return {
    startLine: line,
    startCol: start,
    endLine: line,
    endCol: start + name.length,
  };
}

/**
 * Validate every command in `docs` against `declared`. `push` receives each
 * YS0060/YS0061 diagnostic. Pure.
 */
export function validateCommands(
  docs: Array<{ name: string; doc: YarnDocument }>,
  declared: CommandDefinition[],
  push: (d: Diagnostic) => void,
): void {
  const known = new Set(BUILTIN_COMMAND_NAMES.map((n) => n.toLowerCase()));
  const byName = new Map<string, CommandDefinition>();
  for (const c of declared) byName.set(c.yarnName, c);

  const check = (command: Command, node: YarnNode): void => {
    let parsed;
    try {
      parsed = parseCommand(command.content);
    } catch {
      return; // the parser already reports malformed command text
    }
    const name = parsed.name;
    // Interpolated names resolve at runtime only.
    if (name.includes("{")) return;
    const range = commandNameRange(command, name);
    const file = node.sourceFile;

    const declaredCommand = byName.get(name);
    if (declaredCommand) {
      const { min, max } = commandArity(declaredCommand.parameters);
      const count = parsed.args.length;
      if (count < min || count > max) {
        const expected = count < min ? min : max;
        push(
          makeDiagnostic(
            "YS0061",
            `Command ${name} was called with ${count} parameters, but expected ${expected}`,
            { file, range },
          ),
        );
      }
      return;
    }

    if (known.has(name.toLowerCase())) {
      const arity = BUILTIN_COMMAND_ARITY[name.toLowerCase()];
      if (arity !== undefined && parsed.args.length !== arity) {
        push(
          makeDiagnostic(
            "YS0061",
            `Command ${name} was called with ${parsed.args.length} parameters, but expected ${arity}`,
            { file, range },
          ),
        );
      }
      return;
    }

    push(makeDiagnostic("YS0060", `Unknown command: ${name}`, { file, range }));
  };

  for (const { doc } of docs) {
    for (const node of doc.nodes) {
      walkStatements(node.body, {
        onStatement: (s) => {
          if (s.type === "Command") check(s, node);
        },
      });
    }
  }
}
