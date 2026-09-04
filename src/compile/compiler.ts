// SPDX-License-Identifier: CC0-1.0
/**
 * The compiler: AST → instruction-stream program (ADR 0001, ADR 0003).
 *
 * The tree-shaped IR is retired: the compiler walks the parsed
 * statements and emits per-node instruction streams directly, with jumps
 * and option destinations as instruction indices whose labels are resolved
 * in the label pass (NodeLowering) before the program is handed out.
 *
 * Lowering contract (pinned by the golden assertions in
 * src/tests/bytecode.test.ts and the conformance corpus):
 * - lines and commands keep their authored text (`runLine`/`runCommand`);
 *   the runtime line parser owns `{expr}` substitutions and markup
 *   (upstream's compiler/runtime split). Only condition and assignment
 *   expressions compile to bytecode;
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
 * - once-state (`<<once>>` blocks, line/option `<<once>>` modifiers) is
 *   read/written with plain variable ops against generated-variable keys
 *   (coding standards §4; upstream `$Yarn.Internal.Once.<lineID>` — no
 *   dedicated block op). A once option's availability is `not(seen)` ANDed
 *   with its condition, and the flag stores when the option is selected
 *   (the store is the first instruction of the option's body) — upstream
 *   once-option semantics exactly;
 * - line-level conditions (`<<if>>`/`<<once>>`/`<<once if>>`) gate the
 *   `runLine` with `jumpIfFalse` over the same generated-variable reads;
 * - line groups lower per item to an availability condition +
 *   `addSaliencyCandidate` (the condition or `pushBool true`; a `once`
 *   marker becomes a seen-check ANDed in, upstream BLRV-excluded once the
 *   flag is set), a body destination, and — after the last item —
 *   `selectSaliencyCandidate` + `popJump` (upstream's
 *   SelectSaliencyCandidate + PopJump: the strategy picks, the selected
 *   item's body runs, non-selections jump past; an all-fail group runs
 *   nothing). A selected `once` item's flag stores at its body start;
 * - `jump`/`detour` become `runNode`/`detour` (node names; `{expr}` targets
 *   stay strings the VM resolves at execution);
 * - headers (`when`, `scene`, `tracking`, `subtitle`) and node-group
 *   structure carry over verbatim. A member's `subtitle:` qualifies its
 *   visit-tracking key (`Title.Subtitle`, upstream node-group naming).
 *
 * Codegen failure fallbacks keep observable behavior identical to the
 * string evaluator: an uncompilable condition emits `pushBool false` (the
 * evaluator's catch → false); an uncompilable `<<set>>` expression keeps
 * the raw `runCommand` so the runtime's error handling applies unchanged;
 * an uncompilable initializer emits `pushNull`.
 */

import type { YarnDocument, YarnNode, Statement, Line, LineGroup, OnceBlock } from "../model/ast";import type { Instruction, Program, ProgramNode } from "./program.js";
import { programLanguageVersion } from "./program.js";
import { compileExpression, ExpressionCodegenError } from "./expressionCodegen.js";
import { onceVariableKey } from "../runtime/generatedVariables.js";
import { booleanOperatorCount } from "../runtime/saliency.js";
import { parseCommand, type ParsedCommand } from "../runtime/commands.js";
import { isSmartVariableInitializer } from "./smartVariables.js";
import { compoundOperatorToStackOp, parseStateStatement } from "../parse/stateStatement.js";
import { buildEnumTypes, collectEnumBlocks } from "./enums.js";
import type { EnumType } from "./enums.js";

/**
 * Group nodes by title: titles by first occurrence, members in document
 * order. The lowering walks this grouping so node-group members lower
 * together.
 */
function groupNodesByTitle(docs: YarnDocument[]): Map<string, YarnNode[]> {
  const nodesByTitle = new Map<string, YarnNode[]>();
  for (const doc of docs) {
    for (const node of doc.nodes) {
      if (!nodesByTitle.has(node.title)) nodesByTitle.set(node.title, []);
      nodesByTitle.get(node.title)!.push(node);
    }
  }
  return nodesByTitle;
}

/** Extract the tracking: header (visit-tracking mode) from node headers. */
function trackingHeader(headers: Record<string, string>): "always" | "never" | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "tracking") {
      const v = value.trim().toLowerCase();
      if (v === "always" || v === "never") return v;
    }
  }
  return undefined;
}

