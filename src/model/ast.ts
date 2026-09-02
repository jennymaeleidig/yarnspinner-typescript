export type Position = { line: number; column: number };

export interface NodeHeaderMap {
  [key: string]: string;
}

export interface YarnDocument {
  type: "Document";
  enums: EnumDefinition[];
  nodes: YarnNode[];
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
}

export type Statement =
  | Line
  | Command
  | OptionGroup
  | IfBlock
  | OnceBlock
  | Jump
  | Detour
  | EnumBlock;

import type { MarkupParseResult } from "../markup/types.js";

export interface Line {
  type: "Line";
  speaker?: string;
  text: string;
  tags?: string[];
  markup?: MarkupParseResult;
  /** Line-level `<<if expr>>` condition (upstream line conditions). */
  condition?: string;
  /** Line-level `<<once>>` / `<<once if expr>>` (upstream once modifiers);
   *  `condition` is the `<<once if expr>>` expression when present. */
  once?: OnceModifier;
}

export interface Command {
  type: "Command";
  content: string; // inside << >>
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
  markup?: MarkupParseResult;
  condition?: string;
  /** Option-level `<<once>>` / `<<once if expr>>` (upstream once options):
   *  the option is selectable once; the flag records on selection. */
  once?: OnceModifier;
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


