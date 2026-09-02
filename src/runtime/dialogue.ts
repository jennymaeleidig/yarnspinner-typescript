/**
 * The runtime (`Dialogue`): pull-based execution of a compiled program
 * (ADR 0002, ticket 43).
 *
 * During the VM transition (tickets 45–46) `Dialogue` dispatches by program
 * format: the instruction-stream program (ADR 0001/0003 bytecode — the
 * `VirtualMachine` in ./vm.js) or the transitional tree-IR program (the
 * `TreeIrRuntime` below). Both implement the identical public surface, so
 * consumers — and the conformance harness — drive either artifact through
 * the same API. Ticket 46 retires the tree-IR driver.
 *
 * Consumers drive dialogue on their own clock:
 * `continue()` returns the dialogue events up to the next stopping point —
 * a delivered line, command, or option set, or the end of the dialogue.
 * Selection resumes a delivered option set via `selectOption(index |
 * noOptionSelected)`; `setNode()` and `stop()` round out the API.
 *
 * Event vocabulary (camelCased; each mirrors its upstream counterpart):
 * `Line`, `Options`, `Command`, `NodeStart`, `NodeComplete`, opt-in
 * `LineHints` (upstream `PrepareForLines`), `DialogueComplete`.
 *
 * Semantics mirrored from upstream 3.2.2 (`Dialogue.cs`/`VirtualMachine.cs`):
 * - `NodeStart` fires when a node is entered (`setNode`, `jump`, detour);
 *   `NodeComplete` when a node is left (end, `jump`, `<<return>>`, `<<stop>>`).
 * - The delivered option set contains ALL options with `isAvailable` flags
 *   (availability is advisory for the consumer UI); selecting an index runs
 *   that option's body and then continues after the options block.
 * - `selectOption(noOptionSelected)` (-1, upstream `Dialogue.NoOptionSelected`)
 *   falls through: execution continues after the options block.
 * - State statements (`<<set>>`/`<<declare>>`/`<<call>>`) never surface as
 *   `Command` events — they are internal.
 * - Runtime failures are diagnostics, not throws: they surface through the
 *   `logError`/`logDebug` option callbacks (upstream `LogErrorMessage`/
 *   `LogDebugMessage`).
 *
 * Execution state (once-state, visit counts) lives as generated variables in
 * the variable storage (coding standards §4) — the engine below is stateless
 * across instances.
 */

import type { IRProgram, IRInstruction, IRNode, IRNodeGroup } from "../compile/ir.js";
import type { Program } from "../compile/program.js";
import { isInstructionStreamProgram } from "../compile/program.js";
import type { MarkupParseResult } from "../markup/types.js";
import { ExpressionEvaluator } from "./evaluator.js";
import { Library, type YarnFunction } from "./library.js";
import {
  parseCommand,
  executeStateStatement,
  stripQuotes,
  type ParsedCommand,
} from "./commands.js";
import { interpolate } from "./interpolate.js";
import { registerBuiltinFunctions } from "./builtins.js";
import {
  generatedVariablePrefix,
  groupOnceVariableKey,
  onceVariableKey,
  visitCountVariableKey,
} from "./generatedVariables.js";
import {
  defaultStartNodeName,
  noOptionSelected,
  type DialogueEvent,
  type DialogueOptions,
  type RuntimeDriver,
  lineIdFromTags,
} from "./events.js";
import { VirtualMachine } from "./vm.js";

export {
  defaultStartNodeName,
  noOptionSelected,
  type CommandEvent,
  type DialogueCompleteEvent,
  type DialogueEvent,
  type DialogueOption,
  type DialogueOptions,
  type LineEvent,
  type LineHintsEvent,
  type NodeCompleteEvent,
  type NodeStartEvent,
  type OptionsEvent,
} from "./events.js";
export { Library } from "./library.js";
export type { YarnFunction, CommandHandler } from "./library.js";

/**
 * A program the runtime executes: the instruction-stream artifact (ADR
 * 0001/0003) or — until ticket 46 retires it — the transitional tree IR.
 */
export type RuntimeProgram = IRProgram | Program;

/**
 * The runtime object that executes a program and yields dialogue events
 * (CONTEXT.md "Dialogue"). Dispatches by program format to the
 * instruction-stream VM or the transitional tree-IR driver; both deliver
 * the identical event stream.
 */