/** Extract the subtitle: header (node-group member identity) from node headers. */
function subtitleHeader(headers: Record<string, string>): string | undefined {
  const subtitle = headers["subtitle"]?.trim();
  return subtitle ? subtitle : undefined;
}

export interface CompileDocumentOptions {
  generateOnceIds?: (ctx: { node: string; index: number }) => string;
  /**
   * Pre-validated enum types (from the type-checking pass). When omitted,
   * the program's `<<enum>>` blocks are resolved best-effort without
   * diagnostics (the compile seam owns diagnostics).
   */
  enumTypes?: Map<string, EnumType>;
}

/**
 * Internal invariant guard for the label pass: raised when a label was
 * referenced but never placed. Unreachable by construction — every
 * reference is created by the same `NodeLowering` instance that places the
 * label — so this fails fast if future edits break the invariant.
 * `compileSource` contains it at the seam (coding standards §3).
 */
export class LoweringError extends Error {}

export function compileDocument(doc: YarnDocument, opts: CompileDocumentOptions = {}): Program {
  // Enum registry: enum name → case name → raw value. The type checker
  // (compileSource) passes validated types; standalone compile() resolves
  // the document's <<enum>> blocks without diagnostics.
  const enumTypes = opts.enumTypes ?? buildEnumTypes(collectEnumBlocks(doc), [], () => {});
  const enums: Program["enums"] = {};
  for (const [name, type] of enumTypes) {
    enums[name] = Object.fromEntries(type.cases.map((c) => [c.name, c.rawValue]));
  }

  const genOnce = opts.generateOnceIds ?? ((x) => `${x.node}#once#${x.index}`);
  let globalLineCounter = 0;
  /**
   * Assign the line's `line:` ID. The string-table pass writes
   * every implicit ID into the AST before lowering, so this finds the tag
   * already in place; the counter fallback only fires for lines that bailed
   * registration (YS0017/YS0062) — the compile carries error diagnostics
   * there, and the program still needs a stable ID to lower.
   */
  const ensureLineId = (tags?: string[]): { tags: string[] | undefined; lineId: string } => {
    const t = tags ? [...tags] : [];
    const existing = t.find((x) => x.startsWith("line:"));
    if (existing) return { tags: t, lineId: existing };
    const lineId = `line:${(globalLineCounter++).toString(16)}`;
    t.push(lineId);
    return { tags: t, lineId };
  };

  const initialValues: Program["initialValues"] = {};
  const smartVariables: Program["smartVariables"] = {};

  // Group nodes by title to handle node groups. Shared with the string
  // table's ID-assignment pass (compileSource) so both observe the same
  // node order — the golden bytecode assertions pin the resulting tag order.
  const nodesByTitle = groupNodesByTitle([doc]);

  const nodes: Program["nodes"] = {};
  for (const [title, nodesWithSameTitle] of nodesByTitle) {
    if (nodesWithSameTitle.length === 1 && !nodesWithSameTitle[0].when) {
      nodes[title] = lowerNode(nodesWithSameTitle[0], { enums, ensureLineId, genOnce, initialValues, smartVariables });
    } else {
      // A single node with `when:` headers is a one-member node group
      // (upstream: the NodeGroupVisitor processes any node with when:
      // headers, so it gets the hub/selection machinery too).
      nodes[title] = {
        title,
        nodes: nodesWithSameTitle.map((node) =>
          lowerNode(node, { enums, ensureLineId, genOnce, initialValues, smartVariables }),
        ),
      };
    }
  }

  // Implicit declarations (upstream Compiler.cs: an undeclared variable used
  // in a Boolean-constrained context is implicitly declared with the type's
  // default — here the bare-condition slice the corpus requires).
  const implicitBools = new Set<string>();
  for (const node of doc.nodes) {
    for (const raw of node.when ?? []) {
      const name = bareConditionVariable(raw);
      if (name) implicitBools.add(name);
    }
    collectImplicitConditionVariables(node.body, implicitBools);
  }
  for (const name of implicitBools) {
    if (!(name in initialValues) && !(name in smartVariables)) {
      initialValues[name] = [{ op: "pushBool", value: false }];
    }
  }

  return {
    languageVersion: programLanguageVersion,
    enums,
    nodes,
    initialValues,
    smartVariables,
  };
}

