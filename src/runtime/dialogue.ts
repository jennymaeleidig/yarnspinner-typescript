/**
 * The runtime (`Dialogue`): pull-based execution of a compiled program.
 *
 * Consumers drive dialogue on their own clock (ADR 0002, ticket 43):
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
import type { MarkupParseResult, MarkupSegment, MarkupWrapper } from "../markup/types.js";
import { ExpressionEvaluator, stringifyOperand } from "./evaluator.js";
import { Library, type YarnFunction } from "./library.js";
import { parseCommand, type ParsedCommand } from "./commands.js";
import {
  generatedVariablePrefix,
  groupOnceVariableKey,
  onceVariableKey,
  visitCountVariableKey,
} from "./generatedVariables.js";

export { Library } from "./library.js";
export type { YarnFunction, CommandHandler } from "./library.js";

/**
 * The value indicating that no option was selected: the dialogue falls
 * through to the rest of the program (upstream `Dialogue.NoOptionSelected`).
 */
export const noOptionSelected = -1;

export interface LineEvent {
  type: "line";
  /** The line's ID (from its `line:` hashtag; values become stable with the line-ID/string-table work). */
  lineId?: string;
  speaker?: string;
  /** Composed text: `{expr}` substitutions expanded. */
  text: string;
  tags?: string[];
  markup?: MarkupParseResult;
}

export interface DialogueOption {
  /** Position of this option in the delivered set (upstream `OptionSet.Option.ID`). */
  index: number;
  /**
   * Whether the option's condition held. Advisory: unavailable options are
   * still delivered (upstream `OptionSet.Option.IsAvailable`); the consumer
   * decides whether to offer them, and any index may be selected.
   */
  isAvailable: boolean;
  /** Composed option text: `{expr}` substitutions expanded. */
  text: string;
  tags?: string[];
  markup?: MarkupParseResult;
}

export interface OptionsEvent {
  type: "options";
  options: DialogueOption[];
}

export interface CommandEvent {
  type: "command";
  /** The delivered command text, `{expr}` substitutions expanded. */
  command: string;
}

export interface NodeStartEvent {
  type: "nodeStart";
  nodeName: string;
}

export interface NodeCompleteEvent {
  type: "nodeComplete";
  nodeName: string;
}

export interface LineHintsEvent {
  type: "lineHints";
  /** Line IDs the current node may deliver soon (upstream `PrepareForLines`). */
  lineIds: string[];
}

export interface DialogueCompleteEvent {
  type: "dialogueComplete";
}

export type DialogueEvent =
  | LineEvent
  | OptionsEvent
  | CommandEvent
  | NodeStartEvent
  | NodeCompleteEvent
  | LineHintsEvent
  | DialogueCompleteEvent;

export interface DialogueOptions {
  /** Node to enter at construction (upstream `DefaultStartNodeName` is `"Start"`). */
  startAt?: string;
  /** Host functions and command handlers, imported over the built-ins. */
  library?: Library;
  /** Host-provided initial variables (`$` prefix optional), applied after `<<declare>>` seeding. */
  variables?: Record<string, unknown>;
  /** Opt-in `LineHints` events (upstream `PrepareForLinesHandler`). */
  lineHints?: boolean;
  /** Runtime error diagnostics. Defaults to `console.error`. */
  logError?: (message: string) => void;
  /** Runtime debug diagnostics. Defaults to silent. */
  logDebug?: (message: string) => void;
}

/** The default node a dialogue starts from (upstream `Dialogue.DefaultStartNodeName`). */
export const defaultStartNodeName = "Start";


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

