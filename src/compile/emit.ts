/**
 * The program lowering pass (ADR 0001): the tree IR retargets to the
 * instruction-stream program — every construct flattens into per-node
 * instruction streams whose jumps reference instruction indices, with the
 * labels resolved in this pass before the program is handed out.
 *
 * Lowering contract (pinned by the golden assertions in
 * src/tests/bytecode.test.ts):
 * - `line`/`command` → `runLine`/`runCommand` (commands keep authored text;
 *   the VM dispatches them exactly as the tree-IR runtime does today);
 * - `<<set>>` compiles to expression bytecode plus `popVariable` (compound
 *   assignment expands to read/operate/write); `<<declare>>` compiles to no
 *   instruction — its initializer lives in the program's `initialValues`
 *   (upstream compiles declares to no instruction too); `<<stop>>`/
 *   `<<return>>` become dedicated ops; everything else (`<<call>>`, custom
 *   commands) stays a `runCommand`;
 * - `if` chains lower to condition bytecode + `jumpIfFalse` over each
 *   branch, with `jumpTo` threading past earlier branches;
 * - option groups lower to one availability push + `addOption` per option
 *   (the compiled condition, or `pushBool true` when none; `addOption`
 *   pops the flag as the option's `isAvailable`, mirroring upstream's
 *   AddOption — the set assembles whole and `showOptions` delivers it with
 *   per-option availability flags), one `showOptions`, and the inline
 *   bodies each ending in a `jumpTo` past the construct — selection runs
 *   the body and resumes after the options block; the no-option-selected
 *   fall-through is the pc after `showOptions`. Nested groups work because
 *   `showOptions` delivers and clears the accumulated set;
 * - `once` lowers to generated-variable reads/writes (no dedicated block
 *   op; coding standards §4) using the shared key contract in
 *   runtime/generatedVariables.ts;
 * - `jump`/`detour` become `runNode`/`detour` (node names; `{expr}` targets
 *   stay strings the VM resolves);
 * - headers (`when`, `scene`, `tracking`) and node-group structure carry
 *   over verbatim.
 *
 * Codegen failure fallbacks keep observable behavior identical to the
 * string evaluator: an uncompilable condition emits `pushBool false` (the
 * evaluator's catch → false); an uncompilable `<<set>>` expression keeps
 * the raw `runCommand` so the runtime's error handling applies unchanged;
 * an uncompilable smart-variable initializer emits `pushNull`.
 */

import type { IRNode, IRProgram, IRInstruction } from "./ir.js";
import type { Instruction, Program, ProgramNode } from "./program.js";
import { programLanguageVersion } from "./program.js";
import { compileExpression, ExpressionCodegenError } from "./expressionCodegen.js";
import { onceVariableKey } from "../runtime/generatedVariables.js";
import { parseCommand, type ParsedCommand } from "../runtime/commands.js";
import { parseDeclareCommand } from "./smartVariables.js";

/**
 * Internal invariant guard for the label pass: raised when a label was
 * referenced but never placed. Unreachable by construction — every
 * reference is created by the same `NodeLowering` instance that places the
 * label — so this fails fast if future edits break the invariant.
 * `compileSource` contains it at the seam (coding standards §3).
 */
export class LoweringError extends Error {}

export function emitProgram(program: IRProgram): Program {
  const enums: Program["enums"] = { ...program.enums };
  const nodes: Record<string, ProgramNode | { title: string; nodes: ProgramNode[] }> = {};
  for (const [title, nodeOrGroup] of Object.entries(program.nodes)) {
    nodes[title] =
      "nodes" in nodeOrGroup
        ? { title, nodes: nodeOrGroup.nodes.map((node) => lowerNode(node, enums)) }
        : lowerNode(nodeOrGroup, enums);
  }

  const initialValues: Record<string, Instruction[]> = {};
  for (const [name, content] of Object.entries(program.initialValues)) {
    // The tree IR stores the full `<<declare>>` content; the expression is
    // what compiles (the `as Type` postfix is compile metadata).
    const declare = parseDeclareCommand(content);
    initialValues[name] = (declare && tryCompile(declare.expression, enums)) ?? [
      { op: "pushNull" },
    ];
  }

  const smartVariables: Record<string, Instruction[]> = {};
  for (const [name, expression] of Object.entries(program.smartVariables)) {
    smartVariables[name] = tryCompile(expression, enums) ?? [{ op: "pushNull" }];
  }

  return {
    languageVersion: programLanguageVersion,
    enums,
    nodes,
    initialValues,
    smartVariables,
  };
}