/** A bare boolean condition: `$var`, optionally `not`-wrapped. */
function bareConditionVariable(condition: string | undefined): string | null {
  if (condition === undefined) return null;
  const m = condition.trim().match(/^(?:not\s+)?\$([A-Za-z_][A-Za-z0-9_]*)$/);
  return m ? m[1] : null;
}

/**
 * Collect the variables that appear as bare boolean conditions — `<<if>>`/
 * `<<once if>>` conditions, option conditions, and `<<if>>` block branches
 * whose expression is just `$var` (optionally `not`-wrapped).
 */
function collectImplicitConditionVariables(stmts: Statement[], into: Set<string>): void {
  const addBare = (condition: string | undefined): void => {
    const name = bareConditionVariable(condition);
    if (name) into.add(name);
  };
  for (const s of stmts) {
    switch (s.type) {
      case "Line":
        addBare(s.condition);
        addBare(s.once?.condition);
        break;
      case "Command":
        break;
      case "OptionGroup":
        for (const o of s.options) {
          addBare(o.condition);
          addBare(o.once?.condition);
          collectImplicitConditionVariables(o.body, into);
        }
        break;
      case "LineGroup":
        for (const item of s.items) {
          addBare(item.condition);
          addBare(item.once?.condition);
        }
        break;
      case "If":
        for (const b of s.branches) {
          addBare(b.condition ?? undefined);
          collectImplicitConditionVariables(b.body, into);
        }
        break;
      case "Once":
        addBare(s.condition);
        collectImplicitConditionVariables(s.body, into);
        if (s.elseBody) collectImplicitConditionVariables(s.elseBody, into);
        break;
      case "Jump":
      case "Detour":
      case "Enum":
        break;
    }
  }
}

/** Lowering context threaded through one compile() run. */
interface LoweringContext {
  enums: Program["enums"];
  ensureLineId: (tags?: string[]) => { tags: string[] | undefined; lineId: string };
  genOnce: (ctx: { node: string; index: number }) => string;
  initialValues: Program["initialValues"];
  smartVariables: Program["smartVariables"];
}

/**
 * Compile an expression, or `null` when it cannot compile (context picks
 * the fallback).
 */
function tryCompile(expr: string, enums: Program["enums"]): Instruction[] | null {
  try {
    return compileExpression(expr, enums);
  } catch (e) {
    if (e instanceof ExpressionCodegenError) return null;
    throw e;
  }
}

/**
 * Compile a condition, falling back to `pushBool false` — the evaluator's
 * catch → false is the observable contract for uncompilable conditions.
 */
function compileCondition(condition: string, enums: Program["enums"]): Instruction[] {
  return tryCompile(condition, enums) ?? [{ op: "pushBool", value: false }];
}

/**
 * The once-gate code shape (upstream once modifiers): read the once flag,
 * invert it, and — when the modifier is conditional — AND the condition in.
 * Availability/gating = `not(seen) [AND condition]`.
 */
