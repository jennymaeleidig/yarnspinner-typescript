// SPDX-License-Identifier: CC0-1.0
// Definitions → declarations: the host's Library surface described in the
// .ysls.json shape (upstream language-server command/function definitions)
// becomes the compile-time function signatures the type checker checks
// against. Files are read on the Node side (build time); inline objects
// behave identically — one conversion, one contract.

import { readFileSync } from "node:fs";
import type { ExternalDeclarations, FunctionSignature, DeclaredValueType } from "yarn-spinner-runner-ts";

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
    returns: hasReturn && entry.returns !== undefined ? toValueType(entry.returns) : "any",
  };
}

/**
 * Derive external declarations from a definitions list: strings are
 * .ysls.json file paths (read here, Node side), objects are the same shape
 * inline. All entries merge into one functions map — later entries win.
 */
export function toDeclarations(definitions: Array<string | YslsDefinitions>): ExternalDeclarations {
  const functions: Record<string, FunctionSignature> = {};
  for (const definition of definitions) {
    const ysls: YslsDefinitions =
      typeof definition === "string"
        ? (JSON.parse(readFileSync(definition, "utf8")) as YslsDefinitions)
        : definition;
    for (const command of ysls.commands ?? []) functions[command.yarnName] = toSignature(command, false);
    for (const fn of ysls.functions ?? []) functions[fn.yarnName] = toSignature(fn, true);
  }
  return { functions };
}
