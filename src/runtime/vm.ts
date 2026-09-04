// SPDX-License-Identifier: CC0-1.0
/**
 * The instruction-stream VM (ADR 0001): executes the compiled `Program` —
 * per-node instruction streams whose expressions are bytecode and whose
 * jumps are instruction indices — end-to-end behind the public runtime API
 * (`Dialogue` dispatches here).
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
 * - Saliency (upstream `Yarn.Saliency`): node-group entries
 *   build a candidate per member from its `when:` conditions and let the
 *   active strategy pick (upstream's hub-node
 *   AddSaliencyCandidateFromNode/SelectSaliencyCandidate sequence, run
 *   here at node entry); line groups drive the same machinery through the
 *   `addSaliencyCandidate`/`selectSaliencyCandidate`/`popJump` ops. The
 *   strategy defaults to Random Best-Least-Recently-Viewed; its view
 *   counts (the saliency history) are generated variables in storage.
 * - State commands (`<<set>>`/`<<declare>>`/`<<call>>`/`<<set_saliency>>`)
 *   never surface as `Command` events; lines and commands keep authored
 *   text and compose at delivery through the shared line parser
 *   (`interpolate`).
 * - Stack-op semantics are the operand-semantics module (`./operands.ts`,
 *   also home to the string evaluator's copies of these rules — one
 *   statement of every operator rule for both drivers' event streams):
 *   `add` concatenates when either operand is a string (rendering operands
 *   the upstream way), equality is `deepEqualsOperands` (unset variables
 *   compare against their typed default), relational ops coerce through
 *   `Number()`, and branch ops branch on truthiness (conditions compile to
 *   booleans).
 * - Runtime failures are diagnostics, not throws (coding standards §3):
 *   they surface through `logError`, the operand stack is re-balanced with
 *   a `null`, and execution continues.
 *
 * Story state (variables, generated variables, smart variables) lives in
 * the variable storage / evaluator (coding standards §4) — the engine is
 * stateless across instances.
 */

import type { Instruction, Program, ProgramNode } from "../compile/program.js";
import { compileExpression, EXPRESSION_OPS, LITERAL_OPS } from "../compile/expressionCodegen.js";
import { ForeignOpError, UnbalancedStackError, runBytecode, type BytecodeEnv } from "./bytecode.js";
import type { MarkupParseResult } from "../markup/types.js";
import {
  defaultStartNodeName,
  noOptionSelected,
  type DialogueEvent,
  type DialogueOptions,
  lineIdFromTags,
} from "./events.js";
import { Library, type YarnFunction } from "./library.js";
import { ExpressionEvaluator } from "./evaluator.js";
import { applyBinaryOp, applyUnaryOp } from "./operands.js";
import { commandKind, executeStateStatement, parseCommand, stripQuotes, type ParsedCommand } from "./commands.js";
import { LineComposer } from "./interpolate.js";
import { LineParser } from "../markup/lineParser.js";
import { registerBuiltinFunctions } from "./builtins.js";
import {
  contentViewCountVariableKey,
  generatedVariablePrefix,
  onceVariableKey,
  visitCountVariableKey,
} from "./generatedVariables.js";
import {
  defaultSaliencyStrategy,
  nodeGroupMemberId,
  parseSaliencyCondition,
  saliencyConditionComplexity,
  saliencyStrategyForMode,
  SALIENCY_MODES,
  type ContentSaliencyOption,
  type ContentSaliencyStrategy,
  type SaliencyState,
} from "./saliency.js";
import type { TextProvider } from "./textProvider.js";
import { InMemoryVariableStorage, type VariableStorage } from "./variableStorage.js";
import { describeError } from "../describeError.js";
import type { ProgramNodeGroup } from "../compile/program.js";

/** Outcome of executing one command instruction. */
type CommandOutcome = "continued" | "delivered" | "halted";

/** A saved return position on the detour/return call stack. */
type ReturnFrame = { title: string; ip: number; nodeIndex: number };

/** An option accumulated by `addOption`, awaiting delivery by `showOptions`. */
type AccumulatedOption = { text: string; tags?: string[]; destination: number; isAvailable: boolean };