function onceGate(onceKey: string, condition: string | undefined, enums: Program["enums"]): Instruction[] {
  const gate: Instruction[] = [{ op: "pushVariable", name: onceKey }, { op: "not" }];
  if (condition !== undefined) {
    gate.push(...compileCondition(condition, enums), { op: "and" });
  }
  return gate;
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

  /** Emit `addSaliencyCandidate` with a label destination (resolved at
   *  `resolve` time) — the line-group candidate record. */
  addSaliencyCandidate(contentId: string, complexity: number, label: string): void {
    this.refs.push({ at: this.instructions.length, key: "destination", label });
    this.instructions.push({ op: "addSaliencyCandidate", contentId, complexity, destination: -1 });
  }

  /** Compile a condition and branch on it (pops the condition). */
  branchOn(condition: string, enums: Program["enums"], label: string): void {
    const code = compileCondition(condition, enums);
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

function lowerNode(
  node: YarnNode,
  ctx: LoweringContext,
): ProgramNode {
  const lowering = new NodeLowering();
  let onceCounter = 0;
  const counters: NodeCounters = {
    once: () => ctx.genOnce({ node: node.title, index: onceCounter++ }),
  };
  lowerStatements(node.body, lowering, ctx, counters);
  const result: ProgramNode = { title: node.title, instructions: lowering.resolve() };
  if (node.when) result.when = node.when;
  if (node.headers.scene?.trim()) result.scene = node.headers.scene.trim();
  const tracking = trackingHeader(node.headers);
  if (tracking) result.tracking = tracking;
  const subtitle = subtitleHeader(node.headers);
  if (subtitle) result.subtitle = subtitle;
  collectInitialValues(node.body, ctx);
  return result;
}

/** Per-node lowering counters (only the once-block counter today). */
interface NodeCounters {
  once: () => string;
}

function lowerStatements(
  stmts: Statement[],
  lowering: NodeLowering,
  ctx: LoweringContext,
  counters: NodeCounters,
): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Line":
        lowerLine(s, lowering, ctx);
        break;
      case "Command":
        lowerCommand(s.content, lowering, ctx.enums);
        break;
      case "Jump":
        lowering.instructions.push({ op: "runNode", node: s.target });
        break;
      case "Detour":
        lowering.instructions.push({ op: "detour", node: s.target });
        break;
      case "OptionGroup":
        lowerOptions(s, lowering, ctx, counters);
        break;
      case "LineGroup":
        lowerLineGroup(s, lowering, ctx);
        break;
      case "If": {
        const end = lowering.newLabel();
        for (let i = 0; i < s.branches.length; i++) {
          const branch = s.branches[i];
          const isLast = i === s.branches.length - 1;
          let next: string | null = null;
          if (branch.condition !== null) {
            next = isLast ? end : lowering.newLabel();
            lowering.branchOn(branch.condition, ctx.enums, next);
          }
          lowerStatements(branch.body, lowering, ctx, counters);
          if (!isLast) lowering.jump("jumpTo", end);
          if (next && !isLast) lowering.place(next);
        }
        lowering.place(end);
        break;
      }
      case "Once":
        lowerOnce(s, lowering, ctx, counters);
        break;
      case "Enum":
        // Enums are metadata, skip during compilation (already stored in program.enums)
        break;
    }
  }
}

/**
 * Lower a line: the `runLine` keeps authored text; a line-level
 * `<<if>>`/`<<once>>`/`<<once if>>` gates it with `jumpIfFalse` over the
 * condition/once-state bytecode, and the once flag stores when the line
 * actually runs (upstream: the store sits just before the RunLine).
 */
function lowerLine(line: Line, lowering: NodeLowering, ctx: LoweringContext): void {
  const { tags, lineId } = ctx.ensureLineId(line.tags);
  const onceKey = line.once ? onceVariableKey(lineId) : null;
  const gate: Instruction[] = [];
  if (onceKey) {
    gate.push(...onceGate(onceKey, line.once?.condition, ctx.enums));
  } else if (line.condition !== undefined) {
    gate.push(...compileCondition(line.condition, ctx.enums));
  }
  const emitRunLine = (): void => {
    const runLine: { op: "runLine"; text: string; tags?: string[] } = {
      op: "runLine",
      text: line.text,
    };
    if (tags !== undefined) runLine.tags = tags;
    lowering.instructions.push(runLine);
  };
  if (gate.length > 0) {
    const end = lowering.newLabel();
    lowering.instructions.push(...gate);
    lowering.jump("jumpIfFalse", end);
    if (onceKey) {
      lowering.instructions.push({ op: "pushBool", value: true }, { op: "popVariable", name: onceKey });
    }
    emitRunLine();
    lowering.place(end);
    return;
  }
  emitRunLine();
}

/**
 * Lower a line group (upstream `VisitLine_group_statement`): each
 * item evaluates its `<<if>>`/`<<once>>`/`<<once if>>` gate (or pushes true)
 * and records a saliency candidate with its complexity score (a `once`
 * marker adds 1; an expression adds its boolean-operator count + 1); the
 * strategy then picks — the selected item's body stores its once flag (the
 * store is the body's first instruction, like a once option) and runs the
 * line; no selection skips the whole group.
 */