export class Dialogue {
  private readonly engine: RuntimeDriver;

  constructor(program: RuntimeProgram, opts: DialogueOptions = {}) {
    this.engine = isInstructionStreamProgram(program)
      ? new VirtualMachine(program, opts)
      : new TreeIrRuntime(program, opts);
  }

  /** The node currently executing, or `null` when the dialogue is not active. */
  get currentNode(): string | null {
    return this.engine.currentNode;
  }

  /** The `scene:` header of the current node, if any (adapter-side concern). */
  get currentScene(): string | undefined {
    return this.engine.currentScene;
  }

  /** Whether the dialogue is running a node (not yet completed). */
  get isActive(): boolean {
    return this.engine.isActive;
  }

  /** The registry of host functions and command handlers (including built-ins). */
  getLibrary(): Library {
    return this.engine.getLibrary();
  }

  /**
   * Run the program until the next stopping point and return the events
   * since the last stop: a delivered line, command, or option set — with
   * node lifecycle and (opt-in) line-hint events riding along — or the end
   * of the dialogue. Returns no events when the dialogue is not active.
   */
  continue(): DialogueEvent[] {
    return this.engine.continue();
  }

  /**
   * Resume a delivered option set: run the selected option's body and then
   * continue after the options block — or, with `noOptionSelected`, skip the
   * whole options block (fall-through). Mirrors upstream `SetSelectedOption`.
   */
  selectOption(selectedOption: number | typeof noOptionSelected): void {
    this.engine.selectOption(selectedOption);
  }

  /**
   * Enter the named node: execution state is reset and the node's events are
   * delivered by the next `continue()`. Variables, once-state, and visit
   * counts are preserved. An unknown node is a runtime diagnostic; the
   * dialogue's state is unchanged.
   */
  setNode(title: string): void {
    this.engine.setNode(title);
  }

  /**
   * Immediately stop the dialogue: execution state is discarded and the
   * dialogue-complete event is delivered by the next `continue()`
   * (upstream `Dialogue.Stop`).
   */
  stop(): void {
    this.engine.stop();
  }

  /** Snapshot of the story variables (the variable storage minus generated variables). */
  getVariables(): Readonly<Record<string, unknown>> {
    return this.engine.getVariables();
  }

  /**
   * Get a variable's value (upstream `Dialogue.TryGetVariable`: a smart
   * variable recomputes; a stored value wins when a host has shadowed it).
   */
  getVariable(name: string): unknown {
    return this.engine.getVariable(name);
  }

  /** Set a variable's value in storage. */
  setVariable(name: string, value: unknown): void {
    this.engine.setVariable(name, value);
  }

  /**
   * Upstream `Dialogue.TryGetSmartVariable`: compute a smart variable's
   * current value. Reports failure when the name is not a smart variable.
   */
  tryGetSmartVariable(name: string): { ok: true; value: unknown } | { ok: false } {
    return this.engine.tryGetSmartVariable(name);
  }
}

type CompiledOption = {
  text: string;
  tags?: string[];
  markup?: MarkupParseResult;
  condition?: string;
  block: IRInstruction[];
};

type Frame =
  | { kind: "detour"; title: string; ip: number; nodeIndex: number }
  | { kind: "block"; title: string; ip: number; nodeIndex: number; block: IRInstruction[]; idx: number };

/** Outcome of executing one command instruction. */
type CommandOutcome = "continued" | "delivered" | "halted";

/**
 * The transitional tree-IR execution driver (the fork-era engine): executes
 * the tree-shaped IR while the instruction-stream VM takes over (tickets
 * 45–46 retire this driver). Its observable behavior is pinned by the full
 * suite and the conformance corpus; shared machinery (built-ins, line
 * composition, state statements) lives in its own modules so both drivers
 * run one implementation.
 */
class TreeIrRuntime implements RuntimeDriver {
  private readonly program: IRProgram;
  private readonly variables: Record<string, unknown> = {};
  /** The runtime's library: built-ins + imported host entries. */
  private readonly library: Library;
  private readonly evaluator: ExpressionEvaluator;
  private readonly lineHintsEnabled: boolean;
  private readonly logError: (message: string) => void;
  private readonly logDebug: (message: string) => void;