/** Ops whose execution leaves the operand stack one value richer; on a
 * caught failure the VM pushes `null` so the stream stays balanced.
 * Derived from the emitter's declared expression subset (imported from
 * `expressionCodegen.ts` — the classification's single home) plus the one
 * non-expression producer the main loop executes. */
const STACK_PRODUCERS: ReadonlySet<Instruction["op"]> = new Set([
  ...[...EXPRESSION_OPS].filter((op) => !LITERAL_OPS.has(op)),
  "selectSaliencyCandidate",
]);

export class VirtualMachine {
  private readonly program: Program;
  /** The variable storage: story variables plus generated variables (coding standards §4). */
  private readonly storage: VariableStorage;
  /** The runtime's library: built-ins + imported host entries. */
  private readonly library: Library;
  private readonly evaluator: ExpressionEvaluator;
  private readonly lineHintsEnabled: boolean;
  private readonly logError: (message: string) => void;
  private readonly logDebug: (message: string) => void;
  /** The host's text provider; null — the program's text is the base language. */
  private readonly textProvider: TextProvider | null;

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
  /** Saliency candidates accumulated by `addSaliencyCandidate` (line groups). */
  private saliencyCandidates: ContentSaliencyOption[] = [];
  /** The saliency history: view counts as generated variables in storage. */
  private readonly saliencyState: SaliencyState;
  /** The active saliency strategy (default: Random BLRV — upstream's default). */
  private saliencyStrategy: ContentSaliencyStrategy;
  private completed = false;
  /** A `DialogueComplete` event has been delivered (the `isComplete` getter) —
   *  distinct from `completed`: `stop()` completes the machine immediately but
   *  its complete event only delivers on the next `continue()`. */
  private completeDelivered = false;