export class Dialogue {
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
    this.registerBuiltins();
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
      this.evaluator.setSmartVariable(name, expression);
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
    const { text: expandedCommand } = this.interpolate(content);
    batch.push({ type: "command", command: expandedCommand });
  }

  /**
   * Execute a state statement's effect on variable storage (`<<set>>`/
   * `<<declare>>` grammar: `set $var (to|=) expr`, compound assignment
   * operators, `declare $var = expr (as TYPE)?`).
   */
  private executeStateStatement(content: string, parsed?: ParsedCommand): void {
    try {
      const command = parsed ?? parseCommand(content);
      const name = command.name.toLowerCase();
      const args = command.args;
      if (name === "set") {
        if (args.length < 2) return;
        const varNameRaw = args[0];
        let exprParts = args.slice(1);
        if (exprParts[0] === "to") exprParts = exprParts.slice(1);
        if (exprParts[0] === "=") exprParts = exprParts.slice(1);
        const key = varNameRaw.startsWith("$") ? varNameRaw.slice(1) : varNameRaw;

        const compoundOp = exprParts[0];
        if (compoundOp === "+=" || compoundOp === "-=" || compoundOp === "*=" || compoundOp === "/=" || compoundOp === "%=") {
          const rhs = this.evaluator.evaluateExpression(exprParts.slice(1).join(" "));
          const current = this.variables[key];
          let value: unknown;
          if (compoundOp === "+=" && (typeof current === "string" || typeof rhs === "string")) {
            // String concat renders operands the upstream way (C# ToString:
            // booleans as "True"/"False").
            value = stringifyOperand(current) + stringifyOperand(rhs);
          } else {
            const left = Number(current ?? 0);
            const right = Number(rhs ?? 0);
            switch (compoundOp) {
              case "+=": value = left + right; break;
              case "-=": value = left - right; break;
              case "*=": value = left * right; break;
              case "/=": value = left / right; break;
              case "%=": value = left % right; break;
            }
          }
          this.setVariable(key, value);
          return;
        }

        const value = this.evaluator.evaluateExpression(exprParts.join(" "));
        // A script-level set of a smart variable is a compile error (YS0030),
        // so this write only ever lands on stored variables — or shadows a
        // smart variable when a host drives the storage directly (upstream
        // VariableKind.Stored precedence). No smart-to-regular downgrade:
        // the smart expression stays registered.
        this.setVariable(key, value);
        return;
      }
      if (name === "declare") {
        if (args.length < 3) return; // name, '=', expr
        const varNameRaw = args[0];
        let exprParts = args.slice(1);
        if (exprParts[0] === "=") exprParts = exprParts.slice(1);
        // Upstream declare grammar: <<declare $var = expr (as TYPE)?>> — the
        // type postfix is compile metadata; evaluate the expression alone.
        const expr = exprParts.join(" ").replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/, "");
        const key = varNameRaw.startsWith("$") ? varNameRaw.slice(1) : varNameRaw;

        // Smart variables (ticket 42) were classified at compile time and
        // registered from `program.smartVariables` at start-up: read-only,
        // recomputed on every access, no initial stored value (upstream:
        // they are not in Program.InitialValues).
        if (this.evaluator.isSmartVariable(key)) return;

        // A declare is an initial value (upstream: Program.InitialValues,
        // seeded at SetProgram time): it initializes, it never re-assigns.
        // Upstream compiles declares to no instruction at all; the fork's
        // declare instruction stays for the VM tickets to retire, but its
        // effect must not clobber storage that already holds a value
        // (host writes win — upstream VariableKind.Stored precedence).
        if (key in this.variables) return;

        // Regular variable - evaluate once and store. Enum member access
        // (Enum.Case, or compile-time-resolved shorthand) evaluates to the
        // case's raw value via the evaluator's enum registry.
        const value = this.evaluator.evaluateExpression(expr);
        this.setVariable(key, value);
      }
    } catch (e) {
      // collect-don't-throw: a failing state statement is a runtime
      // diagnostic, not a crash.
      this.logError(`Failed to execute statement "${content}": ${e instanceof Error ? e.message : String(e)}`);
    }
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

  // ── Built-in functions ──────────────────────────────────────────────

  /**
   * Register the built-in functions every dialogue carries (upstream
   * `StandardLibrary` role). Host libraries are imported over these, so a
   * host may override any of them.
   */
  private registerBuiltins(): void {
    const builtins: Record<string, YarnFunction> = {
      // Default conversion helpers
      string: (v: unknown) => String(v ?? ""),
      number: (v: unknown) => Number(v),
      bool: (v: unknown) => Boolean(v),
      visited: (nodeName: unknown) => {
        const name = String(nodeName ?? "");
        return (Number(this.variables[visitCountVariableKey(name)]) || 0) > 0;
      },
      visited_count: (nodeName: unknown) => {
        const name = String(nodeName ?? "");
        return Number(this.variables[visitCountVariableKey(name)]) || 0;
      },
      format_invariant: (n: unknown) => {
        const num = Number(n);
        if (!isFinite(num)) return "0";
        return new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 20 }).format(num);
      },
      random: () => Math.random(),
      // Upstream: random_range returns an integer.
      random_range: (a: unknown, b: unknown) => {
        const x = Number(a), y = Number(b);
        const min = Math.min(x, y);
        const max = Math.max(x, y);
        return Math.floor(min + Math.random() * (max - min + 1));
      },
      dice: (sides: unknown) => {
        const s = Math.max(1, Math.floor(Number(sides)) || 1);
        return Math.floor(Math.random() * s) + 1;
      },
      // Variadic (upstream std-lib: min/max take any number of arguments).
      min: (...args: unknown[]) => Math.min(...args.map(Number)),
      max: (...args: unknown[]) => Math.max(...args.map(Number)),
      round: (n: unknown) => Math.round(Number(n)),
      round_places: (n: unknown, places: unknown) => {
        const p = Math.max(0, Math.floor(Number(places)) || 0);
        const factor = Math.pow(10, p);
        return Math.round(Number(n) * factor) / factor;
      },
      floor: (n: unknown) => Math.floor(Number(n)),
      ceil: (n: unknown) => Math.ceil(Number(n)),
      inc: (n: unknown) => {
        const v = Number(n);
        return Number.isInteger(v) ? v + 1 : Math.ceil(v);
      },
      dec: (n: unknown) => {
        const v = Number(n);
        return Number.isInteger(v) ? v - 1 : Math.floor(v);
      },
      decimal: (n: unknown) => {
        const v = Number(n);
        return Math.abs(v - Math.trunc(v));
      },
      int: (n: unknown) => Math.trunc(Number(n)),
      // Upstream std-lib `format`: positional `{0}`-style placeholders.
      format: (fmt: unknown, ...args: unknown[]) =>
        String(fmt ?? "").replace(/\{(\d+)\}/g, (match, i: string) => {
          const value = args[Number(i)];
          return value === undefined ? match : stringifyOperand(value);
        }),
    };
    for (const [name, fn] of Object.entries(builtins)) {
      this.library.registerFunction(name, fn);
    }
  }

  // ── Line composition (substitutions + markup) ───────────────────────

  private composeLine(text: string, markup?: MarkupParseResult): { text: string; markup?: MarkupParseResult } {
    return this.interpolate(text, markup);
  }

  private interpolate(text: string, markup?: MarkupParseResult): { text: string; markup?: MarkupParseResult } {
    const evaluateExpression = (expr: string): string => {
      try {
        const value = this.evaluator.evaluateExpression(expr.trim());
        if (value === null || value === undefined) {
          return "";
        }
        // Upstream composed text (C# ToString): booleans as "True"/"False".
        return stringifyOperand(value);
      } catch {
        return "";
      }
    };

    if (!markup) {
      const interpolated = text.replace(/\{([^}]+)\}/g, (_m, expr) => evaluateExpression(expr));
      return { text: interpolated };
    }

    const segments = markup.segments.filter((segment) => !segment.selfClosing);
    const getWrappersAt = (index: number): MarkupWrapper[] => {
      for (const segment of segments) {
        if (segment.start <= index && index < segment.end) {
          return segment.wrappers.map((wrapper) => ({
            name: wrapper.name,
            type: wrapper.type,
            properties: { ...wrapper.properties },
          }));
        }
      }
      if (segments.length === 0) {
        return [];
      }
      if (index > 0) {
        return getWrappersAt(index - 1);
      }
      return segments[0].wrappers.map((wrapper) => ({
        name: wrapper.name,
        type: wrapper.type,
        properties: { ...wrapper.properties },
      }));
    };

    const resultChars: string[] = [];
    const newSegments: MarkupSegment[] = [];
    let currentSegment: MarkupSegment | null = null;

    const wrappersEqual = (a: MarkupWrapper[], b: MarkupWrapper[]) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const wa = a[i];
        const wb = b[i];
        if (wa.name !== wb.name || wa.type !== wb.type) return false;
        const keysA = Object.keys(wa.properties);
        const keysB = Object.keys(wb.properties);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
          if (wa.properties[key] !== wb.properties[key]) return false;
        }
      }
      return true;
    };

    const flushSegment = () => {
      if (currentSegment) {
        newSegments.push(currentSegment);
        currentSegment = null;
      }
    };

    const appendCharWithWrappers = (char: string, wrappers: MarkupWrapper[]) => {
      const index = resultChars.length;
      resultChars.push(char);
      const wrappersCopy = wrappers.map((wrapper) => ({
        name: wrapper.name,
        type: wrapper.type,
        properties: { ...wrapper.properties },
      }));
      if (currentSegment && wrappersEqual(currentSegment.wrappers, wrappersCopy)) {
        currentSegment.end = index + 1;
      } else {
        flushSegment();
        currentSegment = { start: index, end: index + 1, wrappers: wrappersCopy };
      }
    };

    const appendStringWithWrappers = (value: string, wrappers: MarkupWrapper[]) => {
      if (!value) {
        flushSegment();
        return;
      }
      for (const ch of value) {
        appendCharWithWrappers(ch, wrappers);
      }
    };

    let i = 0;
    while (i < text.length) {
      const char = text[i];
      if (char === '{') {
        const close = text.indexOf('}', i + 1);
        if (close === -1) {
          appendCharWithWrappers(char, getWrappersAt(Math.max(0, Math.min(i, text.length - 1))));
          i += 1;
          continue;
        }
        const expr = text.slice(i + 1, close);
        const evaluated = evaluateExpression(expr);
        const wrappers = getWrappersAt(Math.max(0, Math.min(i, text.length - 1)));
        appendStringWithWrappers(evaluated, wrappers);
        i = close + 1;
        continue;
      }
      appendCharWithWrappers(char, getWrappersAt(i));
      i += 1;
    }

    flushSegment();
    const interpolatedText = resultChars.join('');
    const normalizedMarkup = this.normalizeMarkupResult({ text: interpolatedText, segments: newSegments });
    return { text: interpolatedText, markup: normalizedMarkup };
  }

  private normalizeMarkupResult(result: MarkupParseResult): MarkupParseResult | undefined {
    if (!result) return undefined;
    if (result.segments.length === 0) {
      return undefined;
    }
    const hasFormatting = result.segments.some(
      (segment) => segment.wrappers.length > 0 || segment.selfClosing
    );
    if (!hasFormatting) {
      return undefined;
    }
    return {
      text: result.text,
      segments: result.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        wrappers: segment.wrappers.map((wrapper) => ({
          name: wrapper.name,
          type: wrapper.type,
          properties: { ...wrapper.properties },
        })),
        selfClosing: segment.selfClosing,
      })),
    };
  }
}

/** The line's ID from its `line:` hashtag, if present. */
function lineIdFromTags(tags: string[] | undefined): string | undefined {
  const tag = tags?.find((t) => t.startsWith("line:"));
  return tag ? tag.slice("line:".length) : undefined;
}

/** Strip one layer of surrounding quotes from a command parameter. */
function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