  /** Events queued outside a `continue()` batch (by `setNode`/`stop`). */
  private queuedEvents: DialogueEvent[] = [];
  private nodeTitle: string | null = null;
  private ip = 0;
  private currentNodeIndex = -1; // Index of selected node in a group (-1 if single node)
  private callStack: Frame[] = [];
  /** The options statement awaiting selection (the full compiled set). */
  private pendingOptions: CompiledOption[] | null = null;
  private completed = false;

  constructor(program: IRProgram, opts: DialogueOptions = {}) {
    this.program = program;
    this.library = new Library();
    registerBuiltinFunctions(this.library, () => this.variables);
    if (opts.library) this.library.importLibrary(opts.library);
    this.lineHintsEnabled = opts.lineHints ?? false;
    this.logError = opts.logError ?? ((message) => console.error(message));
    this.logDebug = opts.logDebug ?? (() => {});
    this.evaluator = new ExpressionEvaluator(
      this.variables,
      {
        get: (name: string): YarnFunction | undefined =>
          this.library.hasFunction(name) ? this.library.getFunction(name) : undefined,
      },
      this.program.enums,
    );

    // Smart variables (ticket 42): the program carries the classified
    // `<<declare>>` initializers; register them so every read recomputes and
    // the runtime declare handler skips storing an initial value for them
    // (upstream: smart variables are not in Program.InitialValues).
    for (const [name, expression] of Object.entries(this.program.smartVariables ?? {})) {
      this.evaluator.setSmartVariable(name, () => this.evaluator.evaluateExpression(expression));
    }

    // Upstream Dialogue.SetProgram seeds the variable storage from
    // Program.InitialValues (the <<declare>>d defaults), so every declared
    // variable exists before the first node runs. Host-provided variables
    // are applied afterwards and override declared defaults.
    for (const content of Object.values(this.program.initialValues)) {
      this.executeStateStatement(content);
    }
    if (opts.variables) {
      for (const [key, value] of Object.entries(opts.variables)) {
        const normalizedKey = key.startsWith("$") ? key.slice(1) : key;
        this.variables[normalizedKey] = value;
        this.evaluator.setVariable(normalizedKey, value);
      }
    }

    const startAt = opts.startAt ?? defaultStartNodeName;
    if (!this.program.nodes[startAt]) {
      this.logError(`No node named "${startAt}" exists in the program`);
      this.complete();
      return;
    }
    this.enterNode(startAt, this.queuedEvents);
  }

  /** The node currently executing, or `null` when the dialogue is not active. */
  get currentNode(): string | null {
    return this.nodeTitle;
  }

  /** The `scene:` header of the current node, if any (adapter-side concern). */
  get currentScene(): string | undefined {
    if (!this.nodeTitle) return undefined;
    const nodeOrGroup = this.program.nodes[this.nodeTitle];
    if (!nodeOrGroup) return undefined;
    if ("nodes" in nodeOrGroup) {
      const member = this.currentNodeIndex >= 0 ? nodeOrGroup.nodes[this.currentNodeIndex] : undefined;
      return member?.scene;
    }
    return nodeOrGroup.scene;
  }

  /** Whether the dialogue is running a node (not yet completed). */
  get isActive(): boolean {
    return !this.completed;
  }

  /** The registry of host functions and command handlers (including built-ins). */
  getLibrary(): Library {
    return this.library;
  }

  /**
   * Run the program until the next stopping point and return the events
   * since the last stop: a delivered line, command, or option set — with
   * node lifecycle and (opt-in) line-hint events riding along — or the end
   * of the dialogue. Returns no events when the dialogue is not active.
   */
  continue(): DialogueEvent[] {
    if (this.pendingOptions) {
      this.logError(
        "continue() was called, but the dialogue is waiting for an option selection; " +
          "call selectOption() first",
      );
      return [];
    }
    if (this.completed) {
      // Lifecycle events queued after completion (e.g. stop()'s
      // dialogue-complete event) are still delivered; nothing else runs.
      const drained = this.queuedEvents;
      this.queuedEvents = [];
      if (drained.length > 0) return drained;
      this.logDebug("continue() called on an inactive dialogue; no events returned");
      return [];
    }
    const batch = this.queuedEvents;
    this.queuedEvents = [];
    this.run(batch);
    return batch;
  }