function lowerLineGroup(
  group: LineGroup,
  lowering: NodeLowering,
  ctx: LoweringContext,
): void {
  const end = lowering.newLabel();
  const prepared = group.items.map((item) => {
    const { tags, lineId } = ctx.ensureLineId(item.tags);
    const onceKey = item.once ? onceVariableKey(lineId) : null;
    let gate: Instruction[];
    if (onceKey) {
      gate = onceGate(onceKey, item.once?.condition, ctx.enums);
    } else if (item.condition !== undefined) {
      gate = compileCondition(item.condition, ctx.enums);
    } else {
      gate = [{ op: "pushBool", value: true }];
    }
    // Upstream ConditionCount: the once marker adds 1; the expression adds
    // its boolean-operator count + 1.
    const expression = item.once?.condition ?? item.condition;
    const complexity =
      (item.once ? 1 : 0) + (expression !== undefined ? booleanOperatorCount(expression) + 1 : 0);
    return { item, tags, lineId, onceKey, gate, complexity };
  });
  const bodies = prepared.map(() => lowering.newLabel());
  prepared.forEach((p, i) => {
    lowering.instructions.push(...p.gate);
    lowering.addSaliencyCandidate(p.lineId, p.complexity, bodies[i]);
  });
  lowering.instructions.push({ op: "selectSaliencyCandidate" });
  lowering.jump("jumpIfFalse", end);
  lowering.instructions.push({ op: "popJump" });
  prepared.forEach((p, i) => {
    lowering.place(bodies[i]);
    if (p.onceKey) {
      lowering.instructions.push({ op: "pushBool", value: true }, { op: "popVariable", name: p.onceKey });
    }
    lowerLineBody(p.item, p.tags, lowering);
    lowering.jump("jumpTo", end);
  });
  lowering.place(end);
}

/**
 * Lower a plain line (no gating): the `runLine` keeps its authored text,
 * speaker, tags, and markup.
 */
function lowerLineBody(line: Line, tags: string[] | undefined, lowering: NodeLowering): void {
  const runLine: { op: "runLine"; text: string; tags?: string[] } = {
    op: "runLine",
    text: line.text,
  };
  if (tags !== undefined) runLine.tags = tags;
  lowering.instructions.push(runLine);
}

function lowerOptions(
  group: Extract<Statement, { type: "OptionGroup" }>,
  lowering: NodeLowering,
  ctx: LoweringContext,
  counters: NodeCounters,
): void {
  // Add #lastline tag to the most recent line, if present (the fork-era
  // tagging kept for behavioral parity).
  for (let i = lowering.instructions.length - 1; i >= 0; i--) {
    const ins = lowering.instructions[i];
    if (ins.op === "runLine") {
      const tags = new Set(ins.tags ?? []);
      if (![...tags].some((x) => x === "lastline" || x === "#lastline")) {
        tags.add("lastline");
      }
      ins.tags = Array.from(tags);
      break;
    }
    if (ins.op !== "runCommand") break; // stop if non-line non-command before options
  }

  const end = lowering.newLabel();
  const bodies = group.options.map(() => lowering.newLabel());
  // One availability push + addOption per option, in authored order:
  // `addOption` pops the availability (upstream AddOption), so the set
  // assembles whole and `showOptions` delivers every option with its own
  // isAvailable flag.
  const prepared = group.options.map((option, i) => {
    const { tags, lineId } = ctx.ensureLineId(option.tags);
    const once = option.once;
    const onceKey = once ? onceVariableKey(lineId) : null;
    let availability: Instruction[];
    if (onceKey) {
      // A once option is available while its flag is unset — upstream
      // compiles `not(<onceVar>)` ANDed with the option's condition.
      availability = onceGate(onceKey, once?.condition ?? option.condition, ctx.enums);
    } else if (option.condition !== undefined) {
      availability = compileCondition(option.condition, ctx.enums);
    } else {
      availability = [{ op: "pushBool", value: true }];
    }
    return { option, tags, onceKey, availability, label: bodies[i] };
  });
  for (const p of prepared) {
    lowering.instructions.push(...p.availability);
    lowering.addOption(p.option.text, p.tags, p.label);
  }
  lowering.instructions.push({ op: "showOptions" });
  lowering.jump("jumpTo", end);
  // The inline bodies, each continuing after the options block. A once
  // option's flag stores at the body's start (upstream: the store sits at
  // the option's jump destination — selection is what marks it seen).
  for (const p of prepared) {
    lowering.place(p.label);
    if (p.onceKey) {
      lowering.instructions.push({ op: "pushBool", value: true }, { op: "popVariable", name: p.onceKey });
    }
    lowerStatements(p.option.body, lowering, ctx, counters);
    lowering.jump("jumpTo", end);
  }
  lowering.place(end);
}

