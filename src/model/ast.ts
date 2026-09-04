export type Position = { line: number; column: number };

/**
 * A soft (non-throwing) parser finding (ticket 65): semantic line-content
 * warnings/errors the parser reports without aborting the parse — YS0019,
 * YS0020, YS0022. The compile seam converts these to registry diagnostics.
 * Lines/columns are 1-based token positions (the lexer's convention).
 */
export interface ParserDiagnostic {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface NodeHeaderMap {
  [key: string]: string;
}

export interface YarnDocument {
  type: "Document";
  enums: EnumDefinition[];
  nodes: YarnNode[];
  /**
   * File-level hashtags: `#tag` lines preceding the first node (upstream
   * `file_hashtag`). Surfaced per file in the compile result's `fileTags`.
   */
  fileTags?: string[];
  /**
   * Soft parser findings (ticket 65) — see ParserDiagnostic. Absent when
   * the parse raised none.
   */
  softDiagnostics?: ParserDiagnostic[];
}

export interface EnumDefinition {
  type: "Enum";
  name: string;
  cases: EnumCaseDef[];
}

export interface YarnNode {
  type: "Node";
  title: string;
  headers: NodeHeaderMap;
  nodeTags?: string[];
  when?: string[]; // Array of when conditions (can be "once", "always", or expression like "$has_sword")
  /** Number of redundant `title:` headers beyond the first (upstream YS0052). */
  duplicateTitleHeaders?: number;
  body: Statement[];
  /**
   * The source file this node came from — set by the multi-file compile
   * seam (`compile()`), not the parser, so diagnostics and string-table
   * entries can attribute nodes to their file.
   */
  sourceFile?: string;
  /**
   * 1-based source line of the node's first header (upstream
   * `nodeContext.Start.Line`) — the descriptive line-tag generator's
   * unique-title checksum seed for subtitle-less node-group members.
   */
  startLine?: number;
}

export type Statement =
  | Line
  | Command
  | OptionGroup
  | LineGroup
  | IfBlock
  | OnceBlock
  | Jump
  | Detour
  | EnumBlock;

export interface Line {
  type: "Line";
  text: string;
  tags?: string[];
  /** 1-based source line number (string-table `lineNumber`). */
  lineNumber?: number;
  /** Line-level `<<if expr>>` condition (upstream line conditions). */
  condition?: string;
  /** Line-level `<<once>>` / `<<once if expr>>` (upstream once modifiers);
   *  `condition` is the `<<once if expr>>` expression when present. */
  once?: OnceModifier;
}

export interface Command {
  type: "Command";
  content: string; // inside << >>
  /**
   * `///` documentation comment lines immediately above the command, one
   * per line joined with `\n` (spec story 47). Upstream attaches them to
   * `<<declare>>`s — they surface as the declaration's `description`.
   */
  docComment?: string;
}

export interface Jump {
  type: "Jump";
  target: string;
}

export interface Detour {
  type: "Detour";
  target: string;
}

export interface OptionGroup {
  type: "OptionGroup";
  options: Option[];
}

export interface Option {
  type: "Option";
  text: string;
  body: Statement[]; // executed if chosen
  tags?: string[];
  /** 1-based source line number (string-table `lineNumber`). */
  lineNumber?: number;
  condition?: string;
  /** Option-level `<<once>>` / `<<once if expr>>` (upstream once options):
   *  the option is selectable once; the flag records on selection. */
  once?: OnceModifier;
}

/**
 * A line group (upstream `line_group_statement`): consecutive `=>` lines —
 * saliency selects exactly one item to run (ticket 47). Each item is an
 * ordinary line; its `<<if>>`/`<<once>>`/`<<once if>>` modifier becomes the
 * item's saliency condition rather than a line gate.
 */
export interface LineGroup {
  type: "LineGroup";
  items: Line[];
}

/** A `<<once>>`/`<<once if expr>>` modifier shared by lines and options. */
export interface OnceModifier {
  /** The `<<once if expr>>` expression, when the modifier is conditional. */
  condition?: string;
}

export interface IfBlock {
  type: "If";
  branches: Array<{
    condition: string | null; // null for else
    body: Statement[];
  }>;
}

export interface OnceBlock {
  type: "Once";
  body: Statement[];
  /** `<<once if expr>>` gate (absent for a plain `<<once>>`). */
  condition?: string;
  /** `<<else>>` body — runs when the once-state is already seen or the
   *  `<<once if>>` gate fails (upstream `<<once>>...<<else>>...<<endonce>>`). */
  elseBody?: Statement[];
}

export interface EnumCaseDef {
  name: string;
  /** Raw source text of `= <raw value>` when present (a constant literal). */
  rawValue?: string;
}

export interface EnumBlock {
  type: "Enum";
  name: string;
  cases: EnumCaseDef[];
}


