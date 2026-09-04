// SPDX-License-Identifier: CC0-1.0
/**
 * The string table (upstream `StringTableManager` +
 * `StringInfo` + `StringTableGeneratorVisitor`): the compile output's
 * mapping of line ID → string info, covering every line and option line of
 * the compiled sources.
 *
 * The upstream ID scheme — implicit line IDs are
 * `line:` + CRC32(fileName + nodeName + running table count) in
 * little-endian hex (`sh_`-prefixed for shadow lines, numeric suffix
 * retried on collision — exhaustion reports YS0041 and keeps retrying,
 * upstream's internal DialogueException demoted per coding standards §3);
 * explicit `#line:` tags are used verbatim (duplicates → YS0018 on both
 * occurrences, nothing registered); a line may carry at most one
 * `#line:`/`#shadow:` tag (YS0017 for a mix, YS0062 for multiples — the
 * line registers nothing); `#shadow:` lines register under their own
 * implicit ID and are validated after all files register (YS0042 unknown
 * source, YS0043 source has expressions, YS0044 text differs — the entry's
 * `text` strips to null, upstream's signal that content comes from the
 * source line); the auto-added `lastline` tag joins the metadata of the
 * line immediately preceding an options block.
 *
 * IDs are assigned in the upstream registration order — files in input
 * order, nodes in document order, statements depth-first (an option's line
 * before its body) — with the implicit IDs written back into the AST, so
 * the compiler's lowering reuses them and a full compile's program and its
 * string table always agree on every line's ID regardless of the lowering's
 * own node grouping (coding standards §6: the golden bytecode assertions
 * pin this). Shadow lines get the same write-back: the program carries the
 * shadow's own ID, and the entry's null `text` + `shadowLineID` tell
 * clients where the content lives.
 */

import type { YarnDocument, Statement } from "../model/ast.js";
import { makeDiagnostic } from "./diagnostics.js";
import type { Diagnostic } from "./diagnostics.js";
import { crc32Hex } from "./crc32.js";

/** Information about one string in the string table (upstream `StringInfo`). */
export interface StringInfo {
  /**
   * The original text of the line. `null` for shadow lines — their content
   * comes from the source line (upstream nulls the entry after validation;
   * a shadow whose source is missing keeps its text, upstream's YS0042
   * `continue`).
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
  /** The line's hashtags besides the auto-added `lastline` marker. */
  metadata: string[];
  /** The line ID this line shadows via `#shadow:`, or null. */
  shadowLineID: string | null;
}

/** The string table: line ID → string info (upstream `CompilationResult.StringTable`). */
export type StringTable = Record<string, StringInfo>;

/** A line-bearing AST item (a line, line-group item, or option). */
interface LineBearing {
  text: string;
  tags?: string[];
  lineNumber?: number;
}

export class StringTableManager {
  readonly stringTable: StringTable = {};
  /** Entries registered so far (upstream seeds implicit IDs off this count). */
  private registeredCount = 0;

  constructor(private readonly emit?: (d: Diagnostic) => void) {}

