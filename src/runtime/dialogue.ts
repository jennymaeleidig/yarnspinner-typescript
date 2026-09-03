/**
 * The runtime (`Dialogue`): pull-based execution of a compiled program
 * (ADR 0002, ticket 43).
 *
 * The compiled program is the instruction-stream artifact (ADR 0001/0003);
 * the tree-IR driver is retired (ticket 46) and `Dialogue` executes it
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
import type { TextProvider } from "./textProvider.js";
import {
  noOptionSelected,
  type DialogueEvent,
  type DialogueOptions,
  type RuntimeDriver,
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
export type { YarnFunction, CommandHandler } from "./library.js";

/**
 * The runtime object that executes a program and yields dialogue events
 * (CONTEXT.md "Dialogue"): the instruction-stream VM behind the public
 * surface.
 */
export class Dialogue {
  private readonly engine: RuntimeDriver;
  /** The host's text provider (ticket 51), when one was injected. */
  private readonly textProvider: TextProvider | null;
  private readonly logError: (message: string) => void;

  constructor(program: Program, opts: DialogueOptions = {}) {
    this.engine = new VirtualMachine(program, opts);
    this.textProvider = opts.textProvider ?? null;
    this.logError = opts.logError ?? ((message) => console.error(message));
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

  // ── Saliency (ticket 47) ───────────────────────────────────────────

  /** The active content saliency strategy (upstream `Dialogue.ContentSaliencyStrategy`). */
  get contentSaliencyStrategy(): ContentSaliencyStrategy {
    return this.engine.contentSaliencyStrategy;
  }

  set contentSaliencyStrategy(strategy: ContentSaliencyStrategy) {
    this.engine.contentSaliencyStrategy = strategy;
  }

  /**
   * Switch to a named built-in strategy (the `<<set_saliency>>` mode
   * vocabulary: `first`, `best`, `best_least_recently_seen`,
   * `random_best_least_recently_seen`). Returns `false` for an unknown
   * mode, leaving the active strategy unchanged.
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

  // ── Markup / locale (ticket 48) ─────────────────────────────────────

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

  // ── Localisation (ticket 51) ────────────────────────────────────────

  /**
   * Switch the active language (BCP-47; `null` selects the base language —
   * the program's own text). Forwards to the injected text provider
   * (Rust `TextProvider.set_language`): the next delivered lines and
   * options resolve their text through the provider, substitutions and
   * markup still composing at delivery. Reports a diagnostic when no text
   * provider was provided.
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
}

/**
 * Deprecated 0.1.x name of {@link Dialogue}, kept as an exact alias for one
 * release (removed in the release after 0.2.0). Ticket 17: the glossary
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
