/**
 * The public runtime API shape (ADR 0002): the dialogue event vocabulary,
 * the pull-API constants, and the construction options — shared verbatim by
 * the one execution driver (the instruction-stream VM), so the events
 * ride the same public runtime API as before the tree IR retired.
 *
 * Event vocabulary (camelCased; each mirrors its upstream counterpart):
 * `Line`, `Options`, `Command`, `NodeStart`, `NodeComplete`, opt-in
 * `LineHints` (upstream `PrepareForLines`), `DialogueComplete`.
 */

import type { MarkupParseResult } from "../markup/types.js";
import type { LineParser } from "../markup/lineParser.js";
import type { Library } from "./library.js";
import type { VariableStorage } from "./variableStorage.js";
import type { TextProvider } from "./textProvider.js";
import type { ContentSaliencyOption, ContentSaliencyStrategy } from "./saliency.js";

/**
 * The value indicating that no option was selected: the dialogue falls
 * through to the rest of the program (upstream `Dialogue.NoOptionSelected`).
 */
export const noOptionSelected = -1;

/** The default node a dialogue starts from (upstream `Dialogue.DefaultStartNodeName`). */
export const defaultStartNodeName = "Start";

export interface LineEvent {
  type: "line";
  /**
   * The line's canonical ID — the `line:`-prefixed string-table key (the
   * same string as the CSV strings file's `id` column and the text
   * provider's key, upstream `Line.ID`).
   */
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
  /** The node's `scene:` header, when it declares one — the scene name's
   *  one delivery channel (deepening-wave ticket 07; adapter-side, the
   *  scene system is non-upstream). Absent when the node has no header. */
  scene?: string;
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
  /**
   * Host-provided variable storage (spec story 39, glossary "variable
   * storage"): the pluggable store for story variables and generated
   * variables alike. Defaults to an in-memory storage. Injecting a
   * pre-populated storage is the persistence seam — declare-default seeding
   * skips names the storage already holds, so restored values survive
   * construction; `variables` (above) still overrides after seeding.
   */
  variableStorage?: VariableStorage;
  /** Opt-in `LineHints` events (upstream `PrepareForLinesHandler`). */
  lineHints?: boolean;
  /**
   * Host-provided content saliency strategy (ticket 47, upstream
   * `Dialogue.ContentSaliencyStrategy`). Defaults to Random
   * Best-Least-Recently-Viewed over the variable storage.
   */
  contentSaliencyStrategy?: ContentSaliencyStrategy;
  /**
   * Host-provided text provider (ticket 51): the injectable resolver from
   * line ID to text for the current language. When absent — or when the
   * provider has no text for a line — the program's own text is the base
   * language. `Dialogue.setLanguage` switches the provider's language.
   */
  textProvider?: TextProvider;
  /** Runtime error diagnostics. Defaults to `console.error`. */
  logError?: (message: string) => void;
  /** Runtime debug diagnostics. Defaults to silent. */
  logDebug?: (message: string) => void;
}

/**
 * The execution-driver contract (internal): the instruction-stream VM
 * implements this surface behind `Dialogue`. Not public API — the public
 * surface is `Dialogue`.
 */
export interface RuntimeDriver {
  readonly currentNode: string | null;
  readonly isActive: boolean;
  /** A delivered option set awaits selection (Rust `is_waiting_for_option_selection`). */
  readonly isWaitingForOptionSelection: boolean;
  /** A `DialogueComplete` event has been delivered (recorded project extension). */
  readonly isComplete: boolean;
  getLibrary(): Library;
  continue(): DialogueEvent[];
  selectOption(selectedOption: number | typeof noOptionSelected): void;
  setNode(title: string): void;
  stop(): void;
  getVariables(): Readonly<Record<string, unknown>>;
  getVariable(name: string): unknown;
  setVariable(name: string, value: unknown): void;
  tryGetSmartVariable(name: string): { ok: true; value: unknown } | { ok: false };
  /** The active content saliency strategy (upstream `Dialogue.ContentSaliencyStrategy`). */
  get contentSaliencyStrategy(): ContentSaliencyStrategy;
  set contentSaliencyStrategy(strategy: ContentSaliencyStrategy);
  /** Switch to a named built-in strategy; `false` for an unknown mode. */
  setSaliencyStrategy(mode: string): boolean;
  /** Upstream `Dialogue.IsNodeGroup`. */
  isNodeGroup(nodeName: string): boolean;
  /** Upstream `Dialogue.GetSaliencyOptionsForNodeGroup`. */
  getSaliencyOptionsForNodeGroup(nodeGroup: string): ContentSaliencyOption[];
  /** Upstream `Dialogue.HasSalientContent`. */
  hasSalientContent(nodeGroup: string): boolean;
  /** The locale replacement markers compose under (upstream `Dialogue.LocaleCode`). */
  getLocale(): string;
  /** Override the locale replacement markers resolve under. */
  setLocale(localeCode: string): void;
  /** The line parser, for host marker-processor registration. */
  getLineParser(): LineParser;
}

/**
 * The line's canonical ID from its `line:` hashtag — the full tag text,
 * including the `line:` prefix (upstream `Line.ID`; the string-table key
 * and the CSV strings file's `id` value).
 */
export function lineIdFromTags(tags: string[] | undefined): string | undefined {
  return tags?.find((t) => t.startsWith("line:"));
}