  constructor(program: Program, opts: DialogueOptions = {}) {
    this.program = program;
    // Pluggable variable storage: the host's implementation
    // when injected, the in-memory default otherwise. All story state —
    // story variables and generated variables alike — lives here.
    this.storage = opts.variableStorage ?? new InMemoryVariableStorage();
    this.library = new Library();
    // The saliency history lives in variable storage under generated keys
    // (coding standards §4); the default strategy is Random BLRV.
    this.saliencyState = {
      getViewCount: (contentId) => Number(this.storage.get(contentViewCountVariableKey(contentId))) || 0,
      recordView: (contentId) => {
        const key = contentViewCountVariableKey(contentId);
        this.storage.set(key, (Number(this.storage.get(key)) || 0) + 1);
      },
    };
    this.saliencyStrategy = opts.contentSaliencyStrategy ?? defaultSaliencyStrategy(this.saliencyState);
    registerBuiltinFunctions(this.library, () => this.storage);
    // Upstream Dialogue registers has_any_content over the program and the
    // saliency strategy; a host library imported below may override it.
    this.library.registerFunction("has_any_content", (nodeGroup: unknown) => {
      const name = String(nodeGroup ?? "");
      const entry = this.program.nodes[name];
      if (!entry) return false; // no node with this name — no content at all
      if (!("nodes" in entry)) return true; // not a node group: always content
      return this.contentSaliencyStrategy.queryBestContent(this.saliencyOptionsForGroup(entry)) !== null;
    });
    if (opts.library) this.library.importLibrary(opts.library);
    this.lineHintsEnabled = opts.lineHints ?? false;
    this.logError = opts.logError ?? ((message) => console.error(message));
    this.logDebug = opts.logDebug ?? (() => {});
    this.textProvider = opts.textProvider ?? null;
    this.evaluator = new ExpressionEvaluator(
      this.storage,
      {
        get: (name: string): YarnFunction | undefined =>
          this.library.hasFunction(name) ? this.library.getFunction(name) : undefined,
      },
      this.program.enums,
    );

    // Smart variables: compiled initializers, recomputed on
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
      // Pluggable storage: a name the injected storage
      // already holds is restored host state — declare defaults never
      // clobber it. The in-memory default starts empty, so every declared
      // variable is seeded on a fresh dialogue exactly as before.
      if (this.storage.has(name)) continue;
      try {
        this.storage.set(name, this.evaluateInitializer(code, name));
      } catch (e) {
        this.logError(
          `Failed to initialize variable "${name}": ${describeError(e)}`,
        );
      }
    }
    if (opts.variables) {
      for (const [key, value] of Object.entries(opts.variables)) {
        const normalizedKey = key.startsWith("$") ? key.slice(1) : key;
        this.storage.set(normalizedKey, value);
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

  // ── Public surface (the Dialogue facade dispatches here) ──

  /** The node currently executing, or `null` when the dialogue is not active. */
  get currentNode(): string | null {
    return this.nodeTitle;
  }

  /** Whether the dialogue is running a node (not yet completed). */
  get isActive(): boolean {
    return !this.completed;
  }

  /** A delivered option set awaits selection (Rust
   *  `is_waiting_for_option_selection`); `continue()` logs and returns no
   *  events while true (the recorded divergence). */
  get isWaitingForOptionSelection(): boolean {
    return this.pendingOptions !== null;
  }

  /** A `DialogueComplete` event has been delivered; the contract lives on
   *  `Dialogue.isComplete` (the public surface). */
  get isComplete(): boolean {
    return this.completeDelivered;
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
      if (drained.length > 0) {
        this.noteCompleteDelivery(drained);
        return drained;
      }
      this.logDebug("continue() called on an inactive dialogue; no events returned");
      return [];
    }
    const batch = this.queuedEvents;
    this.queuedEvents = [];
    this.run(batch);
    this.noteCompleteDelivery(batch);
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
    this.completeDelivered = false;
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
    for (const [key, value] of this.storage.entries()) {
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
    this.storage.set(name, value);
    this.evaluator.setVariable(name, value);
  }

  /** Upstream `Dialogue.TryGetSmartVariable`: compute a smart variable's current value. */
  tryGetSmartVariable(name: string): { ok: true; value: unknown } | { ok: false } {
    return this.evaluator.tryGetSmartVariable(name);
  }

  // ── Saliency ───────────────────────────────────────────────────────

  /** The active content saliency strategy (upstream `Dialogue.ContentSaliencyStrategy`). */
  get contentSaliencyStrategy(): ContentSaliencyStrategy {
    return this.saliencyStrategy;
  }

  set contentSaliencyStrategy(strategy: ContentSaliencyStrategy) {
    this.saliencyStrategy = strategy;
  }

  /**
   * Switch to a named built-in strategy (the project's `<<set_saliency>>`
   * mode vocabulary). Returns `false` for an unknown mode, leaving the
   * active strategy unchanged.
   */
  setSaliencyStrategy(mode: string): boolean {
    const strategy = saliencyStrategyForMode(mode, this.saliencyState);
    if (!strategy) return false;
    this.saliencyStrategy = strategy;
    return true;
  }

  /** Upstream `Dialogue.IsNodeGroup`: whether the name is a node group. */
  isNodeGroup(nodeName: string): boolean {
    const entry = this.program.nodes[nodeName];
    return entry !== undefined && "nodes" in entry;
  }

  /**
   * Upstream `Dialogue.GetSaliencyOptionsForNodeGroup`: the saliency
   * options the node group (or plain node) could run, evaluated against
   * the current variable state. Read-only. An unknown name is a runtime
   * diagnostic returning no options (upstream throws).
   */
  getSaliencyOptionsForNodeGroup(nodeGroup: string): ContentSaliencyOption[] {
    const entry = this.program.nodes[nodeGroup];
    if (!entry) {
      this.logError(`"${nodeGroup}" is not a valid node name`);
      return [];
    }
    if (!("nodes" in entry)) {
      // A plain node: a single passing option (upstream behavior).
      return [
        {
          contentId: nodeGroup,
          complexityScore: 0,
          passingConditionValueCount: 1,
          failingConditionValueCount: 0,
          contentType: "node",
        },
      ];
    }
    return this.saliencyOptionsForGroup(entry);
  }

  /** Upstream `Dialogue.HasSalientContent`: whether the strategy could select content for the node group. */
  hasSalientContent(nodeGroup: string): boolean {
    return this.contentSaliencyStrategy.queryBestContent(this.getSaliencyOptionsForNodeGroup(nodeGroup)) !== null;
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
            // Text resolution: the provider's text for the line's
            // canonical ID wins; without a provider — or a line it lacks —
            // the program's own text is the base language. Composition
            // (substitutions + markup) runs on whatever text resolved.
            const lineId = lineIdFromTags(ins.tags);
            const composed = this.compose(this.resolveLineText(ins.tags, ins.text));
            batch.push({
              type: "line",
              lineId,
              speaker: composed.speaker,
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
              // The availability (the evaluated condition, or `true` for
              // unconditioned options) is on the stack — upstream AddOption.
              isAvailable: Boolean(this.pop()),
            });
            continue;
          }
          case "showOptions":
            this.deliverOptions(batch);
            return;
          case "addSaliencyCandidate": {
            // The item's evaluated condition (or `pushBool true`) is on the
            // stack — upstream AddSaliencyCandidate.
            const condition = Boolean(this.pop());
            this.saliencyCandidates.push({
              contentId: ins.contentId,
              complexityScore: ins.complexity,
              passingConditionValueCount: condition ? 1 : 0,
              failingConditionValueCount: condition ? 0 : 1,
              contentType: "line",
              destination: ins.destination,
            });
            continue;
          }
          case "selectSaliencyCandidate": {
            // Ask the strategy to pick (upstream SelectSaliencyCandidate);
            // push (destination, true) on a selection, or just false.
            const candidates = this.saliencyCandidates;
            this.saliencyCandidates = [];
            let selected = this.saliencyStrategy.queryBestContent(candidates);
            if (selected && !candidates.includes(selected)) {
              // Forgive value-copying strategies: match by content ID.
              // Upstream throws DialogueException on a non-candidate;
              // coding standards §3 (collect, don't throw) applies: a
              // diagnostic surfaces and the group runs nothing.
              const match = candidates.find((c) => c.contentId === selected!.contentId);
              if (!match) {
                this.logError(
                  `Content saliency strategy returned "${selected.contentId}", which is not one of the available candidates`,
                );
                selected = null;
              } else {
                selected = match;
              }
            }
            if (selected) {
              this.saliencyStrategy.contentWasSelected(selected);
              this.push(selected.destination);
              this.push(true);
            } else {
              this.push(false);
            }
            continue;
          }
          case "popJump":
            this.ip = Number(this.pop());
            continue;
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
          case "xor":
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
          `Failed to execute ${ins.op}: ${describeError(e)}`,
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
        this.storage.set(ins.name, this.pop());
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
      case "add":
      case "subtract":
      case "multiply":
      case "divide":
      case "modulo":
      case "equalTo":
      case "notEqualTo":
      case "lessThan":
      case "greaterThan":
      case "lessThanOrEqualTo":
      case "greaterThanOrEqualTo":
      case "and":
      case "xor":
      case "or": {
        // The operand semantics live in one module (./operands.ts) — the
        // string evaluator dispatches through the same applyBinaryOp, so a
        // rule stated there holds for both drivers' event streams.
        const b = this.pop();
        const a = this.pop();
        this.push(applyBinaryOp(ins.op, a, b));
        return;
      }
      case "negate":
      case "not":
        this.push(applyUnaryOp(ins.op, this.pop()));
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
   * group with no salient content) completes the dialogue — execution
   * cannot proceed. An unknown node reports a diagnostic; a node group
   * with no salient content is normal flow (upstream's hub node simply
   * returns) and completes silently.
   */
  private enterNode(title: string, sink: DialogueEvent[]): boolean {
    const resolved = this.resolveNodeForEntry(title);
    if (!resolved.ok) {
      if (resolved.message) this.logError(resolved.message);
      this.complete(sink);
      return false;
    }
    this.nodeTitle = title;
    this.ip = 0;
    this.currentNodeIndex = resolved.nodeIndex;
    this.accumulatedOptions = [];
    const lineIds = this.lineIdsForNode(resolved.node);
    // The provider's lookahead runs whether or not the opt-in LineHints
    // event is enabled (Rust `accept_line_hints` feeds availability).
    this.textProvider?.acceptLineHints?.(lineIds);
    if (this.lineHintsEnabled) {
      sink.push({ type: "lineHints", lineIds });
    }
    sink.push({ type: "nodeStart", nodeName: title, scene: resolved.node.scene });
    return true;
  }

  private resolveNodeForEntry(
    title: string,
  ): { ok: true; node: ProgramNode; nodeIndex: number } | { ok: false; message?: string } {
    const nodeOrGroup = this.program.nodes[title];
    if (!nodeOrGroup) {
      return { ok: false, message: `No node named "${title}" exists in the program` };
    }
    if (!("nodes" in nodeOrGroup)) {
      return { ok: true, node: nodeOrGroup, nodeIndex: -1 };
    }
    // Node group: build a saliency candidate per member from
    // its `when:` conditions, and let the strategy pick (upstream: the hub
    // node's AddSaliencyCandidateFromNode/SelectSaliencyCandidate sequence).
    const selected = this.saliencyStrategy.queryBestContent(this.saliencyOptionsForGroup(nodeOrGroup));
    if (!selected) {
      // No salient content: the hub returns — the dialogue completes if
      // nothing else remains (upstream NodeGroupCompiler emits a bare Return).
      return { ok: false };
    }
    const nodeIndex = nodeOrGroup.nodes.findIndex(
      (m, i) => nodeGroupMemberId(title, m, i) === selected.contentId,
    );
    const member = nodeOrGroup.nodes[nodeIndex];
    if (nodeIndex < 0 || !member) {
      return { ok: false, message: `Node group "${title}" selected an unknown member` };
    }
    // Commit the selection: the strategy records the view (its BLRV state),
    // and any `when: once` header's seen-state stores now (upstream: the
    // hub sets the once variable just before detouring into the member).
    this.saliencyStrategy.contentWasSelected(selected);
    for (const raw of member.when ?? []) {
      const parsed = parseSaliencyCondition(raw);
      if (parsed.kind === "once" || parsed.kind === "once-if") {
        this.storage.set(onceVariableKey(selected.contentId), true);
      }
    }
    return { ok: true, node: member, nodeIndex };
  }

  /**
   * The node group's saliency options (upstream
   * `SmartVariableEvaluationVirtualMachine.GetSaliencyOptionsForNodeGroup`):
   * one option per member, each condition evaluated against the current
   * variable state, with the member's complexity score. Read-only.
   */
  private saliencyOptionsForGroup(group: ProgramNodeGroup): ContentSaliencyOption[] {
    return group.nodes.map((member, index) => {
      const contentId = nodeGroupMemberId(group.title, member, index);
      let complexityScore = 0;
      let passingConditionValueCount = 0;
      let failingConditionValueCount = 0;
      for (const raw of member.when ?? []) {
        complexityScore += saliencyConditionComplexity(raw);
        if (this.evaluateSaliencyCondition(raw, contentId)) {
          passingConditionValueCount += 1;
        } else {
          failingConditionValueCount += 1;
        }
      }
      return {
        contentId,
        complexityScore,
        passingConditionValueCount,
        failingConditionValueCount,
        contentType: "node" as const,
      };
    });
  }

  /** Evaluate one `when:` condition (read-only — a `once` header reads its seen-state).
   *  Expressions compile to bytecode (the compiler's expression codegen —
   *  the full upstream expression grammar, word aliases included) and run
   *  through the VM's own stack machinery; an uncompilable expression falls
   *  back to the string evaluator (catch → false). */
  private evaluateSaliencyCondition(raw: string, contentId: string): boolean {
    const parsed = parseSaliencyCondition(raw);
    switch (parsed.kind) {
      case "always":
        return true;
      case "once":
        return this.storage.get(onceVariableKey(contentId)) !== true;
      case "once-if":
        return this.storage.get(onceVariableKey(contentId)) !== true && this.evaluateConditionExpression(parsed.expression);
      case "expression":
        return this.evaluateConditionExpression(parsed.expression);
    }
  }

  /** Lazily compiled saliency-condition expressions, keyed by source text. */
  private readonly conditionCode = new Map<string, Instruction[] | null>();

  /** Evaluate a condition expression: bytecode when it compiles (upstream
   *  compiles `when:` conditions to smart variables), else the string
   *  evaluator's catch → false. Errors are contained to the expression. */
  private evaluateConditionExpression(expression: string): boolean {
    let code = this.conditionCode.get(expression);
    if (code === undefined) {
      try {
        code = compileExpression(expression, this.program.enums);
      } catch {
        code = null;
      }
      this.conditionCode.set(expression, code);
    }
    if (!code) return this.evaluator.evaluate(expression);
    // The slice runner owns the stack save/restore; the condition path's
    // failure policy stays here: a foreign op (an expression whose compiled
    // form outlived its semantics) falls back to the string evaluator, any
    // other failure is a contained diagnostic → false.
    try {
      return Boolean(runBytecode(code, this.sliceEnv()));
    } catch (e) {
      if (e instanceof ForeignOpError) return this.evaluator.evaluate(expression);
      this.logError(
        `Failed to evaluate saliency condition "${expression}": ${describeError(e)}`,
      );
      return false;
    }
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
    const kind = commandKind(parsed.name);
    if (kind === "setSaliency") {
      // Internal: it never surfaces as an event.
      const mode = (parsed.args[0] ?? "").trim();
      if (!this.setSaliencyStrategy(mode)) {
        this.logError(
          `Unknown saliency strategy "${mode}" (expected one of: ${SALIENCY_MODES.join(", ")})`,
        );
      }
      return "continued";
    }
    if (kind === "set" || kind === "declare" || kind === "call") {
      // State statements are internal (spec conformance): they
      // execute their effect and never surface as Command events.
      if (kind === "call") {
        // `<<call>>` invokes the host function and discards the result
        // (upstream CallStatement — the compiler validated
        // the target). Side effects are the point: the conformance
        // fixtures call `assert(...)` through it. An unknown function or
        // failing evaluation is a runtime diagnostic, not a crash
        // (coding standards §3).
        const expression = content.replace(/^call\b/, "").trim();
        // The out-of-band failure signal (docs/compatibility.md, the
        // fallback-execution divergence): a
        // garbage `<<call>>` payload (e.g. `call 1 2`) resolves to no value
        // instead of throwing, so the soft contract stayed silent. Failed
        // evaluation is a runtime diagnostic, not a crash (coding
        // standards §3); the result is discarded either way.
        const called = this.evaluator.tryEvaluateExpression(expression);
        if (!called.ok) {
          // The failure result carries the cause: an unresolvable value
          // (EvaluationFailure) or a thrown evaluation error (unknown
          // function, bad argument) — the historical message shape keeps
          // the cause visible either way.
          this.logError(
            `<<call>> failed: ${describeError(called.error)}`,
          );
        }
      } else {
        executeStateStatement(
          { variables: this.storage, evaluator: this.evaluator, logError: this.logError },
          content,
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
          this.logError(`Command handler for "${parsed.name}" failed: ${describeError(e)}`);
        }
      }
    }
    const expandedCommand = this.expandCommand(content);
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
      // Options resolve text through the provider like lines —
      // at delivery, so a setLanguage between accumulation and delivery
      // still applies — and compose like lines (substitutions + markup,
      // implicit character attribute enabled — upstream
      // GetComposedTextForLine) but deliver the full text with the speaker
      // prefix intact.
      const composed = this.getOrCreateComposer().composeOption(
        this.resolveLineText(option.tags, option.text),
      );
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

  /** Mark completion when a delivered batch carried the complete event —
   *  `isComplete` answers "delivered", not "queued" (the `stop()` edge). */
  private noteCompleteDelivery(batch: DialogueEvent[]): void {
    if (!this.completeDelivered && batch.some((event) => event.type === "dialogueComplete")) {
      this.completeDelivered = true;
    }
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
    this.storage.set(key, (Number(this.storage.get(key)) || 0) + 1);
    if (member?.subtitle) {
      const subKey = visitCountVariableKey(`${title}.${member.subtitle}`);
      this.storage.set(subKey, (Number(this.storage.get(subKey)) || 0) + 1);
    }
  }

  /**
   * The line IDs the given node may deliver: every line's and option's
   * canonical `line:`-prefixed ID in the node's stream — option bodies are
   * inline instructions, so a flat walk covers them all.
   */
  private lineIdsForNode(node: ProgramNode): string[] {
    const ids = new Set<string>();
    for (const ins of node.instructions) {
      if (ins.op === "runLine" || ins.op === "addOption") {
        const id = lineIdFromTags(ins.tags);
        if (id !== undefined) ids.add(id);
      }
    }
    return [...ids];
  }

  // ── Bytecode initializers ───────────────────────────────────────────

  /**
   * Run an initializer (an `initialValues` or smart-variable program — the
   * expression subset) and return the value it leaves. The slice runner
   * owns the stack and the failure modes; this call site adds the
   * initializer's name context and lets errors propagate: the constructor
   * reports them for `initialValues`; a smart variable's failure surfaces
   * through its reader (the evaluator's condition/interpolation
   * contracts).
   */
  private evaluateInitializer(code: Instruction[], name: string): unknown {
    try {
      return runBytecode(code, this.sliceEnv());
    } catch (e) {
      if (e instanceof ForeignOpError) {
        throw new Error(`Instruction "${e.op}" is not valid in the initializer of "${name}"`);
      }
      if (e instanceof UnbalancedStackError) {
        throw new Error(`Initializer for "${name}" left the operand stack unbalanced`);
      }
      throw e;
    }
  }

  /** The slice-runner environment over this VM's stack and op executor. */
  private sliceEnv(): BytecodeEnv {
    return { stack: this.stack, executeOp: (ins) => this.executeStackOp(ins) };
  }

  // ── Text resolution ───────────────────────────────────────────────

  /**
   * The provider's text for the canonical line ID in `tags`, or `fallback`
   * — the program's own text, the base language — when there is no
   * provider or the provider has no text for the line.
   */
  private resolveLineText(tags: string[] | undefined, fallback: string): string {
    const lineId = lineIdFromTags(tags);
    if (lineId !== undefined && this.textProvider !== null) {
      const resolved = this.textProvider.getText(lineId);
      if (resolved !== undefined) return resolved;
    }
    return fallback;
  }

  // ── Line composition (substitutions + markup) ─────────────────────

  /** The line composer: substitutions, markup, and speaker resolution. */
  private composer: LineComposer | null = null;

  private compose(text: string): { text: string; speaker?: string; markup?: MarkupParseResult } {
    return this.getOrCreateComposer().composeLine(text);
  }

  /**
   * Expand `{expr}` substitutions in command text only — upstream runs
   * commands through `ExpandSubstitutions` alone, never through the markup
   * parser (so a colon in `<<hide Collision:GermOnPorch>>` is not a speaker
   * separator).
   */
  private expandCommand(text: string): string {
    return this.getOrCreateComposer().interpolate(text);
  }

  /** The locale replacement markers compose under (upstream `Dialogue.LocaleCode`). */
  getLocale(): string {
    return this.getOrCreateComposer().getLocale();
  }

  /** Override the locale replacement markers resolve under. */
  setLocale(localeCode: string): void {
    this.getOrCreateComposer().setLocale(localeCode);
  }

  /** The line parser, for host marker-processor registration. */
  getLineParser(): LineParser {
    return this.getOrCreateComposer().getParser();
  }

  // ── Localisation ───────────────────────────────────────────────────────

  /**
   * Switch the active language (BCP-47; `null` selects the base language —
   * the program's own text) on the injected text provider. Reports a
   * diagnostic when no text provider was provided; the guard's home is
   * here, where the provider lives.
   */
  setLanguage(language: string | null): void {
    if (this.textProvider === null) {
      this.logError(
        "setLanguage was called, but no text provider was provided to this Dialogue",
      );
      return;
    }
    this.textProvider.setLanguage(language);
  }

  private getOrCreateComposer(): LineComposer {
    if (this.composer === null) {
      this.composer = new LineComposer((expr) => this.evaluator.evaluateExpression(expr));
    }
    return this.composer;
  }
}
