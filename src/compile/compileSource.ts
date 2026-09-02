/**
 * The single-file compile seam (spec ticket 23): parse → validate → compile,
 * returning the program together with its diagnostics instead of throwing.
 *
 * Collect by default (coding standards §3): syntax errors and validation
 * failures come back as diagnostics; `strict: true` throws on the first
 * error. Codes and severities come from the vendored 3.2.2 registry via
 * ./diagnostics.js.
 *
 * The validations here are the ones that fall out of the existing front-end
 * (node structure, group membership, jump targets). The language-level
 * validations owed by the first-tranche YS codes (set/declare value checks,
 * enum typing, smart-variable cycles, shadow lines) land with tickets 40–42
 * and will join this pass.
 */

import { parseYarn, ParseError } from "../parse/parser.js";
import type { YarnDocument, YarnNode, Statement } from "../model/ast.js";
import { compile } from "./compiler.js";
import type { IRProgram } from "./ir.js";
import { emitProgram, LoweringError } from "./emit.js";
import type { Program } from "./program.js";
import { makeDiagnostic, hasErrors } from "./diagnostics.js";
import type { Diagnostic, YarnRange } from "./diagnostics.js";
import { typeCheck } from "./typeCheck.js";
import type { ExternalDeclarations, VariableDeclaration } from "./typeCheck.js";
import type { EnumType } from "./enums.js";

export interface CompileSourceOptions {
  /** Source file name recorded on diagnostics (multi-file surface: ticket 49). */
  file?: string;
  /** Throw on the first error diagnostic instead of collecting. */
  strict?: boolean;
  generateOnceIds?: (ctx: { node: string; index: number }) => string;
  /**
   * Host-provided external declarations feeding the type checker (ticket 41):
   * enum types (EnumTypeBuilder outputs) and function signatures for
   * compile-time argument checking.
   */
  declarations?: ExternalDeclarations;
}

export interface CompileSourceResult {
  program: IRProgram | null;
  /**
   * The instruction-stream program (ADR 0001, ADR 0003): the versioned JSON
   * bytecode artifact with expressions compiled and jump labels resolved.
   * Inert to the current tree-IR runtime; the VM (tickets 45–46) consumes
   * it behind the same public API. `null` when parsing failed.
   */
  bytecode: Program | null;
  diagnostics: Diagnostic[];
  /** `<<declare>>`d variables (upstream CompilationResult.Declarations). */
  declarations: VariableDeclaration[];
  /** Enum types defined by the script or the host (upstream user-defined types). */
  userDefinedTypes: EnumType[];
}

export function compileSource(source: string, opts: CompileSourceOptions = {}): CompileSourceResult {
  const diagnostics: Diagnostic[] = [];

  let doc: YarnDocument;
  try {
    doc = parseYarn(source);
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    const diagnostic = makeDiagnostic("YS0005", `Syntax error: ${e.message}`, {
      file: opts.file,
      range: e.range as YarnRange | undefined,
    });
    if (opts.strict) throw new Error(`${diagnostic.code}: ${diagnostic.message}`);
    return { program: null, bytecode: null, diagnostics: [diagnostic], declarations: [], userDefinedTypes: [] };
  }

  validate(doc, diagnostics, opts.file);

  // Enum-aware type checking (ticket 41): validates enum declarations and
  // member access, enforces the same-enum comparison restriction, resolves
  // `.Case` shorthand in place, and collects declarations.
  const checked = typeCheck(doc, { declarations: opts.declarations }, (d) => diagnostics.push(d));

  const program = compile(doc, { generateOnceIds: opts.generateOnceIds, enumTypes: checked.enumTypes });
  validateJumps(program, doc, diagnostics, opts.file);

  // The instruction-stream artifact (ADR 0001/0003), emitted alongside the
  // tree IR. Inert until the VM tickets (45–46) consume it.
  let bytecode: Program | null = null;
  try {
    bytecode = emitProgram(program);
  } catch (e) {
    // Collect-don't-throw (coding standards §3): a lowering failure must
    // not escape the seam. `LoweringError` guards a lowering invariant that
    // is unbreakable by construction (every label reference is created
    // alongside its label in the same node's lowering), so this branch —
    // and the missing bytecode — would mean a compiler bug, not user
    // content; the golden suite pins the artifact either way.
    if (!(e instanceof LoweringError)) throw e;
  }

  if (opts.strict) {
    const firstError = diagnostics.find((d) => d.severity === "error");
    if (firstError) throw new Error(`${firstError.code}: ${firstError.message}`);
  }
  return {
    program,
    bytecode,
    diagnostics,
    declarations: checked.declarations,
    userDefinedTypes: [...checked.enumTypes.values()],
  };
}

