// SPDX-License-Identifier: CC0-1.0
/**
 * The compile seam: parse → validate → type-check →
 * compile, returning the program together with its diagnostics instead of
 * throwing.
 *
 * Multi-file surface (upstream `CompilationJob`): `compile()`
 * accepts `{ name, source }` entries — no globs or filesystem I/O in the
 * library (coding standards §2). External declarations (variables,
 * functions, enums; conflicts produce YS diagnostics — YS0039/YS0040), a
 * compile-time `Library` for signature checking, and the four compilation
 * modes:
 *
 * - `full` — program, string table, declarations, file tags, everything;
 * - `stringsOnly` — stops right after string-table registration: string
 *   table + `containsImplicitStringTags` + diagnostics; no program, no
 *   declarations (upstream `Type.StringsOnly`);
 * - `typeCheckOnly` — declarations, user-defined types, file tags, and the
 *   string table (upstream 3.2.1+ behavior); no program. `declarationsOnly`
 *   is the obsolete upstream name, accepted as an alias;
 * - `full` with errors still returns the program (upstream nulls it; this
 *   fork keeps the lowering result observable — collect-don't-throw, §3).
 *
 * The string table (the full upstream contract) is assigned in
 * one pass over all files in the upstream registration order — files in
 * input order, nodes in document order, statements depth-first — so the
 * IDs match upstream's CRC32(file + node + count) scheme exactly, and the
 * implicit IDs are written back into the AST so a full compile's program
 * and its table agree on every line's ID. Shadow lines are validated in
 * the same pass (YS0042/43/44); invalid shadow text strips to null.
 *
 * Collect by default (coding standards §3): syntax errors and validation
 * failures come back as diagnostics; `strict: true` throws on the first
 * error. Codes and severities come from the upstream 3.2.2 registry via
 * ./diagnostics.js.
 */

import { parseYarn, ParseError } from "../parse/parser.js";
import type { YarnDocument, YarnNode, Statement } from "../model/ast.js";
import { compileDocument, LoweringError } from "./compiler.js";
import type { Program } from "./program.js";
import { makeDiagnostic, hasErrors } from "./diagnostics.js";
import type { Diagnostic, YarnRange } from "./diagnostics.js";
import { typeCheck } from "./typeCheck.js";
import type { ExternalDeclarations, VariableDeclaration } from "./typeCheck.js";
import type { EnumType } from "./enums.js";
import { assignLineIds, StringTableManager } from "./stringTable.js";
import type { StringTable } from "./stringTable.js";
import { LineParser } from "../markup/lineParser.js";
import { builtinSignatures } from "../runtime/builtins.js";
import type { Library } from "../runtime/library.js";

/** One input of a compilation (upstream `CompilationJob.File`). */
export interface CompileFile {
  /** The file's name — diagnostic attribution and string-table `fileName`. */
  name: string;
  source: string;
}

/**
 * The compilation mode (upstream `CompilationJob.Type`): `full`,
 * `stringsOnly`, or `typeCheckOnly` — `declarationsOnly` is the obsolete
 * upstream name for `typeCheckOnly`, accepted as an alias.
 */
export type CompilationMode = "full" | "stringsOnly" | "typeCheckOnly" | "declarationsOnly";

export interface CompileOptions {
  /**
   * The compilation mode (default `full`). See the module docstring for
   * what each mode returns.
   */
  mode?: CompilationMode;
  /** Throw on the first error diagnostic instead of collecting. */
  strict?: boolean;
  /**
   * Host-provided external declarations: enum types
   * (EnumTypeBuilder outputs), function signatures, and variables for
   * compile-time checking. Conflicts with in-script declarations produce
   * YS0039 (variables) / YS0040 (types).
   */
  declarations?: ExternalDeclarations;
  /**
   * A compile-time Library: registered functions' signatures
   * feed signature checking (upstream `CompilationJob.Library`). Explicit
   * `declarations.functions` entries take precedence. The runtime keeps its
   * own Library instance.
   */
  library?: Library;
  generateOnceIds?: (ctx: { node: string; index: number }) => string;
}

/**
 * The result of a compilation — the upstream `CompilationResult` shape,
 * camelCased (upstream `CompilationResult` naming): program, string table, declarations,
 * diagnostics, file tags, implicit-string-tag flag, user-defined types.
 */
