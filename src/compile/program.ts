/**
 * The instruction-stream program format (ADR 0001, ADR 0003).
 *
 * The compiler emits a TS-idiomatic instruction-stream stack-VM program: a
 * versioned JSON artifact (its own format — upstream's protobuf `Program`
 * is explicitly out of scope) in which expressions are compiled to bytecode
 * and jumps are instruction indices, with labels resolved in a compiler
 * pass before the artifact is handed out.
 *
 * Idioms:
 * - Op names mirror the upstream instruction concepts in camelCase (coding
 *   standards §5): `runLine`, `addOption`, `pushVariable`, …
 * - Lines and commands keep their authored text; the runtime line parser
 *   owns `{expr}` substitutions and markup (upstream's compiler/runtime
 *   split). Only condition and assignment expressions compile to bytecode.
 * - `runNode`/`detour` target nodes by name; `{expr}` targets stay strings
 *   the VM resolves at execution (upstream resolves dynamic node names at
 *   execution too).
 * - Option groups lower to one availability push + `addOption` per option
 *   (the evaluated condition bytecode, or `pushBool true` when none —
 *   `addOption` pops it as the option's `isAvailable`, mirroring upstream's
 *   AddOption), one `showOptions`, and inline bodies each ending in a
 *   `jumpTo` past the construct — so the full set is delivered with
 *   per-option availability flags (upstream `OptionSet.Option.IsAvailable`),
 *   a selection runs the body and resumes after the options block, and the
 *   no-option-selected fall-through is the pc after `showOptions`. Nested
 *   groups work because `showOptions` delivers and clears the accumulated
 *   set.
 * - Generated-variable state (once-state) is read/written with plain
 *   variable ops; the key naming contract lives in
 *   `runtime/generatedVariables.ts` (coding standards §4).
 * - `when` conditions stay evaluator strings; the VM's saliency machinery
 *   (ticket 47) evaluates them and scores complexity per member
 *   (`runtime/saliency.ts`).
 * - Line groups (ticket 47) lower like option groups: one condition push +
 *   `addSaliencyCandidate` per item (the evaluated `<<if>>`/`<<once>>`
 *   gate, or `pushBool true`; the op records the candidate with its
 *   complexity and destination), then `selectSaliencyCandidate` (the
 *   strategy picks — pushing the destination and `true`, or just `false`),
 *   `jumpIfFalse` past the group when nothing was selected, and `popJump`
 *   to the selected item's body (upstream `AddSaliencyCandidate` /
 *   `SelectSaliencyCandidate` + `Pop`/`PeekAndJump`). A `once` item's flag
 *   stores at its body's first instruction, like a once option.
 * - A node-group member's `subtitle:` header carries into the program: it
 *   qualifies the member's visit-tracking key (`Title.Subtitle`, upstream
 *   node-group naming — ticket 46) and its saliency content ID (ticket 47).
 */

import type { MarkupParseResult } from "../markup/types.js";

/** The program format's language version (ADR 0003). Bump on schema changes. */
export const programLanguageVersion = 1;

/**
 * The compiled, serializable artifact of a set of `.yarn` sources (the
 * glossary's Program): versioned JSON, consumed by the runtime.
 */
export type Program = {
  /** Format version of this artifact (ADR 0003); see `programLanguageVersion`. */
  languageVersion: number;
  /**
   * Enum types available to the program: enum name → case name → raw value.
   * Member access has already been folded to raw values at compile time;
   * the table remains for host-side inspection and `.Case` resolution.
   */
  enums: Record<string, Record<string, number | string>>;
  /** Node title → node, or → a node group of same-titled members. */
  nodes: Record<string, ProgramNode | ProgramNodeGroup>;
  /**
   * Compiled `<<declare>>` initializers (upstream `Program.InitialValues`):
   * variable name → bytecode whose execution pushes the declared default.
   * The VM seeds variable storage from these at start-up; declares compile
   * to no instruction in the stream.
   */
  initialValues: Record<string, Instruction[]>;
  /**
   * Smart variables (ticket 42, upstream "inline expansion"): variable name
   * → compiled initializer expression, recomputed on every access; they
   * carry no initial stored value.
   */
  smartVariables: Record<string, Instruction[]>;
};

