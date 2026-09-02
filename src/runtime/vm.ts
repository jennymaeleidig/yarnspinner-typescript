/**
 * The instruction-stream VM (ADR 0001): executes the compiled `Program` —
 * per-node instruction streams whose expressions are bytecode and whose
 * jumps are instruction indices — end-to-end for linear flow, behind the
 * public runtime API (`Dialogue` dispatches here for bytecode programs
 * during the VM work, tickets 45–46).
 *
 * Semantics mirror upstream 3.2.2 `VirtualMachine.cs`:
 * - `NodeStart` fires when a node is entered (`setNode`, `runNode`, detour);
 *   `NodeComplete` when a node is left (end, `runNode`, `<<return>>`,
 *   `<<stop>>`) — and a node left records its visit (upstream records on
 *   node return).
 * - `runNode` (a jump) exits the current node entirely: the visit is
 *   recorded, detoured nodes on the return stack record theirs, the return
 *   stack is cleared, and the target node is entered.
 * - `addOption` pops the option's availability (the compiler emits the
 *   evaluated condition, or `pushBool true` — upstream AddOption), so
 *   `showOptions` delivers the FULL set with per-option `isAvailable`
 *   flags and awaits selection. Selecting an option resumes at its
 *   destination (the inline body, which jumps past the construct);
 *   `noOptionSelected` falls through to the pc after `showOptions`.
 * - State commands (`<<set>>`/`<<declare>>`/`<<call>>`) never surface as
 *   `Command` events; lines and commands keep authored text and compose at
 *   delivery through the shared line parser (`interpolate`).
 * - Stack-op semantics mirror the runtime evaluator: `add` concatenates
 *   when either operand is a string (rendering operands the upstream way),
 *   equality is `deepEqualsOperands` (unset variables compare against
 *   their typed default), relational ops coerce through `Number()`, and
 *   branch ops branch on truthiness (conditions compile to booleans).
 * - Runtime failures are diagnostics, not throws (coding standards §3):
 *   they surface through `logError`, the operand stack is re-balanced with
 *   a `null`, and execution continues.
 *
 * Story state (variables, generated variables, smart variables) lives in
 * the variable storage / evaluator (coding standards §4) — the engine is
 * stateless across instances.
 */

import type { Instruction, Program, ProgramNode } from "../compile/program.js";
import type { MarkupParseResult } from "../markup/types.js";
import {
  defaultStartNodeName,
  noOptionSelected,
  type DialogueEvent,
  type DialogueOptions,
  lineIdFromTags,
} from "./events.js";
import { Library, type YarnFunction } from "./library.js";
import { ExpressionEvaluator, deepEqualsOperands, stringifyOperand, toNumberOperand } from "./evaluator.js";
import { executeStateStatement, parseCommand, stripQuotes, type ParsedCommand } from "./commands.js";
import { interpolate } from "./interpolate.js";
import { registerBuiltinFunctions } from "./builtins.js";
import { generatedVariablePrefix, groupOnceVariableKey, visitCountVariableKey } from "./generatedVariables.js";

/** Outcome of executing one command instruction. */
type CommandOutcome = "continued" | "delivered" | "halted";

/** A saved return position on the detour/return call stack. */
type ReturnFrame = { title: string; ip: number; nodeIndex: number };

/** An option accumulated by `addOption`, awaiting delivery by `showOptions`. */
type AccumulatedOption = { text: string; tags?: string[]; destination: number; isAvailable: boolean; markup?: MarkupParseResult };

/** The literal-push ops: infallible, so they are not stack *producers* in the failure sense. */
const LITERAL_OPS: ReadonlySet<Instruction["op"]> = new Set(["pushString", "pushNumber", "pushBool", "pushNull"]);

/**
 * Ops allowed in compiled initializers (`initialValues` / smart variables):
 * exactly the expression subset the front end emits for them.
 */
const INITIALIZER_OPS: ReadonlySet<Instruction["op"]> = new Set([
  ...LITERAL_OPS,
  "pushVariable",
  "callFunction",
  "add",
  "subtract",
  "multiply",
  "divide",
  "modulo",
  "negate",
  "equalTo",
  "notEqualTo",
  "lessThan",
  "greaterThan",
  "lessThanOrEqualTo",
  "greaterThanOrEqualTo",
  "and",
  "or",
  "not",
]);