export interface CompileResult {
  /**
   * The compiled, serializable program (the glossary's Program): the
   * instruction-stream artifact (ADR 0001/0003) the runtime executes.
   * `null` when parsing failed or the mode stops before lowering
   * (stringsOnly / typeCheckOnly).
   */
  program: Program | null;
  /** The string table (upstream `CompilationResult.StringTable`). */
  stringTable: StringTable | null;
  /** `<<declare>>`d + external variable declarations (upstream `Declarations`). */
  declarations: VariableDeclaration[];
  diagnostics: Diagnostic[];
  /** Per-file file-level hashtags (`#tag` lines before the first node). */
  fileTags: Record<string, string[]>;
  /** Whether the compiler created line IDs for lines lacking `#line:` tags. */
  containsImplicitStringTags: boolean;
  /** Enum types defined by the script or the host (upstream user-defined types). */
  userDefinedTypes: EnumType[];
}

/** Single-file convenience; delegates to `compile()`. */
export function compileSource(source: string, opts: CompileSourceOptions = {}): CompileResult {
  return compile([{ name: opts.file ?? "input", source }], opts);
}

// `compileSource`'s historical `file` option names the single
// input; it rides the same CompileOptions as `compile()`.
export interface CompileSourceOptions extends CompileOptions {
  file?: string;
}
export type CompileSourceResult = CompileResult;

/**
 * Compile a collection of files: parse every file, assign
 * line IDs and register the string table, validate node structure, then
 * continue per the compilation mode.
 */
