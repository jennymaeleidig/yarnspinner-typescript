// SPDX-License-Identifier: CC0-1.0
/**
 * Declaration-file generation (upstream `YarnSpinner.Compiler.Utility
 * .GenerateYarnFileWithDeclarations`): turns a compilation's variable
 * declarations back into a `.yarn` node source that declares them — the
 * write side of the declarations workflow (tools read declarations with a
 * type-check compile, let the user edit, and write the file back out).
 *
 * The output shape is upstream's: `title:`, then `tags:` (when given),
 * then the extra headers in insertion order, then `---`, then one
 * `<<declare $var = value>>` per declaration with its `///` description
 * above it (a blank line inserted above every description after the
 * first), then `===`.
 */

// Citation: Yarn Spinner Pty Ltd, Secret Lab Pty Ltd, and Yarn Spinner
// contributors — YarnSpinner (v3.2.2, commit 5b3a4ff2d24e4f727e3f90fee5d8ce637474c305) [MIT]
// Source: https://github.com/YarnSpinnerTool/YarnSpinner — YarnSpinner.Compiler/Utility.cs
//         (Utility.GenerateYarnFileWithDeclarations)
// Accessed: 2026-09-04
// Modified by yarn-spinner-runner-ts on 2026-09-04 — ported to TypeScript over
// this project's `VariableDeclaration` shape (bare variable names; upstream
// `Declaration.Name` carries the `$` sigil, so the generator adds it).

import type { VariableDeclaration } from "./typeCheck.js";

const DEFAULT_TITLE = "Program";

/**
 * Generate a Yarn script that contains a node that declares variables.
 *
 * Function-typed declarations cannot appear here (they can't be declared in
 * Yarn script — the port's declarations surface carries no function types);
 * a declaration whose type is not `number`/`string`/`bool` (for example an
 * enum-typed one) throws, matching upstream's
 * `ArgumentOutOfRangeException`.
 */
export function generateYarnFileWithDeclarations(
  declarations: readonly VariableDeclaration[],
  title: string = DEFAULT_TITLE,
  tags?: readonly string[],
  headers?: Readonly<Record<string, string>>,
): string {
  const lines: string[] = [];

  lines.push(`title: ${title}`);

  if (tags != null) {
    lines.push(`tags: ${tags.join(" ")}`);
  }

  if (headers != null) {
    for (const [key, value] of Object.entries(headers)) {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");

  let count = 0;

  for (const decl of declarations) {
    if (decl.description) {
      if (count > 0) {
        // Insert a blank line above this comment, for readability
        lines.push("");
      }
      lines.push(`/// ${decl.description}`);
    }

    let line = `<<declare $${decl.name} = `;

    if (decl.type === "number") {
      // Upstream appends the raw value (C# `Append(null)` writes nothing —
      // an absent number default renders as an empty operand, verbatim).
      line += decl.defaultValue != null ? String(decl.defaultValue) : "";
    } else if (decl.type === "string") {
      line += `"${typeof decl.defaultValue === "string" ? decl.defaultValue : ""}"`;
    } else if (decl.type === "bool") {
      line += decl.defaultValue === true ? "true" : "false";
    } else {
      throw new Error(
        `Declaration $${decl.name}'s type must not be ${decl.type}.`,
      );
    }

    lines.push(`${line}>>`);
    count += 1;
  }

  lines.push("===");

  return `${lines.join("\n")}\n`;
}