/** Ops whose execution leaves the operand stack one value richer; on a
 * caught failure the VM pushes `null` so the stream stays balanced.
 */
const STACK_PRODUCERS: ReadonlySet<Instruction["op"]> = new Set(
  [...INITIALIZER_OPS].filter((op) => !LITERAL_OPS.has(op)),
);

export class VirtualMachine {
  private readonly program: Program;
  /** The variable storage: story variables plus generated variables (coding standards §4). */
  private readonly storage: Record<string, unknown> = {};
  /** The runtime's library: built-ins + imported host entries. */
  private readonly library: Library;
  private readonly evaluator: ExpressionEvaluator;
  private readonly lineHintsEnabled: boolean;
  private readonly logError: (message: string) => void;
  private readonly logDebug: (message: string) => void;

  private readonly stack: unknown[] = [];
  /** Events queued outside a `continue()` batch (by `setNode`/`stop`). */
  private queuedEvents: DialogueEvent[] = [];
  private nodeTitle: string | null = null;
  private ip = 0;
  /** Index of the selected member when the current node is a group (-1 otherwise). */
  private currentNodeIndex = -1;
  private returnStack: ReturnFrame[] = [];
  /** Options accumulated by `addOption` since the last delivery. */
  private accumulatedOptions: AccumulatedOption[] = [];
  /** The delivered option set awaiting selection. */
  private pendingOptions: AccumulatedOption[] | null = null;
  private completed = false;