  /**
   * Register a string. With no `existingLineID`, an implicit ID is
   * generated: `line:` + CRC32(fileName + nodeName + count) — `sh_`-prefixed
   * for shadow lines, with a numeric suffix retried on collision (upstream
   * `RegisterString`). After upstream's 1000-attempt cap the owner's `emit`
   * reports YS0041 once (upstream throws its internal DialogueException
   * here; demoted per coding standards §3) and the retry continues — the
   * 2^32 checksum space makes further collisions vanishingly unlikely.
   */
  registerString(info: {
    text: string | null;
    fileName: string;
    nodeName: string;
    lineNumber: number;
    existingLineID?: string;
    metadata: string[];
    shadowID?: string | null;
  }): string {
    let lineID: string;
    let isImplicit: boolean;

    if (info.existingLineID !== undefined) {
      lineID = info.existingLineID;
      isImplicit = false;
    } else {
      const candidateSeed = `${info.fileName}${info.nodeName}${this.registeredCount}`;
      const prefix = info.shadowID != null ? "sh_" : "";
      let attempt = 0;
      let exhaustionReported = false;
      do {
        if (attempt > 1000 && !exhaustionReported) {
          exhaustionReported = true;
          this.emit?.(
            makeDiagnostic(
              "YS0041",
              `Internal error: string table failed to find a non-colliding hash for "${candidateSeed}" after ${attempt} attempts`,
              { file: info.fileName },
            ),
          );
        }
        const suffix = attempt !== 0 ? String(attempt) : "";
        lineID = `line:${prefix}${crc32Hex(candidateSeed + suffix)}`;
        attempt += 1;
      } while (this.hasLineID(lineID));
      isImplicit = true;
    }

    this.stringTable[lineID] = {
      text: info.text,
      nodeName: info.nodeName,
      lineNumber: info.lineNumber,
      fileName: info.fileName,
      isImplicitTag: isImplicit,
      metadata: info.metadata,
      shadowLineID: info.shadowID ?? null,
    };
    this.registeredCount += 1;
    return lineID;
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
 * Assign line IDs, register every line and option line of `docs` into
 * `manager` (mutating the AST so each implicit line carries its `#line:`
 * tag — exactly what the compiler's `ensureLineId` reuses), then validate
 * shadow lines. Every compilation mode observes the same table: the
 * shadow-validation pass runs before any mode stop (upstream runs it
 * between registration and the StringsOnly return).
 *
 * Emits YS0017/YS0062 for lines with multiple content-ID tags, YS0018 for
 * duplicate explicit `#line:` tags (both occurrences), and YS0042/43/44
 * for invalid shadow lines.
 */
export function assignLineIds(
  docs: Array<{ name: string; doc: YarnDocument }>,
  manager: StringTableManager,
  emit: (d: Diagnostic) => void,
): void {
  for (const { name, doc } of docs) {
    // Upstream tags the last-line-before-options per file before registering
    // its strings, so the flag exists when the line registers.
    const lastLineFlags = new Set<LineBearing>();
    for (const node of doc.nodes) flagLastLines(node.body, lastLineFlags);
    for (const node of doc.nodes) {
      const ctx: WalkContext = {
        fileName: name,
        nodeName: node.title,
        manager,
        emit,
        lastLineFlags,
      };
      walkStatements(node.body, ctx);
    }
  }
  validateShadowLines(manager, emit);
}

interface WalkContext {
  fileName: string;
  nodeName: string;
  manager: StringTableManager;
  emit: (d: Diagnostic) => void;
  lastLineFlags: Set<LineBearing>;
}

/**
 * Upstream registration order, per statement list: depth-first document
 * order. Options register their line before walking their body (upstream's
 * parse-tree visit); line-group items register in order.
 */
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
        for (const option of s.options) {
          registerLine(option, ctx);
          walkStatements(option.body, ctx);
        }
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
 * Upstream `LastLineBeforeOptionsVisitor`: flag every line that is the
 * statement immediately before an options block in its own statement list
 * (a command or block in between means no flag). Recursed into if-bodies
 * and option bodies; `<<once>>` blocks are not visited (upstream's visitor
 * has no once case). The flag joins the registered entry's metadata as the
 * `lastline` tag, always — even when the line already carries one.
 */
function flagLastLines(stmts: Statement[], flags: Set<LineBearing>): void {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    switch (s.type) {
      case "If":
        for (const b of s.branches) flagLastLines(b.body, flags);
        break;
      case "OptionGroup":
        for (const option of s.options) flagLastLines(option.body, flags);
        if (i > 0) {
          const prev = stmts[i - 1];
          if (prev.type === "Line") flags.add(prev);
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Register one line-bearing AST item (a line, line-group item, or option):
 * assign its line ID — explicit `#line:` verbatim, otherwise implicit —
 * record the string-table entry, and write implicit IDs back into the tags
 * so the compiler's lowering reuses them.
 *
 * Upstream's guards run in order: more than one `#line:`/`#shadow:` tag
 * bails the line entirely (YS0017 for a mix — reported per pair, matching
 * upstream's loop — YS0062 otherwise); a duplicate explicit ID reports
 * both occurrences (YS0018) and leaves the first entry standing (upstream
 * bails before registering).
 */
function registerLine(line: LineBearing, ctx: WalkContext): void {
  const tags = [...(line.tags ?? [])];
  const lineIDTags = tags.filter((t) => t.startsWith("line:"));
  const shadowIDTags = tags.filter((t) => t.startsWith("shadow:"));

  if (lineIDTags.length + shadowIDTags.length > 1) {
    if (lineIDTags.length > 0 && shadowIDTags.length > 0) {
      // Upstream reports both tags of every (line tag, shadow tag) pair; the
      // message carries no parameters, so identical diagnostics result.
      const pairs = lineIDTags.length * shadowIDTags.length;
      for (let i = 0; i < pairs; i++) {
        ctx.emit(makeDiagnostic("YS0017", "Lines cannot have both a '#line' tag and a '#shadow' tag.", { file: ctx.fileName }));
        ctx.emit(makeDiagnostic("YS0017", "Lines cannot have both a '#line' tag and a '#shadow' tag.", { file: ctx.fileName }));
      }
      return;
    }
    const offenders = lineIDTags.length > 1 ? lineIDTags : shadowIDTags;
    offenders.forEach(() => {
      ctx.emit(makeDiagnostic("YS0062", "Dialogue has multiple '#line' or '#shadow' IDs.", { file: ctx.fileName }));
    });
    return;
  }

  const explicitTag = lineIDTags[0];
  const shadowTag = shadowIDTags[0];

  // Metadata is the line's authored hashtags — snapshot before any
  // implicit-ID write-back mutates `tags` (upstream passes the hashtag
  // texts as-is, so an authored `#line:` tag stays in metadata), plus the
  // auto-added `lastline` marker when flagged.
  const metadata = [...tags];
  if (ctx.lastLineFlags.has(line)) metadata.push("lastline");

  const entry = {
    text: line.text,
    fileName: ctx.fileName,
    nodeName: ctx.nodeName,
    lineNumber: line.lineNumber ?? 0,
  };

  if (explicitTag !== undefined) {
    if (ctx.manager.hasLineID(explicitTag)) {
      const existing = ctx.manager.stringTable[explicitTag];
      ctx.emit(
        makeDiagnostic("YS0018", `Duplicate line ID '${explicitTag}'`, { file: ctx.fileName }),
      );
      ctx.emit(
        makeDiagnostic("YS0018", `Duplicate line ID '${explicitTag}'`, {
          file: existing?.fileName ?? ctx.fileName,
        }),
      );
      return;
    }
    ctx.manager.registerString({ ...entry, existingLineID: explicitTag, metadata, shadowID: null });
    return;
  }

  // Upstream resolves `#shadow:<id>` with the `line:` prefix prepended —
  // authors write the target without it.
  const shadowLineID = shadowTag !== undefined ? `line:${shadowTag.slice("shadow:".length)}` : null;

  const lineID = ctx.manager.registerString({ ...entry, metadata, shadowID: shadowLineID });
  // Write the implicit ID back so the compiler's lowering reuses it —
  // shadow lines too: the program carries the shadow's own ID.
  tags.push(lineID);
  line.tags = tags;
}

/**
 * Upstream `Compiler.Compile`'s post-registration shadow pass: every
 * registered shadow line must point at an existing line (YS0042 — and only
 * this failure keeps the text), whose text has no inline expressions
 * (YS0043) and matches the shadow's text exactly (YS0044). A valid — or
 * otherwise invalid — shadow has its `text` stripped to null: clients get
 * the content from the source line. Diagnostics attribute to the shadow
 * line's file (upstream reads the file from the shadow's own entry).
 */
function validateShadowLines(manager: StringTableManager, emit: (d: Diagnostic) => void): void {
  for (const info of Object.values(manager.stringTable)) {
    if (info.shadowLineID === null) continue;

    const source = manager.stringTable[info.shadowLineID];
    if (!source) {
      emit(makeDiagnostic("YS0042", `Unknown line ID ${info.shadowLineID} for shadow line`, { file: info.fileName }));
      continue;
    }
    if (source.text === null) {
      // Chained shadows (a shadow of a shadow) reach the source's already-
      // stripped text. Upstream throws an internal InvalidOperationException
      // here; this fork reports it (coding standards §3) and leaves the
      // entry untouched.
      emit(
        makeDiagnostic(
          "YS0041",
          `Internal error: line with shadow id ${info.shadowLineID} was referencing line ${info.shadowLineID}, but that line's text is null`,
          { file: info.fileName },
        ),
      );
      continue;
    }
    if (hasInlineExpression(source.text)) {
      emit(makeDiagnostic("YS0043", "Shadow lines must not have expressions", { file: info.fileName }));
    }
    if (source.text !== info.text) {
      emit(makeDiagnostic("YS0044", "Shadow lines must have the same text as their source", { file: info.fileName }));
    }
    info.text = null;
  }
}

/**
 * Whether a line's text carries an inline `{expr}` substitution (upstream
 * checks the source line's parsed expressions). Escaped braces (`\{`) and
 * unclosed braces compose as literal characters — the runtime's expansion
 * rules — so they are not expressions.
 */
function hasInlineExpression(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && (text[i + 1] === "{" || text[i + 1] === "}")) {
      i += 2;
      continue;
    }
    if (char === "{") {
      const close = text.indexOf("}", i + 1);
      if (close !== -1) return true;
      return false;
    }
    i += 1;
  }
  return false;
}