  /**
   * Resume a delivered option set: run the selected option's body and then
   * continue after the options block — or, with `noOptionSelected`, skip the
   * whole options block (fall-through). Mirrors upstream `SetSelectedOption`.
   */
  selectOption(selectedOption: number | typeof noOptionSelected): void {
    if (!this.pendingOptions) {
      this.logError(
        "selectOption was called, but the dialogue is not waiting for a selection; " +
          "it should only be called after an options event",
      );
      return;
    }
    const count = this.pendingOptions.length;
    if (selectedOption === noOptionSelected) {
      // Fall through: the options block is abandoned; execution resumes
      // after it on the next continue().
      this.pendingOptions = null;
      return;
    }
    if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption >= count) {
      this.logError(
        `${selectedOption} is not a valid option (expected a number between 0 and ${count - 1}, or noOptionSelected)`,
      );
      return;
    }
    const chosen = this.pendingOptions[selectedOption];
    this.pendingOptions = null;
    this.callStack.push({
      kind: "block",
      title: this.nodeTitle!,
      ip: this.ip,
      nodeIndex: this.currentNodeIndex,
      block: chosen.block,
      idx: 0,
    });
  }

  /**
   * Enter the named node: execution state is reset and the node's events are
   * delivered by the next `continue()`. Variables, once-state, and visit
   * counts are preserved. An unknown node is a runtime diagnostic; the
   * dialogue's state is unchanged.
   */
  setNode(title: string): void {
    if (!this.program.nodes[title]) {
      this.logError(`No node named "${title}" exists in the program`);
      return;
    }
    this.callStack.length = 0;
    this.pendingOptions = null;
    this.completed = false;
    this.nodeTitle = null;
    this.queuedEvents = [];
    this.enterNode(title, this.queuedEvents);
  }

  /**
   * Immediately stop the dialogue: execution state is discarded and the
   * dialogue-complete event is delivered by the next `continue()`
   * (upstream `Dialogue.Stop`).
   */
  stop(): void {
    if (this.completed) return;
    this.callStack.length = 0;
    this.pendingOptions = null;
    this.complete();
  }

  /**
   * Snapshot of the story variables (the variable storage minus generated
   * variables).
   */
  getVariables(): Readonly<Record<string, unknown>> {
    const visible: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.variables)) {
      if (!key.startsWith(generatedVariablePrefix)) visible[key] = value;
    }
    return visible;
  }

  /**
   * Get a variable's value (upstream `Dialogue.TryGetVariable`: a smart
   * variable recomputes; a stored value wins when a host has shadowed it).
   */
  getVariable(name: string): unknown {
    return this.evaluator.getVariable(name);
  }

  /**
   * Upstream `Dialogue.TryGetSmartVariable`: compute a smart variable's
   * current value. Reports failure when the name is not a smart variable.
   */
  tryGetSmartVariable(name: string): { ok: true; value: unknown } | { ok: false } {
    return this.evaluator.tryGetSmartVariable(name);
  }

  /** Set a variable's value in storage. */
  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
    this.evaluator.setVariable(name, value);
  }

  // ── Execution engine ────────────────────────────────────────────────

  /**
   * Run instructions until the next stopping point, appending events to
   * `batch`. Stops after delivering a line or command, after delivering an
   * option set (awaiting selection), or when the dialogue completes.
   */
  private run(batch: DialogueEvent[]): void {
    while (true) {
      const top = this.callStack[this.callStack.length - 1];
      const inBlock = top?.kind === "block";
      const instructions = inBlock ? top.block : this.currentInstructions();
      const index = inBlock ? top.idx : this.ip;
      const ins = instructions[index];
      if (!ins) {
        if (inBlock) {
          top.idx++;
          this.callStack.pop();
          continue;
        }
        // Node ended: the visit is recorded (upstream records on node
        // return); a detoured node returns to its caller, otherwise the
        // dialogue completes.
        this.recordVisit(this.nodeTitle!);
        batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
        const frame = this.callStack.pop();
        if (frame && frame.kind === "detour") {
          this.nodeTitle = frame.title;
          this.ip = frame.ip;
          this.currentNodeIndex = frame.nodeIndex;
          continue;
        }
        this.complete(batch);
        return;
      }
      if (inBlock) top.idx++;
      else this.ip++;

      switch (ins.op) {
        case "line": {
          const composed = this.composeLine(ins.text, ins.markup);
          batch.push({
            type: "line",
            lineId: lineIdFromTags(ins.tags),
            speaker: ins.speaker,
            text: composed.text,
            tags: ins.tags,
            markup: composed.markup,
          });
          return;
        }
        case "command": {
          const outcome = this.runCommand(ins.content, batch);
          if (outcome === "halted") return;
          if (outcome === "delivered") return;
          continue;
        }
        case "jump": {
          this.jumpTo(ins.target, batch);
          if (this.completed) return;
          continue;
        }
        case "detour": {
          this.beginDetour(ins.target, batch);
          if (this.completed) return;
          continue;
        }
        case "options": {
          this.deliverOptions(ins.options, batch);
          return;
        }
        case "if": {
          const branch = ins.branches.find(
            (b) => (b.condition ? this.evaluator.evaluate(b.condition) : true),
          );
          if (branch) {
            this.callStack.push({
              kind: "block",
              title: this.nodeTitle!,
              ip: this.ip,
              nodeIndex: this.currentNodeIndex,
              block: branch.block,
              idx: 0,
            });
          }
          continue;
        }
        case "once": {
          if (!this.hasOnce(ins.id)) {
            this.markOnce(ins.id);
            this.callStack.push({
              kind: "block",
              title: this.nodeTitle!,
              ip: this.ip,
              nodeIndex: this.currentNodeIndex,
              block: ins.block,
              idx: 0,
            });
          }
          continue;
        }
      }
    }
  }

  private currentInstructions(): IRInstruction[] {
    const nodeOrGroup = this.program.nodes[this.nodeTitle!];
    if (!nodeOrGroup) {
      // Should be unreachable: nodeTitle is only set to resolved titles.
      this.logError(`No node named "${this.nodeTitle}" exists in the program`);
      return [];
    }
    if ("nodes" in nodeOrGroup) {
      const member = this.currentNodeIndex >= 0 ? nodeOrGroup.nodes[this.currentNodeIndex] : undefined;
      return member?.instructions ?? [];
    }
    return nodeOrGroup.instructions;
  }

  /**
   * Enter a node: resolve node-group membership, queue the opt-in line
   * hints and the node-start event. A failed entry (unknown node, node
   * group with no selectable member) completes the dialogue — execution
   * cannot proceed — after reporting the diagnostic.
   */
  private enterNode(title: string, sink: DialogueEvent[]): boolean {
    const resolved = this.resolveNodeForEntry(title);
    if (!resolved.ok) {
      this.logError(resolved.message);
      this.complete(sink);
      return false;
    }
    this.nodeTitle = title;
    this.ip = 0;
    this.currentNodeIndex = resolved.nodeIndex;
    if (this.lineHintsEnabled) {
      sink.push({ type: "lineHints", lineIds: this.lineIdsForNode(resolved.node) });
    }
    sink.push({ type: "nodeStart", nodeName: title });
    return true;
  }

  private resolveNodeForEntry(
    title: string,
  ): { ok: true; node: IRNode; nodeIndex: number } | { ok: false; message: string } {
    const nodeOrGroup = this.program.nodes[title];
    if (!nodeOrGroup) {
      return { ok: false, message: `No node named "${title}" exists in the program` };
    }
    if (!("nodes" in nodeOrGroup)) {
      return { ok: true, node: nodeOrGroup as IRNode, nodeIndex: -1 };
    }
    // Node group: select the first member whose `when:` conditions hold
    // (saliency strategies are ticket 47).
    const group = nodeOrGroup as IRNodeGroup;
    for (let i = 0; i < group.nodes.length; i++) {
      const candidate = group.nodes[i];
      if (this.evaluateWhenConditions(candidate.when, title, i)) {
        if (candidate.when?.includes("once")) {
          this.markGroupOnceSeen(title, i);
        }
        return { ok: true, node: candidate, nodeIndex: i };
      }
    }
    return { ok: false, message: `No available content found in node group "${title}"` };
  }

  private evaluateWhenConditions(
    conditions: string[] | undefined,
    nodeTitle: string,
    nodeIndex: number,
  ): boolean {
    if (!conditions || conditions.length === 0) {
      // No when condition - available by default (but should not happen in groups)
      return true;
    }
    for (const condition of conditions) {
      const trimmed = condition.trim();
      if (trimmed === "once") {
        if (this.hasGroupOnceSeen(`${nodeTitle}#${nodeIndex}`)) {
          return false;
        }
        continue;
      }
      if (trimmed === "always") {
        continue;
      }
      if (!this.evaluator.evaluate(trimmed)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Resolve a jump/detour target that may be a `{expr}` string expression
   * (upstream allows node names in expressions).
   */
  private resolveDestination(target: string): string {
    const trimmed = target.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return String(this.evaluator.evaluateExpression(trimmed.slice(1, -1)));
      } catch {
        return target;
      }
    }
    return target;
  }

  /**
   * Execute a `jump`: the current node is exited entirely — the visit is
   * recorded and NodeComplete fires, detoured nodes on the return stack
   * record theirs, any in-progress block frames are abandoned (upstream
   * jump semantics) — and the target node is entered.
   */
  private jumpTo(target: string, batch: DialogueEvent[]): void {
    batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
    this.recordVisit(this.nodeTitle!);
    for (const frame of this.callStack) {
      if (frame.kind === "detour") {
        this.recordVisit(frame.title);
      }
    }
    this.callStack.length = 0;
    this.enterNode(this.resolveDestination(target), batch);
  }

  /** Begin a detour: save the return position and enter the target node. */
  private beginDetour(target: string, batch: DialogueEvent[]): void {
    this.callStack.push({
      kind: "detour",
      title: this.nodeTitle!,
      ip: this.ip,
      nodeIndex: this.currentNodeIndex,
    });
    this.enterNode(this.resolveDestination(target), batch);
  }

  /**
   * Run one command instruction: state statements (`<<set>>`/`<<declare>>`/
   * `<<call>>`) execute internally and never surface; `<<stop>>` and
   * `<<return>>` (outside a detour) complete the dialogue; any other command
   * is delivered as a `Command` event after invoking its registered Library
   * handler, if one is registered.
   */
  private runCommand(content: string, batch: DialogueEvent[]): CommandOutcome {
    let parsed: ParsedCommand;
    try {
      parsed = parseCommand(content);
    } catch {
      this.logError(`Malformed command: ${content}`);
      this.deliverCommand(content, undefined, batch);
      return "delivered";
    }
    const name = parsed.name.toLowerCase();
    if (name === "return") {
      return this.runReturn(batch);
    }
    if (name === "stop") {
      batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
      this.complete(batch);
      return "halted";
    }
    if (name === "set" || name === "declare" || name === "call") {
      // State statements are internal (spec, ticket 03 conformance): they
      // execute their effect and never surface as Command events.
      // `<<call>>` bodies do not invoke host functions yet (the `<<call>>`
      // statement story); the compiler validates call targets.
      if (name === "call") {
        this.logDebug(`<<call>> statements do not execute host functions yet: ${content}`);
      } else {
        this.executeStateStatement(content, parsed);
      }
      return "continued";
    }
    this.deliverCommand(content, parsed, batch);
    return "delivered";
  }

  /**
   * Deliver a command: invoke its registered Library command handler, if
   * any, then surface the `Command` event with `{expr}` substitutions
   * expanded (upstream expands command text before delivery).
   */
  private deliverCommand(content: string, parsed: ParsedCommand | undefined, batch: DialogueEvent[]): void {
    if (parsed) {
      const handler = this.library.getCommandHandler(parsed.name);
      if (handler) {
        try {
          // Handler parameters arrive with surrounding quotes stripped
          // (upstream command handlers receive parsed parameters, not raw
          // tokens); the delivered event text keeps the authored form.
          handler(parsed.args.map(stripQuotes));
        } catch (e) {
          this.logError(`Command handler for "${parsed.name}" failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    const { text: expandedCommand } = this.composeLine(content);
    batch.push({ type: "command", command: expandedCommand });
  }

  /**
   * Execute a state statement's effect on variable storage (`<<set>>`/
   * `<<declare>>` grammar) — the shared executor in ./commands.js, over
   * this driver's storage and evaluator.
   */
  private executeStateStatement(content: string, parsed?: ParsedCommand): void {
    executeStateStatement(
      { variables: this.variables, evaluator: this.evaluator, logError: this.logError },
      content,
      parsed,
    );
  }

  /**
   * Handle `<<return>>`: end a detour (pop to the caller and resume it), or
   * act as `<<stop>>` outside a detour.
   */
  private runReturn(batch: DialogueEvent[]): CommandOutcome {
    // Abandon in-progress block frames down to the nearest detour frame.
    while (this.callStack.length > 0 && this.callStack[this.callStack.length - 1].kind === "block") {
      this.callStack.pop();
    }
    const frame = this.callStack[this.callStack.length - 1];
    if (!frame || frame.kind !== "detour") {
      // Not inside a detour: <<return>> acts as stop.
      batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
      this.complete(batch);
      return "halted";
    }
    batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
    this.recordVisit(this.nodeTitle!); // <<return>> is a node return
    this.callStack.pop();
    this.nodeTitle = frame.title;
    this.ip = frame.ip;
    this.currentNodeIndex = frame.nodeIndex;
    return "continued";
  }

  private deliverOptions(options: CompiledOption[], batch: DialogueEvent[]): void {
    // The full set is delivered, unavailable options included with
    // `isAvailable: false` (upstream OptionSet semantics — availability is
    // advisory for the consumer). The set awaits selection.
    const delivered = options.map((option, index) => {
      const composed = this.composeLine(option.text, option.markup);
      return {
        index,
        isAvailable: this.conditionHolds(option.condition),
        text: composed.text,
        tags: option.tags,
        markup: composed.markup,
      };
    });
    this.pendingOptions = options;
    batch.push({ type: "options", options: delivered });
  }

  private conditionHolds(condition: string | undefined): boolean {
    if (!condition) return true;
    try {
      return this.evaluator.evaluate(condition);
    } catch {
      // Treat errors as false conditions.
      return false;
    }
  }

  /** Complete the dialogue: no further events are produced after the complete event. */
  private complete(sink: DialogueEvent[] = this.queuedEvents): void {
    this.completed = true;
    this.nodeTitle = null;
    sink.push({ type: "dialogueComplete" });
  }

  // ── Generated-variable state (coding standards §4) ──────────────────

  /** Once-state for <<once>> block ids, as generated variables. */
  private hasOnce(id: string): boolean {
    return this.variables[onceVariableKey(id)] === true;
  }

  private markOnce(id: string): void {
    this.variables[onceVariableKey(id)] = true;
  }

  private markGroupOnceSeen(nodeTitle: string, nodeIndex: number): void {
    this.variables[groupOnceVariableKey(`${nodeTitle}#${nodeIndex}`)] = true;
  }

  private hasGroupOnceSeen(key: string): boolean {
    return this.variables[groupOnceVariableKey(key)] === true;
  }

  /**
   * Record a node visit (upstream records on node return). Nodes with a
   * `tracking: never` header are not recorded.
   */
  private recordVisit(title: string): void {
    if (this.trackingSuppressedFor(title)) return;
    const key = visitCountVariableKey(title);
    this.variables[key] = (Number(this.variables[key]) || 0) + 1;
  }

  private trackingSuppressedFor(title: string): boolean {
    const nodeOrGroup = this.program.nodes[title];
    if (!nodeOrGroup) return false;
    if ("nodes" in nodeOrGroup) {
      const member = this.currentNodeIndex >= 0 ? nodeOrGroup.nodes[this.currentNodeIndex] : undefined;
      return member?.tracking === "never";
    }
    return nodeOrGroup.tracking === "never";
  }

  /**
   * The line IDs the given node may deliver: every line's and option's
   * `line:` hashtag in the node, including those inside conditional and
   * once blocks and option bodies.
   */
  private lineIdsForNode(node: IRNode): string[] {
    const ids = new Set<string>();
    this.collectLineIds(node.instructions, ids);
    return [...ids];
  }

  private collectLineIds(instructions: IRInstruction[], into: Set<string>): void {
    for (const ins of instructions) {
      switch (ins.op) {
        case "line":
          for (const tag of ins.tags ?? []) {
            if (tag.startsWith("line:")) into.add(tag.slice("line:".length));
          }
          break;
        case "options":
          for (const option of ins.options) {
            for (const tag of option.tags ?? []) {
              if (tag.startsWith("line:")) into.add(tag.slice("line:".length));
            }
            this.collectLineIds(option.block, into);
          }
          break;
        case "if":
          for (const branch of ins.branches) this.collectLineIds(branch.block, into);
          break;
        case "once":
          this.collectLineIds(ins.block, into);
          break;
      }
    }
  }

  // ── Line composition (substitutions + markup) ───────────────────────

  private composeLine(text: string, markup?: MarkupParseResult): { text: string; markup?: MarkupParseResult } {
    return interpolate(text, (expr) => this.evaluator.evaluateExpression(expr), markup);
  }
}