  constructor(program: Program, opts: DialogueOptions = {}) {
    this.program = program;
    this.library = new Library();
    registerBuiltinFunctions(this.library, () => this.storage);
    if (opts.library) this.library.importLibrary(opts.library);
    this.lineHintsEnabled = opts.lineHints ?? false;
    this.logError = opts.logError ?? ((message) => console.error(message));
    this.logDebug = opts.logDebug ?? (() => {});
    this.evaluator = new ExpressionEvaluator(
      this.storage,
      {
        get: (name: string): YarnFunction | undefined =>
          this.library.hasFunction(name) ? this.library.getFunction(name) : undefined,
      },
      this.program.enums,
    );

    // Smart variables (ticket 42): compiled initializers, recomputed on
    // every access (upstream: smart variables are not in InitialValues).
    for (const [name, code] of Object.entries(this.program.smartVariables ?? {})) {
      this.evaluator.setSmartVariable(name, () => this.evaluateInitializer(code, name));
    }

    // Upstream Dialogue.SetProgram seeds the variable storage from
    // Program.InitialValues (the <<declare>>d defaults, compiled to
    // bytecode), so every declared variable exists before the first node
    // runs. Host-provided variables are applied afterwards and override
    // declared defaults.
    for (const [name, code] of Object.entries(this.program.initialValues)) {
      try {
        this.storage[name] = this.evaluateInitializer(code, name);
      } catch (e) {
        this.logError(
          `Failed to initialize variable "${name}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (opts.variables) {
      for (const [key, value] of Object.entries(opts.variables)) {
        const normalizedKey = key.startsWith("$") ? key.slice(1) : key;
        this.storage[normalizedKey] = value;
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

  // ── Public surface (RuntimeDriver — the Dialogue facade dispatches here) ──

  /** The node currently executing, or `null` when the dialogue is not active. */
  get currentNode(): string | null {
    return this.nodeTitle;
  }

  /** The `scene:` header of the current node, if any (adapter-side concern). */
  get currentScene(): string | undefined {
    return this.currentMember()?.scene;
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
      // after it (the pc is already past showOptions) on the next continue().
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
    // Resume at the option's inline body (which jumps past the construct).
    this.ip = chosen.destination;
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
    this.returnStack.length = 0;
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
    this.returnStack.length = 0;
    this.pendingOptions = null;
    this.complete();
  }

  /** Snapshot of the story variables (the variable storage minus generated variables). */
  getVariables(): Readonly<Record<string, unknown>> {
    const visible: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.storage)) {
      if (!key.startsWith(generatedVariablePrefix)) visible[key] = value;
    }
    return visible;
  }

  /** Get a variable's value (a smart variable recomputes; a stored value wins when shadowed). */
  getVariable(name: string): unknown {
    return this.evaluator.getVariable(name);
  }

  /** Set a variable's value in storage. */
  setVariable(name: string, value: unknown): void {
    this.storage[name] = value;
    this.evaluator.setVariable(name, value);
  }

  /** Upstream `Dialogue.TryGetSmartVariable`: compute a smart variable's current value. */
  tryGetSmartVariable(name: string): { ok: true; value: unknown } | { ok: false } {
    return this.evaluator.tryGetSmartVariable(name);
  }

  // ── Execution engine ────────────────────────────────────────────────

  /**
   * Run instructions until the next stopping point, appending events to
   * `batch`. Stops after delivering a line or command, after delivering an
   * option set (awaiting selection), or when the dialogue completes.
   */
  private run(batch: DialogueEvent[]): void {
    while (true) {
      const ins = this.currentInstructions()[this.ip++];
      if (!ins) {
        // Node ended: the visit is recorded (upstream records on node
        // return); a detoured node returns to its caller, otherwise the
        // dialogue completes.
        this.recordVisit(this.nodeTitle!, this.currentNodeIndex);
        batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
        const frame = this.returnStack.pop();
        if (frame) {
          this.nodeTitle = frame.title;
          this.ip = frame.ip;
          this.currentNodeIndex = frame.nodeIndex;
          continue;
        }
        this.complete(batch);
        return;
      }
      const stackDepth = this.stack.length;
      try {
        switch (ins.op) {
          case "runLine": {
            const composed = this.compose(ins.text, ins.markup);
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
          case "runCommand": {
            const outcome = this.runCommand(ins.content, batch);
            if (outcome !== "continued") return;
            continue;
          }
          case "jumpTo":
            this.ip = ins.index;
            continue;
          case "jumpIfFalse":
            // Branch on truthiness: conditions compile to booleans, but a
            // bare variable as a condition may hold any value (the string
            // evaluator's `!!` contract for conditions).
            if (!this.pop()) this.ip = ins.index;
            continue;
          case "jumpIfTrue":
            if (this.pop()) this.ip = ins.index;
            continue;
          case "runNode":
            this.jumpTo(ins.node, batch);
            if (this.completed) return;
            continue;
          case "detour": {
            this.returnStack.push({
              title: this.nodeTitle!,
              ip: this.ip,
              nodeIndex: this.currentNodeIndex,
            });
            this.enterNode(this.resolveDestination(ins.node), batch);
            if (this.completed) return;
            continue;
          }
          case "return":
            if (this.runReturn(batch) === "halted") return;
            continue;
          case "stop":
            batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
            this.complete(batch);
            return;
          case "addOption": {
            this.accumulatedOptions.push({
              text: ins.text,
              tags: ins.tags,
              destination: ins.destination,
              markup: ins.markup,
              // The availability (the evaluated condition, or `true` for
              // unconditioned options) is on the stack — upstream AddOption.
              isAvailable: Boolean(this.pop()),
            });
            continue;
          }
          case "showOptions":
            this.deliverOptions(batch);
            return;
          case "pushString":
          case "pushNumber":
          case "pushBool":
          case "pushNull":
          case "pushVariable":
          case "popVariable":
          case "callFunction":
          case "add":
          case "subtract":
          case "multiply":
          case "divide":
          case "modulo":
          case "negate":
          case "equalTo":
          case "notEqualTo":
          case "lessThan":
          case "greaterThan":
          case "lessThanOrEqualTo":
          case "greaterThanOrEqualTo":
          case "and":
          case "or":
          case "not":
            this.executeStackOp(ins);
            continue;
        }
      } catch (e) {
        // Collect-don't-throw (coding standards §3): a failing instruction
        // is a runtime diagnostic; the operand stack is restored to its
        // depth before the instruction (an op that threw may already have
        // consumed operands) and re-balanced with a null, and execution
        // continues at the next instruction.
        this.logError(
          `Failed to execute ${ins.op}: ${e instanceof Error ? e.message : String(e)}`,
        );
        this.stack.length = stackDepth;
        if (STACK_PRODUCERS.has(ins.op)) this.push(null);
      }
    }
  }

  /**
   * Evaluate one stack op against the operand stack. Shared by the run
   * loop and the initializer evaluator (whose programs are exactly the
   * expression subset this covers); any other op reaching here is a
   * compile-side bug and raises.
   */
  private executeStackOp(ins: Instruction): void {
    switch (ins.op) {
      case "pushString":
        this.push(ins.value);
        return;
      case "pushNumber":
        this.push(ins.value);
        return;
      case "pushBool":
        this.push(ins.value);
        return;
      case "pushNull":
        this.push(null);
        return;
      case "pushVariable":
        // The evaluator owns the read contract: unset names read
        // undefined; a smart variable recomputes; a stored value wins when
        // a host has shadowed it.
        this.push(this.evaluator.getVariable(ins.name));
        return;
      case "popVariable":
        this.storage[ins.name] = this.pop();
        return;
      case "callFunction": {
        const args = this.stack.splice(this.stack.length - ins.argc, ins.argc);
        const fn = this.library.getFunction(ins.name);
        if (!fn) {
          throw new Error(`Function not found: ${ins.name}`);
        }
        this.push(fn(...args));
        return;
      }
      case "add": {
        const b = this.pop();
        const a = this.pop();
        this.push(
          typeof a === "string" || typeof b === "string"
            ? stringifyOperand(a) + stringifyOperand(b) // upstream rendering
            : toNumberOperand(a) + toNumberOperand(b),
        );
        return;
      }
      case "subtract": {
        const b = this.pop();
        const a = this.pop();
        this.push(toNumberOperand(a) - toNumberOperand(b));
        return;
      }
      case "multiply": {
        const b = this.pop();
        const a = this.pop();
        this.push(toNumberOperand(a) * toNumberOperand(b));
        return;
      }
      case "divide": {
        const b = this.pop();
        const a = this.pop();
        this.push(toNumberOperand(a) / toNumberOperand(b));
        return;
      }
      case "modulo": {
        const b = this.pop();
        const a = this.pop();
        this.push(toNumberOperand(a) % toNumberOperand(b));
        return;
      }
      case "negate":
        this.push(-toNumberOperand(this.pop()));
        return;
      case "equalTo": {
        const b = this.pop();
        const a = this.pop();
        this.push(deepEqualsOperands(a, b));
        return;
      }
      case "notEqualTo": {
        const b = this.pop();
        const a = this.pop();
        this.push(!deepEqualsOperands(a, b));
        return;
      }
      case "lessThan": {
        const b = this.pop();
        const a = this.pop();
        this.push(Number(a) < Number(b));
        return;
      }
      case "greaterThan": {
        const b = this.pop();
        const a = this.pop();
        this.push(Number(a) > Number(b));
        return;
      }
      case "lessThanOrEqualTo": {
        const b = this.pop();
        const a = this.pop();
        this.push(Number(a) <= Number(b));
        return;
      }
      case "greaterThanOrEqualTo": {
        const b = this.pop();
        const a = this.pop();
        this.push(Number(a) >= Number(b));
        return;
      }
      case "and": {
        const b = this.pop();
        const a = this.pop();
        // Booleans, like the evaluator's logical evaluator — the drivers'
        // event streams must stay identical for non-bool operands too.
        this.push(Boolean(a && b));
        return;
      }
      case "or": {
        const b = this.pop();
        const a = this.pop();
        this.push(Boolean(a || b));
        return;
      }
      case "not":
        this.push(!this.pop());
        return;
      default:
        throw new Error(`Instruction "${ins.op}" is not a stack operation`);
    }
  }

  private currentInstructions(): Instruction[] {
    // The error branch is unreachable: nodeTitle is only set to resolved titles.
    return this.currentMember()?.instructions ?? [];
  }

  /**
   * The current node — the selected member when the node is a group — for
   * header and instruction-stream reads.
   */
  private currentMember(): ProgramNode | undefined {
    return this.memberFor(this.nodeTitle!, this.currentNodeIndex);
  }

  /** The named node — the given member when the node is a group. */
  private memberFor(title: string, nodeIndex: number): ProgramNode | undefined {
    const nodeOrGroup = this.program.nodes[title];
    if (!nodeOrGroup) return undefined;
    if (!("nodes" in nodeOrGroup)) return nodeOrGroup;
    return nodeIndex >= 0 ? nodeOrGroup.nodes[nodeIndex] : undefined;
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
    this.accumulatedOptions = [];
    if (this.lineHintsEnabled) {
      sink.push({ type: "lineHints", lineIds: this.lineIdsForNode(resolved.node) });
    }
    sink.push({ type: "nodeStart", nodeName: title });
    return true;
  }

  private resolveNodeForEntry(
    title: string,
  ): { ok: true; node: ProgramNode; nodeIndex: number } | { ok: false; message: string } {
    const nodeOrGroup = this.program.nodes[title];
    if (!nodeOrGroup) {
      return { ok: false, message: `No node named "${title}" exists in the program` };
    }
    if (!("nodes" in nodeOrGroup)) {
      return { ok: true, node: nodeOrGroup, nodeIndex: -1 };
    }
    // Node group: select the first member whose `when:` conditions hold
    // (saliency strategies are ticket 47).
    for (let i = 0; i < nodeOrGroup.nodes.length; i++) {
      const candidate = nodeOrGroup.nodes[i];
      if (this.evaluateWhenConditions(candidate.when, title, i)) {
        if (candidate.when?.includes("once")) {
          this.storage[groupOnceVariableKey(`${title}#${i}`)] = true;
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
        if (this.storage[groupOnceVariableKey(`${nodeTitle}#${nodeIndex}`)] === true) {
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
   * Resolve a `runNode`/`detour` target that may be a `{expr}` string
   * expression (upstream allows node names in expressions).
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
   * Execute a `runNode` (a jump): the current node is exited entirely — the
   * visit is recorded and NodeComplete fires, detoured nodes on the return
   * stack record theirs, the return stack is cleared — and the target node
   * is entered.
   */
  private jumpTo(target: string, batch: DialogueEvent[]): void {
    batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
    this.recordVisit(this.nodeTitle!, this.currentNodeIndex);
    for (const frame of this.returnStack) {
      this.recordVisit(frame.title, frame.nodeIndex);
    }
    this.returnStack.length = 0;
    this.enterNode(this.resolveDestination(target), batch);
  }

  /**
   * Handle `<<return>>`: end a detour (pop to the caller and resume it), or
   * act as `<<stop>>` outside a detour.
   */
  private runReturn(batch: DialogueEvent[]): CommandOutcome {
    const frame = this.returnStack[this.returnStack.length - 1];
    if (!frame) {
      // Not inside a detour: <<return>> acts as stop.
      batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
      this.complete(batch);
      return "halted";
    }
    batch.push({ type: "nodeComplete", nodeName: this.nodeTitle! });
    this.recordVisit(this.nodeTitle!, this.currentNodeIndex); // <<return>> is a node return
    this.returnStack.pop();
    this.nodeTitle = frame.title;
    this.ip = frame.ip;
    this.currentNodeIndex = frame.nodeIndex;
    return "continued";
  }

  /**
   * Run one command instruction: state statements (`<<set>>`/`<<declare>>`/
   * `<<call>>`) execute internally and never surface — `<<set>>` reaches
   * here only through the compiler's uncompilable-expression fallback, and
   * `<<stop>>`/`<<return>>` compile to dedicated ops, never raw commands
   * (upstream's compiler does the same) — and any other command is
   * delivered as a `Command` event after invoking its registered Library
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
    if (name === "set" || name === "declare" || name === "call") {
      // State statements are internal (spec, ticket 03 conformance): they
      // execute their effect and never surface as Command events.
      // `<<call>>` bodies do not invoke host functions yet (the `<<call>>`
      // statement story); the compiler validates call targets.
      if (name === "call") {
        this.logDebug(`<<call>> statements do not execute host functions yet: ${content}`);
      } else {
        executeStateStatement(
          { variables: this.storage, evaluator: this.evaluator, logError: this.logError },
          content,
          parsed,
        );
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
    const { text: expandedCommand } = this.compose(content);
    batch.push({ type: "command", command: expandedCommand });
  }

  /**
   * Deliver the accumulated option set: the FULL set in accumulation order,
   * each option's `isAvailable` advisory for the consumer UI (upstream
   * OptionSet semantics). The set awaits selection.
   */
  private deliverOptions(batch: DialogueEvent[]): void {
    const accumulated = this.accumulatedOptions;
    this.accumulatedOptions = [];
    const delivered = accumulated.map((option, index) => {
      const composed = this.compose(option.text, option.markup);
      return {
        index,
        isAvailable: option.isAvailable,
        text: composed.text,
        tags: option.tags,
        markup: composed.markup,
      };
    });
    this.pendingOptions = accumulated;
    batch.push({ type: "options", options: delivered });
  }

  /** Complete the dialogue: no further events are produced after the complete event. */
  private complete(sink: DialogueEvent[] = this.queuedEvents): void {
    this.completed = true;
    this.nodeTitle = null;
    sink.push({ type: "dialogueComplete" });
  }

  // ── Operand stack ───────────────────────────────────────────────────

  private push(value: unknown): void {
    this.stack.push(value);
  }

  private pop(): unknown {
    return this.stack.pop();
  }

  // ── Generated-variable state (coding standards §4) ──────────────────

  /**
   * Record a node visit (upstream records on node return). Nodes with a
   * `tracking: never` header are not recorded. A node carrying a
   * `subtitle:` header records a second count under its qualified name
   * `Title.Subtitle` (upstream node-group naming — the key
   * `visited("Title.Subtitle")` reads).
   */
  private recordVisit(title: string, nodeIndex: number): void {
    const member = this.memberFor(title, nodeIndex);
    if (member?.tracking === "never") return;
    const key = visitCountVariableKey(title);
    this.storage[key] = (Number(this.storage[key]) || 0) + 1;
    if (member?.subtitle) {
      const subKey = visitCountVariableKey(`${title}.${member.subtitle}`);
      this.storage[subKey] = (Number(this.storage[subKey]) || 0) + 1;
    }
  }

  /**
   * The line IDs the given node may deliver: every line's and option's
   * `line:` hashtag in the node's stream — option bodies are inline
   * instructions, so a flat walk covers them all.
   */
  private lineIdsForNode(node: ProgramNode): string[] {
    const ids = new Set<string>();
    for (const ins of node.instructions) {
      if (ins.op === "runLine" || ins.op === "addOption") {
        for (const tag of ins.tags ?? []) {
          if (tag.startsWith("line:")) ids.add(tag.slice("line:".length));
        }
      }
    }
    return [...ids];
  }

  // ── Bytecode initializers ───────────────────────────────────────────

  /**
   * Run an initializer (an `initialValues` or smart-variable program — the
   * expression subset) and return the value it leaves. Errors propagate:
   * the constructor reports them for `initialValues`; a smart variable's
   * failure surfaces through its reader (the evaluator's condition/
   * interpolation contracts).
   */
  private evaluateInitializer(code: Instruction[], name: string): unknown {
    const saved = this.stack.splice(0, this.stack.length);
    try {
      for (const ins of code) {
        if (!INITIALIZER_OPS.has(ins.op)) {
          throw new Error(`Instruction "${ins.op}" is not valid in the initializer of "${name}"`);
        }
        this.executeStackOp(ins);
      }
      const value = this.stack.pop();
      if (this.stack.length > 0 || value === undefined) {
        throw new Error(`Initializer for "${name}" left the operand stack unbalanced`);
      }
      return value;
    } finally {
      this.stack.length = 0;
      this.stack.push(...saved);
    }
  }

  // ── Line composition (substitutions + markup) ───────────────────────

  private compose(text: string, markup?: MarkupParseResult): { text: string; markup?: MarkupParseResult } {
    return interpolate(text, (expr) => this.evaluator.evaluateExpression(expr), markup);
  }
}
