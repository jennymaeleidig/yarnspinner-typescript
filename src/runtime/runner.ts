import type { IRProgram, IRInstruction, IRNode, IRNodeGroup } from "../compile/ir";
import type { MarkupParseResult, MarkupSegment, MarkupWrapper } from "../markup/types.js";
import type { RuntimeResult } from "./results.js";
import { ExpressionEvaluator, stringifyOperand } from "./evaluator.js";
import { CommandHandler, parseCommand } from "./commands.js";
import type { ParsedCommand } from "./commands.js";

export interface RunnerOptions {
  startAt: string;
  variables?: Record<string, unknown>;
  functions?: Record<string, (...args: unknown[]) => unknown>;
  handleCommand?: (command: string, parsed?: ReturnType<typeof parseCommand>) => void;
  commandHandler?: CommandHandler;
  onStoryEnd?: (payload: { variables: Readonly<Record<string, unknown>>; storyEnd: true }) => void;
}

/**
 * Reserved namespace for generated variables: internal state (once-state,
 * visit counts) that lives in the variable storage so it resets with it.
 * Coding standards §4 / CONTEXT.md "Generated variable" — never module
 * globals or runner-owned side tables.
 */
const GENERATED_PREFIX = "Yarn.Internal.";
const onceKey = (id: string) => `${GENERATED_PREFIX}Once:${id}`;
const groupOnceKey = (key: string) => `${GENERATED_PREFIX}GroupOnce:${key}`;
const visitCountKey = (title: string) => `${GENERATED_PREFIX}VisitCount:${title}`;

type CompiledOption = {
  text: string;
  tags?: string[];
  css?: string;
  markup?: MarkupParseResult;
  condition?: string;
  block: IRInstruction[];
};

export class YarnRunner {
  private readonly program: IRProgram;
  private readonly variables: Record<string, unknown>;
  private readonly functions: Record<string, (...args: unknown[]) => unknown>;
  private readonly handleCommand?: (command: string, parsed?: ReturnType<typeof parseCommand>) => void;
  private readonly commandHandler: CommandHandler;
  private readonly evaluator: ExpressionEvaluator;
  private readonly onStoryEnd?: RunnerOptions["onStoryEnd"];
  private storyEnded = false;
  private stopped = false; // set by <<stop>>: further advances do nothing
  private pendingOptions: CompiledOption[] | null = null;

  private nodeTitle: string;
  private ip = 0; // instruction pointer within node
  private currentNodeIndex: number = -1; // Index of selected node in group (-1 if single node)
  private callStack: Array<
    | ({ title: string; ip: number } & { kind: "detour" })
    | ({ title: string; ip: number; block: IRInstruction[]; idx: number } & { kind: "block" })
  > = [];

  currentResult: RuntimeResult | null = null;
  history: RuntimeResult[] = [];