/** Compile an expression, or `null` when it cannot compile (context picks the fallback). */
function tryCompile(expr: string, enums: Program["enums"]): Instruction[] | null {
  try {
    return compileExpression(expr, enums);
  } catch (e) {
    if (e instanceof ExpressionCodegenError) return null;
    throw e;
  }
}

// ── Per-node lowering ────────────────────────────────────────────────────

/**
 * One node's lowering context: instructions accumulate with label
 * placeholders; `place` records a label's instruction index and `resolve`
 * patches the recorded references. Indices are intra-node, so resolution
 * completes within the node.
 */
class NodeLowering {
  readonly instructions: Instruction[] = [];
  private readonly labels = new Map<string, number>();
  private readonly refs: Array<{ at: number; key: "index" | "destination"; label: string }> = [];
  private labelCounter = 0;

  newLabel(): string {
    return `L${this.labelCounter++}`;
  }

  place(label: string): void {
    this.labels.set(label, this.instructions.length);
  }

  /** Emit a jump to a label (resolved at `resolve` time). */
  jump(op: "jumpTo" | "jumpIfFalse" | "jumpIfTrue", label: string): void {
    this.refs.push({ at: this.instructions.length, key: "index", label });
    this.instructions.push({ op, index: -1 });
  }

  /** Emit `addOption` with a label destination (resolved at `resolve` time). */
  addOption(text: string, tags: string[] | undefined, label: string): void {
    this.refs.push({ at: this.instructions.length, key: "destination", label });
    this.instructions.push(
      tags
        ? { op: "addOption", text, tags, destination: -1 }
        : { op: "addOption", text, destination: -1 },
    );
  }

  /** Compile a condition and branch on it (pops the condition). */
  branchOn(condition: string, enums: Program["enums"], label: string): void {
    // The evaluator's catch → false is the observable contract for
    // uncompilable conditions; `pushBool false` reproduces it exactly.
    const code = tryCompile(condition, enums) ?? [{ op: "pushBool", value: false }];
    this.instructions.push(...code);
    this.jump("jumpIfFalse", label);
  }

  resolve(): Instruction[] {
    for (const ref of this.refs) {
      const index = this.labels.get(ref.label);
      if (index === undefined) {
        throw new LoweringError(`Unresolved label "${ref.label}" in the lowering pass`);
      }
      (this.instructions[ref.at] as unknown as Record<string, number>)[ref.key] = index;
    }
    return this.instructions;
  }
}

function lowerNode(node: IRNode, enums: Program["enums"]): ProgramNode {
  const lowering = new NodeLowering();
  lowerInstructions(node.instructions, lowering, enums);
  const result: ProgramNode = { title: node.title, instructions: lowering.resolve() };
  if (node.when) result.when = node.when;
  if (node.scene) result.scene = node.scene;
  if (node.tracking) result.tracking = node.tracking;
  return result;
}

