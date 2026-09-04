/**
 * Loader for the vendored 3.2.2 diagnostic-definition markdown
 * (`test/fixtures/upstream/YarnSpinner/Diagnostics/Definitions/`, pinned per
 * the corpus PROVENANCE.md). The per-code files are the authoritative YS00xx
 * registry (tickets 09/10 — the docs site is stale on severities); ticket
 * 65's phase-3 golden loop compiles each registered code's `examples`
 * scripts and pins the exact code.
 *
 * The frontmatter is parsed as the narrow YAML subset the definitions use —
 * scalars, inline arrays, and the `- script: |` block scalars — not a full
 * YAML parser.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM_TESTS_DIR } from "./fixtures.js";

export const DIAGNOSTIC_DEFINITIONS_DIR = join(
  UPSTREAM_TESTS_DIR,
  "..",
  "Diagnostics",
  "Definitions",
);

export interface DiagnosticDefinition {
  code: string;
  name: string;
  /** `generated_in:` value, when present (e.g. `languageserver`). */
  generatedIn?: string;
  defaultSeverity?: string;
  /** Each `examples: - script: |` block, dedented. */
  scripts: string[];
}

export function listDiagnosticDefinitionFiles(): string[] {
  return readdirSync(DIAGNOSTIC_DEFINITIONS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/**
 * Parse one definition file. The block scalars are indented uniformly under
 * `- script: |`; a block ends at the frontmatter's closing `---` or the next
 * `- script:` at (or above) the item's indent.
 */
export function parseDiagnosticDefinition(source: string, fileName: string): DiagnosticDefinition {
  const lines = source.split("\n");
  // Frontmatter: between the leading `---` and the next `---` line.
  const start = lines.indexOf("---");
  const end = lines.indexOf("---", start + 1);
  if (start !== 0 || end === -1) {
    throw new Error(`${fileName}: no frontmatter block`);
  }
  const front = lines.slice(start + 1, end);
  const scalar = (key: string): string | undefined => {
    const line = front.find((l) => new RegExp(`^${key}:`).test(l));
    const value = line?.replace(new RegExp(`^${key}:\\s*`), "").trim().replace(/^["']|["']$/g, "");
    return value || undefined;
  };
  const code = scalar("code");
  const name = scalar("name");
  if (!code || !name) throw new Error(`${fileName}: missing code/name`);

  // examples: list of `- script: |` block scalars.
  const scripts: string[] = [];
  const examplesAt = front.findIndex((l) => /^examples:\s*$/.test(l));
  if (examplesAt !== -1) {
    let i = examplesAt + 1;
    while (i < front.length) {
      const item = front[i];
      const itemMatch = /^(\s*)- script: \|\s*$/.exec(item);
      if (!itemMatch) {
        if (item.trim() !== "") break;
        i++;
        continue;
      }
      const itemIndent = itemMatch[1].length;
      i++;
      const block: string[] = [];
      while (i < front.length) {
        const line = front[i];
        if (line.trim() === "") {
          block.push("");
          i++;
          continue;
        }
        const indent = line.length - line.trimStart().length;
        if (indent <= itemIndent || /^\s*- script:/.test(line)) break;
        block.push(line);
        i++;
      }
      while (block.length > 0 && block[block.length - 1] === "") block.pop();
      // Dedent by the block's minimal non-empty indent.
      const base = Math.min(
        ...block.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length),
      );
      scripts.push(block.map((l) => l.slice(base)).join("\n"));
    }
  }

  return {
    code,
    name,
    ...(scalar("generated_in") ? { generatedIn: scalar("generated_in") } : {}),
    ...(scalar("defaultSeverity") ? { defaultSeverity: scalar("defaultSeverity") } : {}),
    scripts,
  };
}

/** Every vendored diagnostic definition, keyed in file order. */
export function loadDiagnosticDefinitions(): DiagnosticDefinition[] {
  return listDiagnosticDefinitionFiles().map((f) =>
    parseDiagnosticDefinition(readFileSync(join(DIAGNOSTIC_DEFINITIONS_DIR, f), "utf8"), f),
  );
}