export function compile(files: CompileFile[], opts: CompileOptions = {}): CompileResult {
  const mode = opts.mode ?? "full";
  const diagnostics: Diagnostic[] = [];

  // First pass: parse every file. A file that fails to parse contributes
  // its diagnostic and no nodes; the other files still compile (upstream
  // compiles each file's parse result independently).
  const docs: Array<{ name: string; doc: YarnDocument }> = [];
  for (const file of files) {
    try {
      // Recovered (non-fatal) parse errors: upstream's ANTLR listener
      // reports, recovers, and keeps going, so one file can yield several
      // syntax diagnostics. Collected here and surfaced as codeless
      // YS0005-wrapped diagnostics, matching the seam's wrap below.
      const recovered: ParseError[] = [];
      const doc = parseYarn(file.source, { onRecoveredError: (e) => recovered.push(e) });
      for (const e of recovered) {
        diagnostics.push(
          makeDiagnostic(e.code ?? "YS0005", e.code ? e.message : `Syntax error: ${e.message}`, {
            file: file.name,
            range: e.range as YarnRange | undefined,
          }),
        );
      }
      for (const node of doc.nodes) node.sourceFile = file.name;
      // Soft parser findings: YS0019/YS0020/YS0022 ride the
      // document, not an exception — the parse itself succeeded.
      for (const sd of doc.softDiagnostics ?? []) {
        diagnostics.push(
          makeDiagnostic(sd.code, sd.message, {
            file: file.name,
            range: {
              startLine: sd.line - 1,
              startCol: sd.column - 1,
              endLine: sd.line - 1,
              endCol: sd.column,
            },
          }),
        );
      }
      docs.push({ name: file.name, doc });
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      // Raiseable parse problems carry their registry code:
      // upstream's error listener reports unclosed commands as YS0006, not
      // YS0005. Codeless errors are plain syntax errors (YS0005, whose
      // registry template is "Syntax error: {0}").
      const diagnostic = makeDiagnostic(
        e.code ?? "YS0005",
        e.code ? e.message : `Syntax error: ${e.message}`,
        {
          file: file.name,
          range: e.range as YarnRange | undefined,
        },
      );
      diagnostics.push(diagnostic);
    }
  }

  const empty: CompileResult = {
    program: null,
    stringTable: null,
    declarations: [],
    diagnostics,
    fileTags: {},
    containsImplicitStringTags: false,
    userDefinedTypes: [],
  };
  if (docs.length === 0) {
    if (opts.strict) throwOnFirstError(diagnostics);
    return empty;
  }

  // Compile-time Library: registered signatures feed signature
  // checking; explicit declarations.functions entries take precedence. The
  // built-in signatures sit at the base: upstream's compiler
  // knows its default Library's types, so e.g. `visited(true)` is a
  // compile-time YS0050, not a runtime surprise.
  const declarations: ExternalDeclarations = { ...opts.declarations };
  declarations.functions = {
    ...builtinSignatures,
    ...(opts.library?.getSignatures() ?? {}),
    ...declarations.functions,
  };

  // Line IDs + string table (every mode — upstream registers strings before
  // the StringsOnly stop, and TypeCheck has carried the table since 3.2.1).
  // The manager reports internal exhaustions (YS0041) through the same
  // diagnostics channel.
  const manager = new StringTableManager((d) => diagnostics.push(d));
  assignLineIds(docs, manager, (d) => diagnostics.push(d));

  // Node-structure + jump-target validation runs in every mode (upstream
  // validates node names and jump targets before the StringsOnly stop).
  const combined: YarnDocument = {
    type: "Document",
    enums: docs.flatMap(({ doc }) => doc.enums ?? []),
    nodes: docs.flatMap(({ doc }) => doc.nodes),
  };
  validate(combined, diagnostics);
  validateJumps(combined, diagnostics);
  validateMarkup(docs, (d) => diagnostics.push(d));

  // File-level hashtags are collected per file (unparseable files carry no
  // file tags — their content was never parsed). Upstream surfaces them
  // from the type-checking pass, so StringsOnly results carry none.
  const fileTags: Record<string, string[]> = {};
  if (mode !== "stringsOnly") {
    for (const file of files) fileTags[file.name] = [];
    for (const { name, doc } of docs) {
      fileTags[name] = doc.fileTags ?? [];
    }
  }

  if (mode === "stringsOnly") {
    if (opts.strict) throwOnFirstError(diagnostics);
    return {
      ...empty,
      stringTable: manager.stringTable,
      containsImplicitStringTags: manager.containsImplicitStringTags,
    };
  }

  // Enum-aware type checking: validates enum declarations and
  // member access, enforces the same-enum comparison restriction, resolves
  // `.Case` shorthand in place, and collects declarations.
  const checked = typeCheck(combined, { declarations }, (d) => diagnostics.push(d));

  if (mode === "typeCheckOnly" || mode === "declarationsOnly") {
    if (opts.strict) throwOnFirstError(diagnostics);
    return {
      ...empty,
      stringTable: manager.stringTable,
      declarations: checked.declarations,
      fileTags,
      userDefinedTypes: [...checked.enumTypes.values()],
    };
  }

  // Full compilation: lower to the instruction-stream artifact (ADR
  // 0001/0003). A LoweringError guards a lowering invariant that is
  // unbreakable by construction (every label reference is created alongside
  // its label in the same node's lowering), so catching one here means a
  // compiler bug, not user content — reported as a diagnostic, with no
  // program (coding standards §3).
  let program: Program | null = null;
  try {
    program = compileDocument(combined, {
      generateOnceIds: opts.generateOnceIds,
      enumTypes: checked.enumTypes,
    });
  } catch (e) {
    if (!(e instanceof LoweringError)) throw e;
    diagnostics.push(makeDiagnostic("YS0005", `Internal lowering failure: ${e.message}`));
  }

  if (opts.strict) throwOnFirstError(diagnostics);
  return {
    program,
    stringTable: manager.stringTable,
    declarations: checked.declarations,
    diagnostics,
    fileTags,
    containsImplicitStringTags: manager.containsImplicitStringTags,
    userDefinedTypes: [...checked.enumTypes.values()],
  };
}

function throwOnFirstError(diagnostics: Diagnostic[]): void {
  const firstError = diagnostics.find((d) => d.severity === "error");
  if (firstError) throw new Error(`${firstError.code}: ${firstError.message}`);
}

