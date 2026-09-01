import type { MarkupParseResult } from "../markup/types.js";
export type IRProgram = {
  enums: Record<string, string[]>; // enum name -> cases
  nodes: Record<string, IRNode | IRNodeGroup>; // can be single node or group
  /**
   * Upstream `Program.InitialValues`: the default value of every `<<declare>>`d
   * variable, collected at compile time. Keys are bare variable names (this
   * storage's convention); values are the raw `declare` command content, which
   * the runtime evaluates into variable storage at start-up so declared
   * variables exist before the first node runs.
   */
  initialValues: Record<string, string>;
};

export type IRNode = {
  title: string;
  instructions: IRInstruction[];
  when?: string[]; // Array of when conditions
  scene?: string; // Scene name from node header
  tracking?: "always" | "never"; // Visit tracking mode from the tracking: header
};

export type IRNodeGroup = {
  title: string;
  nodes: IRNode[]; // Multiple nodes with same title, different when conditions
};

export type IRInstruction =
  | { op: "line"; speaker?: string; text: string; tags?: string[]; markup?: MarkupParseResult }
  | { op: "command"; content: string }
  | { op: "jump"; target: string }
  | { op: "detour"; target: string }
  | { op: "options"; options: Array<{ text: string; tags?: string[]; markup?: MarkupParseResult; condition?: string; block: IRInstruction[] }> }
  | { op: "if"; branches: Array<{ condition: string | null; block: IRInstruction[] }> }
  | { op: "once"; id: string; block: IRInstruction[] };


