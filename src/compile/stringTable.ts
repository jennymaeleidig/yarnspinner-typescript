/**
 * The string table (spec stories 31/33; upstream `StringTableManager` +
 * `StringInfo`): the compile output's mapping of line ID → string info,
 * covering every line and option line of the compiled sources.
 *
 * Ticket 49 scope: the table's shape, its registration pass over the
 * multi-file sources, and the implicit-ID seam (currently the fork's
 * per-compile counter — upstream's CRC32(file+node+count) scheme and the
 * `#shadow:` validation suite YS0042/43/44 land with ticket 50). YS0018
 * (duplicate explicit line IDs) fires here because the string table is the
 * registry of line IDs.
 *
 * Line IDs are assigned in the compiler's lowering order (nodes grouped by
 * title, members and statements in document order) so a full compile's
 * program and its string table always agree on every line's ID — the pre
 * pass writes the implicit `#line:` tags into the AST, and the compiler's
 * `ensureLineId` reuses them (coding standards §6: the golden bytecode
 * assertions pin this order).
 */

import type { YarnDocument, YarnNode, Statement } from "../model/ast.js";
import { makeDiagnostic } from "./diagnostics.js";
import type { Diagnostic } from "./diagnostics.js";

/** Information about one string in the string table (upstream `StringInfo`). */
export interface StringInfo {
  /**
   * The original text of the line. `null` for shadow lines — their content
   * comes from the source line (upstream nulls the entry after validation;
   * ticket 50 owns the validation that precedes the nulling).
   */
  text: string | null;
  /** The name of the node this string was found in. */
  nodeName: string;
  /** 1-based source line number. */
  lineNumber: number;
  /** The name of the file this string was found in. */
  fileName: string;
  /** Whether the line ID was implicitly generated (no `#line:` tag). */
  isImplicitTag: boolean;
  /** The line's hashtags besides `#line:`. */
  metadata: string[];
  /** The line ID this line shadows via `#shadow:`, or null. */
  shadowLineID: string | null;
}

/** The string table: line ID → string info (upstream `CompilationResult.StringTable`). */
export type StringTable = Record<string, StringInfo>;

export class StringTableManager {
  readonly stringTable: StringTable = {};
  private counter = 0;

  /**
   * Register a string. With no `existingLineID`, an implicit ID is
   * generated (upstream seeds CRC32 over file+node+count; ticket 50 swaps
   * this counter for that scheme — shadow lines get the `sh_` prefix).
   * Returns the line ID and whether it was implicit.
   */
  registerString(info: {
    text: string | null;
    fileName: string;
    nodeName: string;
    lineNumber: number;
    existingLineID?: string;
    metadata: string[];
    shadowID?: string | null;
  }): { lineID: string; isImplicit: boolean } {
    if (info.existingLineID !== undefined) {
      this.stringTable[info.existingLineID] = {
        text: info.text,
        nodeName: info.nodeName,
        lineNumber: info.lineNumber,
        fileName: info.fileName,
        isImplicitTag: false,
        metadata: info.metadata,
        shadowLineID: info.shadowID ?? null,
      };
      return { lineID: info.existingLineID, isImplicit: false };
    }

    const prefix = info.shadowID != null ? "sh_" : "";
    const lineID = `line:${prefix}${(this.counter++).toString(16)}`;
    this.stringTable[lineID] = {
      text: info.text,
      nodeName: info.nodeName,
      lineNumber: info.lineNumber,
      fileName: info.fileName,
      isImplicitTag: true,
      metadata: info.metadata,
      shadowLineID: info.shadowID ?? null,
    };
    return { lineID, isImplicit: true };
  }

  hasLineID(lineID: string): boolean {
    return lineID in this.stringTable;
  }

  /**
   * Upstream `ContainsImplicitStringTags`: whether the compiler had to
   * create line IDs for lines that lacked `#line:` tags (shadow lines
   * always carry implicit IDs of their own and don't count).
   */
  get containsImplicitStringTags(): boolean {
    return Object.values(this.stringTable).some(
      (info) => info.isImplicitTag && info.shadowLineID === null,
    );
  }
}

/**
 * Assign line IDs and register every line and option line of `docs` into
 * `manager`, mutating the AST so each line carries its implicit `#line:`
 * tag (exactly what the compiler's `ensureLineId` did inline, hoisted here
 * so every compilation mode observes the same table). Walks nodes in the
 * compiler's lowering order — grouped by title, members and statements in
 * document order — via `groupNodesByTitle`.
 *
 * Emits YS0018 for duplicate explicit `#line:` tags (all line IDs in a
 * project must be unique).
 */