/** Node-structure validations derivable from the parsed documents. */
function validate(doc: YarnDocument, diagnostics: Diagnostic[]): void {
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
          { file: node.sourceFile },
        ),
      );
    }
    if (node.body.length === 0) {
      // Message sourced from the submodule's Definitions registry template
      // (YS0033-EmptyNode.md).
      diagnostics.push(
        makeDiagnostic(
          "YS0033",
          `Node "${node.title}" is empty and will not be included in the compiled output.`,
          { file: node.sourceFile },
        ),
      );
    }
    // YS0027: node titles and subtitles can only contain
    // letters, numbers, and underscores — one diagnostic per invalid
    // character, as upstream's per-character validation reports.
    for (const [kind, value] of [
      ["title", node.title] as const,
      ["subtitle", node.headers["subtitle"]?.trim() ?? ""] as const,
    ]) {
      const invalid = [...value].find((c) => !/[A-Za-z0-9_]/.test(c));
      if (invalid !== undefined) {
        diagnostics.push(
          makeDiagnostic(
            "YS0027",
            `Unexpected '${invalid}' in node "${kind}". Titles can only contain letters, numbers, and underscores.`,
            { file: node.sourceFile },
          ),
        );
      }
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
        diagnostics.push(makeDiagnostic("YS0011", `Duplicate node title: '${title}'`, { file: nodes[0].sourceFile }));
        membersWithoutWhen.forEach(() => {
          diagnostics.push(
            makeDiagnostic("YS0031", `Node '${title}' is part of a node group but has no when: clause`, {
              file: nodes[0].sourceFile,
            }),
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
            makeDiagnostic("YS0032", `Node group ${title} has subtitle ${subtitle} ${count} times`, {
              file: nodes[0].sourceFile,
            }),
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
function validateJumps(doc: YarnDocument, diagnostics: Diagnostic[]): void {
  const titles = new Set(doc.nodes.map((n) => n.title));
  for (const node of doc.nodes) {
    const targets: string[] = [];
    collectTargets(node.body, targets);
    for (const target of targets) {
      // Braced targets ({expr}) resolve at runtime — nothing to check statically.
      if (target.startsWith("{") || titles.has(target)) continue;
      diagnostics.push(
        makeDiagnostic("YS0012", `Jump to undefined node '${target}'`, { file: node.sourceFile }),
      );
    }
  }
}

/**
 * Markup validation of every dialogue line's text (YS0063 MarkupFailedToParse):
 * the compiler parses each line/option through the runtime markup
 * parser — upstream 3.2.1+ validates markup at compile time, so a malformed
 * attribute surfaces as a compile warning instead of surprising the host at
 * delivery.
 *
 * Inline `{expr}` spans are blanked out first: their contents are expression
 * source, not markup, and a bracket inside an expression string literal would
 * otherwise read as an unbalanced attribute. Blanking preserves positions, so
 * attribute-source positions from the markup parser stay meaningful.
 */
function validateMarkup(
  docs: Array<{ name: string; doc: YarnDocument }>,
  push: (d: Diagnostic) => void,
): void {
  const parser = new LineParser();
  const check = (text: string, file: string | undefined): void => {
    const { diagnostics: markupDiagnostics } = parser.parseStringWithDiagnostics(
      blankInlineExpressions(text),
      "en",
      // Character detection rewrites the text's prefix; it cannot affect
      // markup validity and would only move positions — off.
      { addImplicitCharacterAttribute: false },
    );
    if (markupDiagnostics.length === 0) return;
    push(
      makeDiagnostic("YS0063", `Dialogue has malformed or invalid markup. ${markupDiagnostics[0].message}`, {
        file,
      }),
    );
  };
  const walk = (stmts: Statement[], file: string | undefined): void => {
    for (const s of stmts) {
      switch (s.type) {
        case "Line":
          check(s.text, file);
          break;
        case "LineGroup":
          for (const item of s.items) check(item.text, file);
          break;
        case "OptionGroup":
          for (const o of s.options) {
            check(o.text, file);
            walk(o.body, file);
          }
          break;
        case "If":
          for (const b of s.branches) walk(b.body, file);
          break;
        case "Once":
          walk(s.body, file);
          if (s.elseBody) walk(s.elseBody, file);
          break;
        default:
          break;
      }
    }
  };
  for (const { name, doc } of docs) {
    for (const node of doc.nodes) walk(node.body, name);
  }
}

/** Replace the contents of unescaped `{expr}` spans with spaces. */
function blankInlineExpressions(text: string): string {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === "{") {
      const close = text.indexOf("}", i + 1);
      if (close === -1) break;
      for (let j = i + 1; j < close; j++) out[j] = " ";
      i = close + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

export { hasErrors };