/** Node-structure validations derivable from the parsed document. */
function validate(doc: YarnDocument, diagnostics: Diagnostic[], file?: string): void {
  const byTitle = new Map<string, YarnNode[]>();
  for (const node of doc.nodes) {
    const list = byTitle.get(node.title) ?? [];
    list.push(node);
    byTitle.set(node.title, list);
  }

  for (const node of doc.nodes) {
    if (node.duplicateTitleHeaders) {
      diagnostics.push(
        makeDiagnostic(
          "YS0052",
          `Node ${JSON.stringify(node.title)} has more than one title header; keeping the first`,
          { file },
        ),
      );
    }
    if (node.body.length === 0) {
      diagnostics.push(makeDiagnostic("YS0033", `Node "${node.title}" is empty`, { file }));
    }
  }

  for (const [title, nodes] of byTitle) {
    if (nodes.length > 1) {
      // Duplicated titles form a node group (YS0011's own definition: not
      // emitted when members share a title but have different when: clauses).
      // Every member needs a when: clause (YS0031) and subtitles must be
      // unique within the group (YS0032).
      const membersWithoutWhen = nodes.filter((n) => !n.when || n.when.length === 0);
      if (membersWithoutWhen.length > 0) {
        diagnostics.push(makeDiagnostic("YS0011", `Duplicate node title: '${title}'`, { file }));
        membersWithoutWhen.forEach(() => {
          diagnostics.push(
            makeDiagnostic("YS0031", `Node '${title}' is part of a node group but has no when: clause`, { file }),
          );
        });
      }
      const subtitles = new Map<string, number>();
      for (const node of nodes) {
        const subtitle = node.headers["subtitle"]?.trim();
        if (!subtitle) continue;
        subtitles.set(subtitle, (subtitles.get(subtitle) ?? 0) + 1);
      }
      for (const [subtitle, count] of subtitles) {
        if (count > 1) {
          diagnostics.push(
            makeDiagnostic("YS0032", `Node group ${title} has subtitle ${subtitle} ${count} times`, { file }),
          );
        }
      }
    }
  }
}

/** Collect every statically-known jump/detour target from a statement tree. */
function collectTargets(stmts: Statement[], into: string[]): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Jump":
      case "Detour":
        into.push((s as { target: string }).target);
        break;
      case "If":
        for (const b of (s as { branches: Array<{ body: Statement[] }> }).branches) collectTargets(b.body, into);
        break;
      case "Once":
        collectTargets((s as { body: Statement[] }).body, into);
        break;
      case "OptionGroup":
        for (const o of (s as { options: Array<{ body: Statement[] }> }).options) collectTargets(o.body, into);
        break;
    }
  }
}

/** Jump/detour targets must resolve to a node (upstream YS0012, warning). */
function validateJumps(
  program: IRProgram,
  doc: YarnDocument,
  diagnostics: Diagnostic[],
  file?: string,
): void {
  const targets: string[] = [];
  for (const node of doc.nodes) collectTargets(node.body, targets);
  for (const target of targets) {
    // Braced targets ({expr}) resolve at runtime — nothing to check statically.
    if (target.startsWith("{") || program.nodes[target] !== undefined) continue;
    diagnostics.push(makeDiagnostic("YS0012", `Jump to undefined node '${target}'`, { file }));
  }
}

export { hasErrors };
