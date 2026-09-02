import type { MarkupParseResult } from "../markup/types.js";
export type IRProgram = {
  /**
   * Enum types available to the program: enum name → case name → raw value.
   * Runtime enum member access evaluates to the case's raw value (ADR 0004).
   */
  enums: Record<string, Record<string, number | string>>;
  nodes: Record<string, IRNode | IRNodeGroup>; // can be single node or group
  /**
   * Upstream `Program.InitialValues`: the default value of every `<<declare>>`d
   * variable, collected at compile time. Keys are bare variable names (this
   * storage's convention); values are the raw `declare` command content, which
   * the runtime evaluates into variable storage at start-up so declared
   * variables exist before the first node runs.
   */
  initialValues: Record<string, string>;
  /**
   * Smart variables (ticket 42; upstream "inline expansions"): variable name
   * → the `<<declare>>` initializer expression. Smart variables are read-only
   * and recomputed on every access; they carry no initial value (upstream:
   * they are not in `Program.InitialValues`). The runtime re-evaluates the
   * expression through the current variable storage each time it reads the
   * name.
   */
  smartVariables: Record<string, string>;
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