/**
 * Lower a `<<once>>`/`<<once if expr>>` block with optional `<<else>>`:
 * the gate is the once-state (AND the condition, when present); the flag
 * stores when the body runs; the else body runs when the gate fails.
 */
function lowerOnce(
  block: OnceBlock,
  lowering: NodeLowering,
  ctx: LoweringContext,
  counters: NodeCounters,
): void {
  const key = onceVariableKey(counters.once());
  const end = lowering.newLabel();
  const elseLabel = block.elseBody ? lowering.newLabel() : end;
  if (block.condition !== undefined) {
    // Gate: not(seen) AND condition — the once-if semantics.
    lowering.instructions.push(...onceGate(key, block.condition, ctx.enums));
    lowering.jump("jumpIfFalse", elseLabel);
  } else {
    lowering.instructions.push({ op: "pushVariable", name: key });
    lowering.jump("jumpIfTrue", elseLabel);
  }
  lowering.instructions.push({ op: "pushBool", value: true }, { op: "popVariable", name: key });
  lowerStatements(block.body, lowering, ctx, counters);
  if (block.elseBody) {
    lowering.jump("jumpTo", end);
    lowering.place(elseLabel);
    lowerStatements(block.elseBody, lowering, ctx, counters);
  }
  lowering.place(end);
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
    const code = lowerSet(content, enums);
    if (code) {
      lowering.instructions.push(...code);
      return;
    }
    // An uncompilable set keeps the raw command: the VM's command dispatch
    // then reproduces the runtime's error handling for it.
    lowering.instructions.push({ op: "runCommand", content });
    return;
  }
  if (name === "declare") {
    // Declares hoist to the program's compiled initialValues (upstream:
    // declares compile to no instruction); collectInitialValues gathered
    // them during the node walk.
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
  // them exactly as upstream's RunCommand does.
  lowering.instructions.push({ op: "runCommand", content });
}

/**
 * Lower `<<set $var (to|=) expr>>` / compound assignment to read/operate/
 * write bytecode over the shared state-statement parse (the runtime's set
 * handler consumes the same module — one grammar, no lockstep prose).
 * Returns `null` when the expression cannot compile (the caller keeps the
 * raw command).
 */
function lowerSet(content: string, enums: Program["enums"]): Instruction[] | null {
  const statement = parseStateStatement(content);
  if (statement?.kind !== "set" || statement.expression === "") return null;
  const { name: key, compoundOp, expression } = statement;

  if (compoundOp) {
    const rhs = tryCompile(expression, enums);
    if (!rhs) return null;
    return [
      { op: "pushVariable", name: key },
      ...rhs,
      { op: compoundOperatorToStackOp(compoundOp) } as Instruction,
      { op: "popVariable", name: key },
    ];
  }

  const value = tryCompile(expression, enums);
  if (!value) return null;
  return [...value, { op: "popVariable", name: key }];
}

// ── Declarations collection ──────────────────────────────────────────────

/**
 * Collect `<<declare $var = expr>>` commands from a statement tree, splitting
 * them by kind: smart variables (initializer that is not a plain
 * literal — upstream "inline expansion") go into `program.smartVariables`
 * with their compiled initializer; stored declarations go into
 * `program.initialValues` (upstream `Program.InitialValues`) as compiled
 * bytecode the VM evaluates at start-up. First declaration wins — duplicate
 * declarations are a compile-time concern the diagnostics channel owns.
 */
function collectInitialValues(stmts: Statement[], ctx: LoweringContext): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Command": {
        const declare = parseStateStatement((s as { content: string }).content);
        if (declare?.kind === "declare") {
          const compiled =
            tryCompile(declare.expression, ctx.enums) ?? [{ op: "pushNull" } as Instruction];
          if (isSmartVariableInitializer(declare.expression)) {
            if (!(declare.name in ctx.smartVariables)) ctx.smartVariables[declare.name] = compiled;
          } else if (!(declare.name in ctx.initialValues)) {
            ctx.initialValues[declare.name] = compiled;
          }
        }
        break;
      }
      case "If":
        for (const b of s.branches) collectInitialValues(b.body, ctx);
        break;
      case "Once":
        collectInitialValues(s.body, ctx);
        if (s.elseBody) collectInitialValues(s.elseBody, ctx);
        break;
      case "OptionGroup":
        for (const o of s.options) collectInitialValues(o.body, ctx);
        break;
    }
  }
}
