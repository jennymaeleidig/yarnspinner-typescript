// SPDX-License-Identifier: CC0-1.0
// Definitions → declarations: the host's Library surface described in the
// .ysls.json shape (upstream language-server command/function definitions)
// becomes the compile-time function signatures the type checker checks
// against. Files are read on the Node side (build time); inline objects
// behave identically — one conversion, one contract.

import { readFileSync } from "node:fs";
import type {
  ExternalDeclarations,
  FunctionSignature,
  DeclaredValueType,
} from "yarnspinner-typescript";

/** The .ysls.json shape this converter consumes (upstream schema v1). */
interface YslsParameter {
  name?: string;
  type: string;
}
interface YslsEntry {
  yarnName: string;
  parameters?: YslsParameter[];
  returns?: string;
}
export interface YslsDefinitions {
  version?: number;
  commands?: YslsEntry[];
  functions?: YslsEntry[];
}

/** Map a .ysls type name onto the compiler's declared-value-type vocabulary. */
function toValueType(type: string): DeclaredValueType {
  switch (type) {
    case "string":
    case "number":
    case "bool":
      return type;
    default:
      // Unknown .ysls type names degrade to string — a signature that at
      // least arity-checks; the language server's richer types have no
      // compile-time meaning here.
      return "string";
  }
}

function toSignature(entry: YslsEntry, hasReturn: boolean): FunctionSignature {
  return {
    params: (entry.parameters ?? []).map((p) => toValueType(p.type)),
    // Commands return nothing ("any" — no return-type constraint); a
    // function without a declared return is likewise unconstrained.
    returns:
      hasReturn && entry.returns !== undefined
        ? toValueType(entry.returns)
        : "any",
  };
}

/**
 * Read one .ysls.json file into the definitions shape. A missing or malformed
 * file is an error naming the file — the plugin's error contract — instead of
 * JSON.parse's raw SyntaxError (which never mentions what it was parsing).
 */
function readYslsFile(path: string): YslsDefinitions {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(
      `Cannot read definitions file ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    return JSON.parse(text) as YslsDefinitions;
  } catch (e) {
    throw new Error(
      `${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Derive external declarations from a definitions list: strings are
 * .ysls.json file paths (read here, Node side), objects are the same shape
 * inline. All entries merge into one functions map — later entries win.
 */
export function toDeclarations(
  definitions: Array<string | YslsDefinitions>,
): ExternalDeclarations {
  const functions: Record<string, FunctionSignature> = {};
  for (const definition of definitions) {
    const ysls: YslsDefinitions =
      typeof definition === "string" ? readYslsFile(definition) : definition;
    for (const command of ysls.commands ?? [])
      functions[command.yarnName] = toSignature(command, false);
    for (const fn of ysls.functions ?? [])
      functions[fn.yarnName] = toSignature(fn, true);
  }
  return { functions };
}