/** A compiled node: one instruction stream plus its headers. */
export type ProgramNode = {
  title: string;
  instructions: Instruction[];
  /** `when:` header conditions, verbatim (saliency compilation: ticket 47). */
  when?: string[];
  /** `scene:` header (adapter-side concern). */
  scene?: string;
  /** `tracking:` header (visit-tracking mode). */
  tracking?: "always" | "never";
  /** `subtitle:` header — qualifies the node's visit-tracking key. */
  subtitle?: string;
};

/** Multiple same-titled nodes; saliency picks a member at entry. */
export type ProgramNodeGroup = {
  title: string;
  nodes: ProgramNode[];
};

/**
 * One instruction. Stack ops and operands mirror the upstream instruction
 * concepts (coding standards §5); jumps and option destinations are
 * instruction indices into the same node's stream, resolved by the
 * compiler's label pass before the program is emitted.
 */
export type Instruction =
  // Flow control.
  | { op: "jumpTo"; index: number }
  | { op: "jumpIfFalse"; index: number } // pops the condition
  | { op: "jumpIfTrue"; index: number } // pops the condition
  | { op: "runNode"; node: string } // enter node (jump semantics)
  | { op: "detour"; node: string } // call-and-return node entry
  | { op: "return" } // end a detour; acts as stop outside one
  | { op: "stop" } // complete the dialogue
  // Delivery (authored text; the runtime line parser composes it).
  | { op: "runLine"; text: string; speaker?: string; tags?: string[]; markup?: MarkupParseResult }
  | { op: "runCommand"; content: string }
  /** Pops the option's availability (the evaluated condition; the compiler
   *  emits `pushBool true` for unconditioned options — upstream AddOption). */
  | { op: "addOption"; text: string; tags?: string[]; destination: number; markup?: MarkupParseResult }
  | { op: "showOptions" } // delivers and clears the accumulated set; halts
  /** Records a line-group item as a saliency candidate (ticket 47): pops the
   *  item's evaluated condition (upstream AddSaliencyCandidate). */
  | { op: "addSaliencyCandidate"; contentId: string; complexity: number; destination: number }
  /** Asks the saliency strategy to pick from the accumulated candidates
   *  (upstream SelectSaliencyCandidate): pushes the destination and `true`
   *  when content was selected, or `false` when none was. */
  | { op: "selectSaliencyCandidate" }
  /** Pops the selected candidate's destination and jumps to it (upstream
   *  Pop + PeekAndJump after a selection). */
  | { op: "popJump" }
  // Stack: literals and variables.
  | { op: "pushString"; value: string }
  | { op: "pushNumber"; value: number }
  | { op: "pushBool"; value: boolean }
  | { op: "pushNull" }
  | { op: "pushVariable"; name: string } // unset names push undefined (the evaluator's unset contract)
  | { op: "popVariable"; name: string } // pops into the variable
  // Functions: pops `argc` operands, pushes the result.
  | { op: "callFunction"; name: string; argc: number }
  // Arithmetic (stack semantics: `add` concatenates when either operand is
  // a string, rendering operands the upstream way; the numeric ops coerce
  // to numbers).
  | { op: "add" }
  | { op: "subtract" }
  | { op: "multiply" }
  | { op: "divide" }
  | { op: "modulo" }
  | { op: "negate" }
  // Comparison (equality uses the evaluator's deep-equality contract,
  // including unset-variable defaults).
  | { op: "equalTo" }
  | { op: "notEqualTo" }
  | { op: "lessThan" }
  | { op: "greaterThan" }
  | { op: "lessThanOrEqualTo" }
  | { op: "greaterThanOrEqualTo" }
  // Logic (both operands are evaluated; results are boolean).
  | { op: "and" }
  | { op: "or" }
  | { op: "not" };
