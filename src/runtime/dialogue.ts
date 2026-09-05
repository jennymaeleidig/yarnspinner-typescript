// SPDX-License-Identifier: CC0-1.0
/**
 * The runtime (`Dialogue`): pull-based execution of a compiled program
 * (ADR 0002).
 *
 * The compiled program is the instruction-stream artifact (ADR 0001/0003);
 * the tree-IR driver is retired and `Dialogue` executes it
 * through the `VirtualMachine` (./vm.js). Consumers never drive the machine
 * directly — this facade is the runtime's public surface.
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

import type { Program } from "../compile/program.js";
import { Library } from "./library.js";
import type { ContentSaliencyOption, ContentSaliencyStrategy } from "./saliency.js";
import {
  noOptionSelected,
  type DialogueEvent,
  type DialogueOptions,
} from "./events.js";
import { VirtualMachine } from "./vm.js";
import type { LineParser } from "../markup/lineParser.js";

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
export { InMemoryVariableStorage } from "./variableStorage.js";
export type { VariableStorage } from "./variableStorage.js";
export type { YarnFunction, CommandHandler } from "./library.js";

/**
 * The runtime object that executes a program and yields dialogue events
 * (CONTEXT.md "Dialogue"): the instruction-stream VM behind the public
 * surface.
 */
export class Dialogue {
  private readonly engine: VirtualMachine;
  /**
   * The program this dialogue executes (upstream `Dialogue.Program`). Held
   * here for the host-side query API — the queries read the compiled
   * program's node table without touching the execution engine.
   */
  private readonly program: Program;
  /** Runtime error diagnostics for the query API (upstream
   *  `Dialogue.LogErrorMessage`); the same option the engine uses. */
  private readonly logError: (message: string) => void;

  constructor(program: Program, opts: DialogueOptions = {}) {
    this.program = program;
    this.logError = opts.logError ?? ((message) => console.error(message));
    this.engine = new VirtualMachine(program, opts);
  }

  /** The node currently executing, or `null` when the dialogue is not active. */
  get currentNode(): string | null {
    return this.engine.currentNode;
  }

  /** Whether the dialogue is running a node (not yet completed). */
  get isActive(): boolean {
    return this.engine.isActive;
  }

  /**
   * A delivered option set awaits selection (Rust
   * `is_waiting_for_option_selection`): `continue()` would log and return no
   * events until `selectOption` resolves it. `false` before the first
   * `continue()`.
   */
  get isWaitingForOptionSelection(): boolean {
    return this.engine.isWaitingForOptionSelection;
  }

  /**
   * A `DialogueComplete` event has been delivered (recorded project
   * extension — upstream completion is push-only, no `IsComplete`/`is_complete`
   * in .NET 3.x or the Rust runtime). Answers "did the story finish?", not
   * "is it done being used?": `stop()` makes the dialogue inactive without
   * completing it — its complete event rides queued until the next
   * `continue()` delivers it; `setNode` resets this for a fresh run.
   */
  get isComplete(): boolean {
    return this.engine.isComplete;
  }

  /** The registry of host functions and command handlers (including built-ins). */
  getLibrary(): Library {
    return this.engine.getLibrary();
  }

  /**
   * Run the program until the next stopping point and return the events
   * since the last stop: a delivered line, command, or option set — with
   * node lifecycle and (opt-in) line-hint events riding along — or the end
   * of the dialogue. Returns no events when the dialogue is not active,
   * except a queued `dialogueComplete` (a `stop()` delivers it on this
   * call — see `isComplete`).
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

  // ── Saliency ──────────────────────────────────────────────────────────

  /** The active content saliency strategy (upstream `Dialogue.ContentSaliencyStrategy`). */
  get contentSaliencyStrategy(): ContentSaliencyStrategy {
    return this.engine.contentSaliencyStrategy;
  }

  set contentSaliencyStrategy(strategy: ContentSaliencyStrategy) {
    this.engine.contentSaliencyStrategy = strategy;
  }

  /**
   * Switch to a named built-in strategy (`first`, `random`, `best`,
   * `best_least_recent`, `random_best_least_recent` — the `<<set_saliency>>`
   * modes — plus the conformance-harness spellings
   * `best_least_recently_seen`/`random_best_least_recently_seen`). Returns
   * `false` for an unknown mode, leaving the active strategy unchanged.
   */
  setSaliencyStrategy(mode: string): boolean {
    return this.engine.setSaliencyStrategy(mode);
  }

  /** Upstream `Dialogue.IsNodeGroup`: whether the name is a node group. */
  isNodeGroup(nodeName: string): boolean {
    return this.engine.isNodeGroup(nodeName);
  }

  /**
   * Upstream `Dialogue.GetSaliencyOptionsForNodeGroup`: the saliency
   * options the node group (or plain node) could run, evaluated against
   * the current variable state. Read-only.
   */
  getSaliencyOptionsForNodeGroup(nodeGroup: string): ContentSaliencyOption[] {
    return this.engine.getSaliencyOptionsForNodeGroup(nodeGroup);
  }