function lowerInstructions(
  irInstructions: IRInstruction[],
  lowering: NodeLowering,
  enums: Program["enums"],
): void {
  for (const ins of irInstructions) {
    switch (ins.op) {
      case "line": {
        const line: { op: "runLine"; text: string; speaker?: string; tags?: string[] } = {
          op: "runLine",
          text: ins.text,
        };
        if (ins.speaker !== undefined) line.speaker = ins.speaker;
        if (ins.tags !== undefined) line.tags = ins.tags;
        lowering.instructions.push(line);
        break;
      }
      case "command":
        lowerCommand(ins.content, lowering, enums);
        break;
      case "jump":
        lowering.instructions.push({ op: "runNode", node: ins.target });
        break;
      case "detour":
        lowering.instructions.push({ op: "detour", node: ins.target });
        break;
      case "if": {
        const end = lowering.newLabel();
        for (let i = 0; i < ins.branches.length; i++) {
          const branch = ins.branches[i];
          const isLast = i === ins.branches.length - 1;
          let next: string | null = null;
          if (branch.condition !== null) {
            next = isLast ? end : lowering.newLabel();
            lowering.branchOn(branch.condition, enums, next);
          }
          lowerInstructions(branch.block, lowering, enums);
          if (!isLast) lowering.jump("jumpTo", end);
          if (next && !isLast) lowering.place(next);
        }
        lowering.place(end);
        break;
      }
      case "options": {
        const end = lowering.newLabel();
        const bodies = ins.options.map(() => lowering.newLabel());
        // One availability push + addOption per option, in authored order:
        // `addOption` pops the availability (upstream AddOption), so the
        // set assembles whole and `showOptions` delivers every option with
        // its own isAvailable flag. An uncompilable condition keeps the
        // evaluator's catch→false contract: the option is unavailable.
        for (let i = 0; i < ins.options.length; i++) {
          const option = ins.options[i];
          const available: Instruction[] =
            option.condition != null
              ? (tryCompile(option.condition, enums) ?? [{ op: "pushBool", value: false }])
              : [{ op: "pushBool", value: true }];
          lowering.instructions.push(...available);
          lowering.addOption(option.text, option.tags, bodies[i]);
        }
        lowering.instructions.push({ op: "showOptions" });
        lowering.jump("jumpTo", end);
        // The inline bodies, each continuing after the options block.
        for (let i = 0; i < ins.options.length; i++) {
          lowering.place(bodies[i]);
          lowerInstructions(ins.options[i].block, lowering, enums);
          lowering.jump("jumpTo", end);
        }
        lowering.place(end);
        break;
      }
      case "once": {
        const done = lowering.newLabel();
        const key = onceVariableKey(ins.id);
        lowering.instructions.push({ op: "pushVariable", name: key });
        lowering.jump("jumpIfTrue", done);
        lowering.instructions.push({ op: "pushBool", value: true });
        lowering.instructions.push({ op: "popVariable", name: key });
        lowerInstructions(ins.block, lowering, enums);
        lowering.place(done);
        break;
      }
    }
  }
}

function lowerCommand(content: string, lowering: NodeLowering, enums: Program["enums"]): void {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(content);
  } catch {
    lowering.instructions.push({ op: "runCommand", content });
    return;
  }
  const name = parsed.name.toLowerCase();
  if (name === "set") {
    const code = lowerSet(parsed, enums);
    if (code) {
      lowering.instructions.push(...code);
      return;
    }
    // An uncompilable set keeps the raw command: the VM's command dispatch
    // then reproduces today's runtime error handling for it.
    lowering.instructions.push({ op: "runCommand", content });
    return;
  }
  if (name === "declare") {
    // Declares hoist to the program's compiled initialValues (upstream:
    // declares compile to no instruction).
    return;
  }
  if (name === "stop") {
    lowering.instructions.push({ op: "stop" });
    return;
  }
  if (name === "return") {
    lowering.instructions.push({ op: "return" });
    return;
  }
  // <<call>> and custom commands keep authored text; the VM dispatches
  // them exactly as the tree-IR runtime does today (upstream RunCommand).
  lowering.instructions.push({ op: "runCommand", content });
}

/** Compound-assignment operator → the stack op that applies it. */
const COMPOUND_OPS: Record<string, Instruction["op"]> = {
  "+=": "add",
  "-=": "subtract",
  "*=": "multiply",
  "/=": "divide",
  "%=": "modulo",
};

/**
 * Lower `<<set $var (to|=) expr>>` / compound assignment to read/operate/
 * write bytecode, mirroring the runtime's set handler (the two shapes must
 * stay in lockstep until the tree IR retires and this pass becomes the
 * front-end). Returns `null` when the expression cannot compile (the
 * caller keeps the raw command).
 */
function lowerSet(parsed: ParsedCommand, enums: Program["enums"]): Instruction[] | null {
  const args = parsed.args;
  if (args.length < 2) return null;
  const key = args[0].startsWith("$") ? args[0].slice(1) : args[0];
  let exprParts = args.slice(1);
  if (exprParts[0] === "to") exprParts = exprParts.slice(1);
  if (exprParts[0] === "=") exprParts = exprParts.slice(1);
  if (exprParts.length === 0) return null;

  const compoundOp = COMPOUND_OPS[exprParts[0]];
  if (compoundOp) {
    const rhs = tryCompile(exprParts.slice(1).join(" "), enums);
    if (!rhs) return null;
    return [
      { op: "pushVariable", name: key },
      ...rhs,
      { op: compoundOp } as Instruction,
      { op: "popVariable", name: key },
    ];
  }

  const value = tryCompile(exprParts.join(" "), enums);
  if (!value) return null;
  return [...value, { op: "popVariable", name: key }];
}
