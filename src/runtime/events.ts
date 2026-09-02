/**
 * The public runtime API shape (ADR 0002): the dialogue event vocabulary,
 * the pull-API constants, and the construction options — shared verbatim by
 * both execution drivers during the VM transition (tickets 45–46), so the
 * instruction-stream VM rides the same public runtime API as the
 * transitional tree-IR runtime.
 *
 * Event vocabulary (camelCased; each mirrors its upstream counterpart):
 * `Line`, `Options`, `Command`, `NodeStart`, `NodeComplete`, opt-in
 * `LineHints` (upstream `PrepareForLines`), `DialogueComplete`.
 */

import type { MarkupParseResult } from "../markup/types.js";
import type { Library } from "./library.js";

/**
 * The value indicating that no option was selected: the dialogue falls
 * through to the rest of the program (upstream `Dialogue.NoOptionSelected`).
 */
export const noOptionSelected = -1;

/** The default node a dialogue starts from (upstream `Dialogue.DefaultStartNodeName`). */
export const defaultStartNodeName = "Start";

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

/**
 * The execution-driver contract (internal): the tree-IR runtime and the
 * instruction-stream VM both implement this surface, and `Dialogue`
 * dispatches to one of them by program format. Not public API — the public
 * surface is `Dialogue`.
 */
export interface RuntimeDriver {
  readonly currentNode: string | null;
  readonly currentScene: string | undefined;
  readonly isActive: boolean;
  getLibrary(): Library;
  continue(): DialogueEvent[];
  selectOption(selectedOption: number | typeof noOptionSelected): void;
  setNode(title: string): void;
  stop(): void;
  getVariables(): Readonly<Record<string, unknown>>;
  getVariable(name: string): unknown;
  setVariable(name: string, value: unknown): void;
  tryGetSmartVariable(name: string): { ok: true; value: unknown } | { ok: false };
}

/** The line's ID from its `line:` hashtag, if present (shared by both drivers for `LineEvent.lineId`). */
export function lineIdFromTags(tags: string[] | undefined): string | undefined {
  const tag = tags?.find((t) => t.startsWith("line:"));
  return tag ? tag.slice("line:".length) : undefined;
}