export function assignLineIds(
  docs: Array<{ name: string; doc: YarnDocument }>,
  manager: StringTableManager,
  emit: (d: Diagnostic) => void,
): void {
  for (const node of [...groupNodesByTitle(docs.map(({ doc }) => doc)).values()].flat()) {
    walkStatements(node.body, {
      fileName: node.sourceFile ?? "",
      nodeName: node.title,
      manager,
      emit,
    });
  }
}

interface WalkContext {
  fileName: string;
  nodeName: string;
  manager: StringTableManager;
  emit: (d: Diagnostic) => void;
}

function walkStatements(stmts: Statement[], ctx: WalkContext): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Line":
        registerLine(s, ctx);
        break;
      case "LineGroup":
        for (const item of s.items) registerLine(item, ctx);
        break;
      case "OptionGroup":
        // The compiler assigns option tags for the whole group before
        // lowering the bodies (lowerOptions' prepared pass) — mirror that
        // here so IDs match the program's.
        for (const option of s.options) registerLine(option, ctx);
        for (const option of s.options) walkStatements(option.body, ctx);
        break;
      case "If":
        for (const b of s.branches) walkStatements(b.body, ctx);
        break;
      case "Once":
        walkStatements(s.body, ctx);
        if (s.elseBody) walkStatements(s.elseBody, ctx);
        break;
      case "Command":
      case "Jump":
      case "Detour":
      case "Enum":
        break;
    }
  }
}

/**
 * Register one line-bearing AST item (a line, line-group item, or option):
 * assign its line ID — explicit `#line:` verbatim (duplicates → YS0018),
 * otherwise implicit — write it back into the tags (so the compiler's
 * lowering reuses it), and record the string-table entry. A `#shadow:` tag
 * marks the entry as a shadow line; per upstream a line cannot carry both
 * tags, so shadow lines always register with implicit IDs of their own.
 */
function registerLine(
  line: { text: string; tags?: string[]; lineNumber?: number },
  ctx: WalkContext,
): void {
  const tags = [...(line.tags ?? [])];
  // Metadata is the line's hashtags besides `#line:` — snapshotted before
  // any implicit-ID write-back mutates `tags`.
  const metadata = tags.filter((t) => !t.startsWith("line:"));
  const shadowTag = tags.find((t) => t.startsWith("shadow:"));
  const shadowLineID = shadowTag ? shadowTag.slice("shadow:".length) || null : null;
  const explicitTag = tags.find((t) => t.startsWith("line:"));
  const entry = {
    text: line.text,
    fileName: ctx.fileName,
    nodeName: ctx.nodeName,
    lineNumber: line.lineNumber ?? 0,
  };

  let lineID: string;
  if (shadowTag && !explicitTag) {
    // Shadow line: implicit ID of its own (upstream sh_ prefix), no tag
    // written back — the shadow tag alone identifies it.
    lineID = ctx.manager
      .registerString({ ...entry, metadata: [...metadata], shadowID: shadowLineID })
      .lineID;
  } else if (explicitTag) {
    lineID = explicitTag;
    if (ctx.manager.hasLineID(lineID)) {
      ctx.emit(
        makeDiagnostic("YS0018", `Duplicate line ID '${lineID}'`, {
          file: ctx.fileName,
        }),
      );
    }
    ctx.manager.registerString({
      ...entry,
      existingLineID: lineID,
      metadata: [...metadata],
      shadowID: null,
    });
  } else {
    lineID = ctx.manager
      .registerString({ ...entry, metadata: [...metadata], shadowID: null })
      .lineID;
    // Write the implicit ID back so the compiler's lowering reuses it.
    tags.push(lineID);
    line.tags = tags;
  }
}

/**
 * Group nodes across documents by title, in the compiler's lowering order:
 * titles by first occurrence, members in document order. Shared with the
 * compiler so the string table's ID assignment and the program's lowering
 * observe the same sequence (see the module docstring).
 */
export function groupNodesByTitle(docs: YarnDocument[]): Map<string, YarnNode[]> {
  const nodesByTitle = new Map<string, YarnNode[]>();
  for (const doc of docs) {
    for (const node of doc.nodes) {
      if (!nodesByTitle.has(node.title)) nodesByTitle.set(node.title, []);
      nodesByTitle.get(node.title)!.push(node);
    }
  }
  return nodesByTitle;
}
