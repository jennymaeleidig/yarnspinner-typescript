/**
 * The compile seam (spec ticket 23): parse → validate → type-check →
 * compile, returning the program together with its diagnostics instead of
 * throwing.
 *
 * Collect by default (coding standards §3): syntax errors and validation
 * failures come back as diagnostics; `strict: true` throws on the first
 * error. Codes and severities come from the vendored 3.2.2 registry via
 * ./diagnostics.js.
 *
 * Since ticket 46 the program is the instruction-stream artifact (ADR
 * 0001/0003) — the tree IR is retired and the VM executes this artifact
 * behind the public runtime API. The validations here are the ones that
 * fall out of the front-end (node structure, group membership, jump
 * targets); the language-level YS-code validations live in the type
 * checking pass.
 */

import { parseYarn, ParseError } from "../parse/parser.js";
import type { YarnDocument, YarnNode, Statement } from "../model/ast.js";
import { compile, LoweringError } from "./compiler.js";
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
  /**
   * The compiled, serializable program (the glossary's Program): the
   * instruction-stream artifact (ADR 0001/0003) the runtime executes.
   * `null` when parsing failed.
   */
  program: Program | null;
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
    return { program: null, diagnostics: [diagnostic], declarations: [], userDefinedTypes: [] };
  }

  validate(doc, diagnostics, opts.file);

  // Enum-aware type checking (ticket 41): validates enum declarations and
  // member access, enforces the same-enum comparison restriction, resolves
  // `.Case` shorthand in place, and collects declarations.
  const checked = typeCheck(doc, { declarations: opts.declarations }, (d) => diagnostics.push(d));

  // The instruction-stream artifact (ADR 0001/0003). A LoweringError guards
  // a lowering invariant that is unbreakable by construction (every label
  // reference is created alongside its label in the same node's lowering),
  // so catching one here means a compiler bug, not user content — reported
  // as a diagnostic, with no program (coding standards §3).
  let program: Program | null = null;
  try {
    program = compile(doc, { generateOnceIds: opts.generateOnceIds, enumTypes: checked.enumTypes });
  } catch (e) {
    if (!(e instanceof LoweringError)) throw e;
    diagnostics.push(makeDiagnostic("YS0005", `Internal lowering failure: ${e.message}`, { file: opts.file }));
  }

  if (program) {
    validateJumps(program, doc, diagnostics, opts.file);
  }

  if (opts.strict) {
    const firstError = diagnostics.find((d) => d.severity === "error");
    if (firstError) throw new Error(`${firstError.code}: ${firstError.message}`);
  }
  return {
    program,
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
        into.push(s.target);
        break;
      case "If":
        for (const b of s.branches) collectTargets(b.body, into);
        break;
      case "Once":
        collectTargets(s.body, into);
        if (s.elseBody) collectTargets(s.elseBody, into);
        break;
      case "OptionGroup":
        for (const o of s.options) collectTargets(o.body, into);
        break;
    }
  }
}

/** Jump/detour targets must resolve to a node (upstream YS0012, warning). */
function validateJumps(
  program: Program,
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