  constructor(program: IRProgram, opts: RunnerOptions) {
    this.program = program;
    this.variables = {};
    this.functions = {
      // Default conversion helpers
      string: (v: unknown) => String(v ?? ""),
      number: (v: unknown) => Number(v),
      bool: (v: unknown) => Boolean(v),
      visited: (nodeName: unknown) => {
        const name = String(nodeName ?? "");
        return (Number(this.variables[visitCountKey(name)]) || 0) > 0;
      },
      visited_count: (nodeName: unknown) => {
        const name = String(nodeName ?? "");
        return Number(this.variables[visitCountKey(name)]) || 0;
      },
      format_invariant: (n: unknown) => {
        const num = Number(n);
        if (!isFinite(num)) return "0";
        return new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 20 }).format(num);
      },
      random: () => Math.random(),
      random_range: (a: unknown, b: unknown) => {
        const x = Number(a), y = Number(b);
        const min = Math.min(x, y);
        const max = Math.max(x, y);
        return min + Math.random() * (max - min);
      },
      dice: (sides: unknown) => {
        const s = Math.max(1, Math.floor(Number(sides)) || 1);
        return Math.floor(Math.random() * s) + 1;
      },
      min: (a: unknown, b: unknown) => Math.min(Number(a), Number(b)),
      max: (a: unknown, b: unknown) => Math.max(Number(a), Number(b)),
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
      ...(opts.functions ?? {}),
    } as Record<string, (...args: unknown[]) => unknown>;
    this.handleCommand = opts.handleCommand;
    this.onStoryEnd = opts.onStoryEnd;
    this.evaluator = new ExpressionEvaluator(this.variables, this.functions, this.program.enums);
    this.commandHandler = opts.commandHandler ?? new CommandHandler(this.variables);

    // Upstream Dialogue.SetProgram seeds the variable storage from
    // Program.InitialValues (the <<declare>>d defaults), so every declared
    // variable exists before the first node runs. Host-provided variables
    // are applied afterwards and override declared defaults.
    for (const content of Object.values(this.program.initialValues)) {
      try {
        void this.commandHandler.execute(parseCommand(content), this.evaluator).catch(() => {});
      } catch {
        // collect-don't-throw: a malformed declaration stays dormant until
        // its node runs and the command handler surfaces it.
      }
    }
    if (opts.variables) {
      for (const [key, value] of Object.entries(opts.variables)) {
        const normalizedKey = key.startsWith("$") ? key.slice(1) : key;
        this.variables[normalizedKey] = value;
      }
    }
    this.nodeTitle = opts.startAt;

    this.step();
  }
  
  /**
   * Get the current node title (may resolve to a node group).
   */
  getCurrentNodeTitle(): string {
    return this.nodeTitle;
  }

  /**
   * Jump immediately to the named node and emit its first event.
   * Variables and per-runtime state (once, visits) are preserved.
   */
  setNode(title: string): void {
    this.storyEnded = false;
    this.stopped = false;
    this.nodeTitle = title;
    this.ip = 0;
    this.currentNodeIndex = -1;
    this.step();
  }

  /**
   * Resolve a node title to an actual node (handling node groups).
   */
  private resolveNode(title: string): IRNode {
    const nodeOrGroup = this.program.nodes[title];
    if (!nodeOrGroup) throw new Error(`Node ${title} not found`);
    
    // If it's a single node, return it
    if (!("nodes" in nodeOrGroup)) {
      this.currentNodeIndex = -1;
      return nodeOrGroup as IRNode;
    }
    
    // It's a node group - select the first matching node based on when conditions
    const group = nodeOrGroup as IRNodeGroup;
    for (let i = 0; i < group.nodes.length; i++) {
      const candidate = group.nodes[i];
      if (this.evaluateWhenConditions(candidate.when, title, i)) {
        this.currentNodeIndex = i;
        // If "once" condition, mark as seen immediately
        if (candidate.when?.includes("once")) {
          this.markGroupOnceSeen(title, i);
        }
        return candidate;
      }
    }
    
    // No matching node found - throw error or return first? Docs suggest error if no match
    throw new Error(`No matching node found in group ${title}`);
  }
  
  /**
   * Evaluate when conditions for a node in a group.
   */
  private evaluateWhenConditions(conditions: string[] | undefined, nodeTitle: string, nodeIndex: number): boolean {
    if (!conditions || conditions.length === 0) {
      // No when condition - available by default (but should not happen in groups)
      return true;
    }
    
    // All conditions must be true (AND logic)
    for (const condition of conditions) {
      const trimmed = condition.trim();
      
      if (trimmed === "once") {
        // Check if this node has been visited once
        const onceKey = `${nodeTitle}#${nodeIndex}`;
        if (this.hasGroupOnceSeen(onceKey)) {
          return false; // Already seen once
        }
        // Will mark as seen when node is entered
        continue;
      }
      
      if (trimmed === "always") {
        // Always available
        continue;
      }
      
      // Otherwise, treat as expression (e.g., "$has_sword")
      if (!this.evaluator.evaluate(trimmed)) {
        return false; // Condition failed
      }
    }
    
    return true; // All conditions passed
  }
  
  /**
   * Mark a node group node as seen (for "once" condition).
   */
  private markGroupOnceSeen(nodeTitle: string, nodeIndex: number): void {
    this.variables[groupOnceKey(`${nodeTitle}#${nodeIndex}`)] = true;
  }

  private hasGroupOnceSeen(key: string): boolean {
    return this.variables[groupOnceKey(key)] === true;
  }

  /** Once-state for <<once>> block ids, as generated variables. */
  private hasOnce(id: string): boolean {
    return this.variables[onceKey(id)] === true;
  }

  private markOnce(id: string): void {
    this.variables[onceKey(id)] = true;
  }

  advance(optionIndex?: number) {
    // If awaiting option selection, consume chosen option by pushing its block
    if (this.currentResult?.type === "options") {
      if (optionIndex == null) throw new Error("Option index required");
      const options = this.pendingOptions;
      if (!options) throw new Error("Invalid options state");
      const chosen = options[optionIndex];
      if (!chosen) throw new Error("Invalid option index");
      // Push a block frame that we will resume across advances
      this.callStack.push({ kind: "block", title: this.nodeTitle, ip: this.ip, block: chosen.block, idx: 0 });
      this.pendingOptions = null;
      if (this.resumeBlock()) return;
      return;
    }
    // If we have a pending block, resume it first
    if (this.resumeBlock()) return;
    this.step();
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

  private resumeBlock(): boolean {
    const top = this.callStack[this.callStack.length - 1];
    if (!top || top.kind !== "block") return false;
    // Execute from stored idx until we emit one result or finish block
    while (true) {
      const ins = top.block[top.idx++];
      if (!ins) {
        // finished block; pop and continue main step
        this.callStack.pop();
        this.step();
        return true;
      }
      switch (ins.op) {
        case "line": {
          const { text: interpolatedText, markup: interpolatedMarkup } = this.interpolate(ins.text, ins.markup);
          this.emit({ type: "text", text: interpolatedText, speaker: ins.speaker, tags: ins.tags, markup: interpolatedMarkup, isDialogueEnd: false });
          return true;
        }
        case "command": {
          const outcome = this.runCommandState(ins.content);
          if (outcome.halted) return true;
          if (outcome.returned) {
            this.step();
            return true;
          }
          // Delivered command text has {expr} substitutions expanded
          // (upstream expands command text before delivery).
          const { text: expandedCommand } = this.interpolate(ins.content);
          this.emit({ type: "command", command: expandedCommand, isDialogueEnd: false });
          return true;
        }
        case "options": {
          const available = this.filterOptions(ins.options);
          if (available.length === 0) {
            continue;
          }
          this.pendingOptions = available;
          this.emit({
            type: "options",
            options: available.map((o) => {
              const { text: interpolatedText, markup: interpolatedMarkup } = this.interpolate(o.text, o.markup);
              return { text: interpolatedText, tags: o.tags, markup: interpolatedMarkup };
            }),
            isDialogueEnd: false,
          });
          return true;
        }
        case "if": {
          const branch = ins.branches.find((b) => (b.condition ? this.evaluator.evaluate(b.condition) : true));
          if (branch) {
            // Push nested block at current top position (resume after)
            this.callStack.push({ kind: "block", title: this.nodeTitle, ip: this.ip, block: branch.block, idx: 0 });
            return this.resumeBlock();
          }
          break;
        }
        case "once": {
          if (!this.hasOnce(ins.id)) {
            this.markOnce(ins.id);
            this.callStack.push({ kind: "block", title: this.nodeTitle, ip: this.ip, block: ins.block, idx: 0 });
            return this.resumeBlock();
          }
          break;
        }
        case "jump": {
          this.performJump(ins.target);
          this.step();
          return true;
        }
        case "detour": {
          this.beginDetour(ins.target);
          this.step();
          return true;
        }
      }
    }
  }

  private step() {
    if (this.stopped) return; // <<stop>> halts the runtime
    while (true) {
      const resolved = this.resolveNode(this.nodeTitle);
      const currentNode: IRNode = { title: this.nodeTitle, instructions: resolved.instructions };
      const ins = currentNode.instructions[this.ip];
      if (!ins) {
        // Node ended
        this.recordVisit(this.nodeTitle);
        this.emit({ type: "text", text: "", nodeCss: resolved.css, scene: resolved.scene, isDialogueEnd: true });
        return;
      }
      this.ip++;
      switch (ins.op) {
        case "line": {
          const { text: interpolatedText, markup: interpolatedMarkup } = this.interpolate(ins.text, ins.markup);
          this.emit({ type: "text", text: interpolatedText, speaker: ins.speaker, tags: ins.tags, markup: interpolatedMarkup, nodeCss: resolved.css, scene: resolved.scene, isDialogueEnd: this.lookaheadIsEnd() });
          return;
        }
        case "command": {
          const outcome = this.runCommandState(ins.content);
          if (outcome.halted) return;
          if (outcome.returned) continue;
          // Delivered command text has {expr} substitutions expanded
          // (upstream expands command text before delivery).
          const { text: expandedCommand } = this.interpolate(ins.content);
          this.emit({ type: "command", command: expandedCommand, isDialogueEnd: this.lookaheadIsEnd() });
          return;
        }
        case "jump": {
          this.performJump(ins.target);
          continue;
        }
        case "detour": {
          this.beginDetour(ins.target);
          continue;
        }
        case "options": {
          const available = this.filterOptions(ins.options);
          if (available.length === 0) {
            continue;
          }
          this.pendingOptions = available;
          this.emit({
            type: "options",
            options: available.map((o) => {
              const { text: interpolatedText, markup: interpolatedMarkup } = this.interpolate(o.text, o.markup);
              return { text: interpolatedText, tags: o.tags, css: o.css, markup: interpolatedMarkup };
            }),
            nodeCss: resolved.css,
            scene: resolved.scene,
            isDialogueEnd: this.lookaheadIsEnd(),
          });
          return;
        }
        case "if": {
          const branch = ins.branches.find((b: { condition: string | null; block: IRInstruction[] }) => (b.condition ? this.evaluator.evaluate(b.condition) : true));
          if (branch) {
            this.callStack.push({ kind: "block", title: this.nodeTitle, ip: this.ip, block: branch.block, idx: 0 });
            if (this.resumeBlock()) return;
          }
          break;
        }
        case "once": {
          if (!this.hasOnce(ins.id)) {
            this.markOnce(ins.id);
            this.callStack.push({ kind: "block", title: this.nodeTitle, ip: this.ip, block: ins.block, idx: 0 });
            if (this.resumeBlock()) return;
          }
          break;
        }
      }
    }
  }

  private filterOptions(options: CompiledOption[]): CompiledOption[] {
    const available: CompiledOption[] = [];
    for (const option of options) {
      if (!option.condition) {
        available.push(option);
        continue;
      }
      try {
        if (this.evaluator.evaluate(option.condition)) {
          available.push(option);
        }
      } catch {
        // Treat errors as false conditions
      }
    }
    return available;
  }

  /**
   * Handle `<<stop>>`: halt dialogue immediately and deliver the complete event.
   */
  private haltNow(): void {
    this.callStack.length = 0;
    this.stopped = true;
    this.emit({ type: "text", text: "", isDialogueEnd: true });
  }

  private maybeStop(parsed: ParsedCommand): boolean {
    if (parsed.name.toLowerCase() !== "stop") return false;
    this.haltNow();
    return true;
  }

  /**
   * Run a command instruction's state effects (`<<return>>`/`<<stop>>`/
   * variable statements/delivered-command handling). Shared by `step()` and
   * `resumeBlock()`, which differ only in how they emit and resume.
   */
  private runCommandState(content: string): { halted: boolean; returned: boolean } {
    try {
      const parsed = parseCommand(content);
      if (parsed.name.toLowerCase() === "return") {
        if (this.maybeReturn()) return { halted: false, returned: true };
        this.haltNow(); // <<return>> outside a detour acts as stop
        return { halted: true, returned: false };
      }
      if (this.maybeStop(parsed)) return { halted: true, returned: false };
      this.commandHandler.execute(parsed, this.evaluator).catch(() => {});
      if (this.handleCommand) this.handleCommand(content, parsed);
    } catch {
      if (this.handleCommand) this.handleCommand(content);
    }
    return { halted: false, returned: false };
  }

  /**
   * Execute a `jump` instruction: the current node is exited entirely — the
   * visit is recorded, detoured nodes on the return stack record theirs, and
   * any in-progress block frames are abandoned (upstream jump semantics).
   */
  private performJump(target: string): void {
    this.recordVisit(this.nodeTitle);
    for (const frame of this.callStack) {
      if (frame.kind === "detour") {
        this.recordVisit(frame.title);
      }
    }
    this.callStack.length = 0;
    this.nodeTitle = this.resolveDestination(target);
    this.ip = 0;
    this.currentNodeIndex = -1;
  }

  /** Begin a detour: save the return position and enter the target node. */
  private beginDetour(target: string): void {
    this.callStack.push({ kind: "detour", title: this.nodeTitle, ip: this.ip });
    this.nodeTitle = this.resolveDestination(target);
    this.ip = 0;
    this.currentNodeIndex = -1;
  }

  /**
   * Handle `<<return>>`: end a detour (pop to the caller and resume it), or
   * act as stop outside a detour.
   */
  private maybeReturn(): boolean {
    // Abandon in-progress block frames down to the nearest detour frame.
    while (this.callStack.length > 0 && this.callStack[this.callStack.length - 1].kind === "block") {
      this.callStack.pop();
    }
    const frame = this.callStack[this.callStack.length - 1];
    if (!frame || frame.kind !== "detour") {
      return false; // not inside a detour: handled as stop by the caller
    }
    this.callStack.pop();
    this.recordVisit(this.nodeTitle); // <<return>> is a node return
    this.nodeTitle = frame.title;
    this.ip = frame.ip;
    this.currentNodeIndex = -1;
    return true;
  }

  /**
   * Record a node visit (upstream records on node return). Nodes with a
   * `tracking: never` header are not recorded.
   */
  private recordVisit(title: string): void {
    if (this.trackingSuppressedFor(title)) return;
    const key = visitCountKey(title);
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

  private lookaheadIsEnd(): boolean {
    // Check if current node has more emit-worthy instructions
    const node = this.resolveNode(this.nodeTitle);
    for (let k = this.ip; k < node.instructions.length; k++) {
      const op = node.instructions[k]?.op;
      if (!op) break;
      if (op === "line" || op === "options" || op === "command" || op === "if" || op === "once") return false;
      if (op === "jump" || op === "detour") return false;
    }
    // Node is ending - mark as end (will trigger detour return if callStack exists)
    return true;
  }

  private emit(res: RuntimeResult) {
    this.currentResult = res;
    this.history.push(res);
    if (res.isDialogueEnd && !this.storyEnded && this.callStack.length === 0) {
      this.storyEnded = true;
      if (this.onStoryEnd) {
        // Story-end payload exposes the story's variables, not the runtime's
        // generated ones.
        const variablesCopy = Object.freeze({ ...this.storyVariables() });
        this.onStoryEnd({ storyEnd: true, variables: variablesCopy });
      }
    }
    // If we ended a detour node, return to caller after emitting last result
    // Position is restored here, but we wait for next advance() to continue
    if (res.isDialogueEnd && this.callStack.length > 0) {
      // A node returning from a detour records its visit (upstream records on
      // node return). The empty end-marker already counted in step().
      if (!(res.type === "text" && res.text === "")) {
        this.recordVisit(this.nodeTitle);
      }
      const frame = this.callStack.pop()!;
      this.nodeTitle = frame.title;
      this.ip = frame.ip;
    }
  }

  /** Story variables: the storage minus generated variables. */
  private storyVariables(): Record<string, unknown> {
    const visible: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.variables)) {
      if (!key.startsWith(GENERATED_PREFIX)) visible[key] = value;
    }
    return visible;
  }

  /**
   * Get the current variable store (read-only view, generated variables excluded).
   */
  getVariables(): Readonly<Record<string, unknown>> {
    return this.storyVariables();
  }

  /**
   * Get variable value.
   */
  getVariable(name: string): unknown {
    return this.variables[name];
  }

  /**
   * Set variable value.
   */
  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
    this.evaluator.setVariable(name, value);
  }
}