  /** Upstream `Dialogue.HasSalientContent`. */
  hasSalientContent(nodeGroup: string): boolean {
    return this.engine.hasSalientContent(nodeGroup);
  }

  // ── Program queries ─────────────────────────────────────────────────────

  // Citation: Yarn Spinner Pty. Ltd., Secret Lab Pty. Ltd., and contributors —
  // YarnSpinner (v3.2.2 @ 5b3a4ff2d) [MIT]
  // Source: https://github.com/YarnSpinnerTool/YarnSpinner/blob/main/YarnSpinner/Dialogue.cs
  // Accessed: 2026-12-20
  // The three queries adapt upstream `Dialogue.NodeNames` (line 939),
  // `Dialogue.GetStringIDForNode` (lines 1014–1060), and
  // `Dialogue.NodeExists` (lines 1113–1129), including their diagnostic
  // messages verbatim. Divergence (recorded): upstream's `UnloadAll`/
  // `SetProgram` lifecycle has no counterpart — this `Dialogue` receives its
  // program at construction (ADR 0002), so the "no program loaded" path
  // cannot arise and only the empty-node-table rules apply.

  /**
   * Upstream `Dialogue.NodeExists`: whether a node with this name exists in
   * the program. True for plain nodes, node groups (the hub node), and
   * individually-addressable node-group members alike.
   */
  nodeExists(nodeName: string): boolean {
    // Upstream logs "Tried to call NodeExists, but no program has been
    // loaded!" when no program is set — unreachable here (the program is
    // constructor-injected). An empty node table means no node exists.
    return this.program.nodes[nodeName] !== undefined;
  }

  /**
   * Upstream `Dialogue.NodeNames`: the names of the nodes in the program —
   * the node table's insertion order (hub title first, then its members'
   * unique names). Empty when the program has no nodes.
   */
  nodeNames(): string[] {
    return Object.keys(this.program.nodes);
  }

  /**
   * Upstream `Dialogue.GetStringIDForNode`: the string ID that would contain
   * a node's original, uncompiled source text (`line:` + node name). Like
   * upstream, this does not consult the string table — a node's source text
   * is only present when its `tags:` header contains `rawText` — so the ID
   * is returned for any existing node, and a diagnostic is logged with a
   * `null` return when it is not.
   */
  getStringIDForNode(nodeName: string): string | null {
    if (Object.keys(this.program.nodes).length === 0) {
      this.logError("No nodes are loaded!");
      return null;
    } else if (this.program.nodes[nodeName] !== undefined) {
      return "line:" + nodeName;
    } else {
      this.logError("No node named " + nodeName);
      return null;
    }
  }

  // ── Markup / locale ──────────────────────────────────────────────────────

  /**
   * The locale replacement markers (`[select]`, `[plural]`, `[ordinal]`)
   * compose under (upstream `Dialogue.LocaleCode`; BCP-47).
   */
  getLocale(): string {
    return this.engine.getLocale();
  }

  /**
   * Override the locale replacement markers resolve under (upstream
   * `Dialogue.LocaleCode`).
   */
  setLocale(localeCode: string): void {
    this.engine.setLocale(localeCode);
  }

  /**
   * The runtime's line parser: register or deregister custom marker
   * processors (upstream `Dialogue.LineParser`) for markers other than the
   * built-in `[select]`/`[plural]`/`[ordinal]`.
   */
  getLineParser(): LineParser {
    return this.engine.getLineParser();
  }

  // ── Localisation ────────────────────────────────────────────────────────

  /**
   * Switch the active language (BCP-47; `null` selects the base language —
   * the program's own text). Forwards to the injected text provider
   * (Rust `TextProvider.set_language`): the next delivered lines and
   * options resolve their text through the provider, substitutions and
   * markup still composing at delivery. Reports a diagnostic when no text
   * provider was provided.
   */
  setLanguage(language: string | null): void {
    this.engine.setLanguage(language);
  }
}

/**
 * Deprecated 0.1.x name of {@link Dialogue}, kept as an exact alias for one
 * release (removed in the release after 0.2.0). The glossary
 * concept is upstream's `Dialogue` — "runner" is a retired term.
 *
 * @deprecated Renamed to `Dialogue` in 0.2.0.
 */
export const YarnRunner: typeof Dialogue = Dialogue;
/** @deprecated Renamed to `Dialogue` in 0.2.0. */
// eslint-disable-next-line no-redeclare -- deliberate TS value+type merge: the deprecated alias keeps both the class value and its instance type
export type YarnRunner = Dialogue;
/** @deprecated Renamed to `DialogueOptions` in 0.2.0. */
export type YarnRunnerOptions = DialogueOptions;
