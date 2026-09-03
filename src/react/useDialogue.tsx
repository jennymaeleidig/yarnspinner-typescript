import { useCallback, useEffect, useReducer, useRef } from "react";
import { Dialogue, Library } from "../runtime/dialogue.js";
import type { DialogueEvent, YarnFunction } from "../runtime/dialogue.js";
import type { TextProvider } from "../runtime/textProvider.js";
import type { VariableStorage } from "../runtime/variableStorage.js";
import type { MarkupParseResult } from "../markup/types.js";
import type { Program } from "../compile/program.js";

/**
 * Deprecated 0.1.x names, kept as exact aliases for one release (removed in
 * the release after 0.2.0). New code uses `useDialogue` and the
 * `UseDialogue*` types.
 */

/** @deprecated Renamed to `useDialogue` in 0.2.0. */
export const useYarnRunner: typeof useDialogue = useDialogue;
/** @deprecated Renamed to `UseDialogueOptions` in 0.2.0. */
export type UseYarnRunnerOptions = UseDialogueOptions;
/** @deprecated Renamed to `UseDialogueResult` in 0.2.0. */
export type UseYarnRunnerResult = UseDialogueResult;

/**
 * React adapter over the pull-based event-stream runtime (ticket 43).
 *
 * The `Dialogue` delivers batches of events; this hook reduces them into a
 * single user-facing view state:
 * - `line` events stop the reduction (the view waits for a click to continue).
 * - `options` events stop the reduction (the view waits for `selectOption`).
 * - `command` events stop the reduction too, so the view can flash them
 *   briefly; the next `continue()` resumes from the buffered batch.
 * - `dialogueComplete` clears the view and fires `onDialogueComplete` (after
 *   commit).
 * - `nodeStart`/`nodeComplete`/`lineHints` are lifecycle events and flow
 *   through silently; the current node's `scene:` header is attached to
 *   every view state (the old per-result `scene` field, adapter-side now).
 *
 * The dialogue is created and first reduced synchronously during render (the
 * React "adjust state when props change" pattern) so server-side rendering
 * shows the opening line; `continue`/`selectOption` re-reduce from event
 * handlers and bump a counter to re-render.
 */

export interface DialogueViewOption {
  index: number;
  text: string;
  tags?: string[];
  markup?: MarkupParseResult;
  isAvailable: boolean;
}

export type DialogueViewResult =
  | {
      type: "text";
      text: string;
      speaker?: string;
      tags?: string[];
      markup?: MarkupParseResult;
      scene?: string;
      isDialogueEnd: boolean;
    }
  | { type: "options"; options: DialogueViewOption[]; scene?: string }
  | { type: "command"; command: string; scene?: string };

/** The `onDialogueComplete` payload: the story variables at completion
 *  (upstream `DialogueComplete`). */
export interface DialogueCompleteInfo {
  variables: Readonly<Record<string, unknown>>;
  dialogueComplete: true;
}

/** @deprecated Renamed to `DialogueCompleteInfo` (ticket 55); removed in the
 *  release after the one that ships this alias. */
export interface StoryEndInfo {
  variables: Readonly<Record<string, unknown>>;
  storyEnd: true;
}

export interface UseDialogueOptions {
  startAt?: string;
  functions?: Record<string, YarnFunction>;
  /** Initial host variable values, seeded into storage before the first event. */
  variables?: Record<string, unknown>;
  /**
   * Host-provided variable storage (glossary "variable storage", spec
   * story 39): the persistence seam. Injecting a pre-populated storage
   * restores state — declare-default seeding skips the names it already
   * holds. Changing its identity rebuilds the dialogue (reference compare:
   * a storage is stateful, so only a new storage means a new dialogue).
   */
  variableStorage?: VariableStorage;
  /**
   * Host-provided text provider (ticket 51): resolves line IDs to text for
   * the current language; lines it lacks fall back to the program's own
   * text. Changing its identity rebuilds the dialogue (reference compare).
   * Language switching needs no rebuild — call `setLanguage` on the result's
   * `dialogue` (the ticket-51 surface; the hook adds no language API).
   */
  textProvider?: TextProvider;
  /**
   * Opt-in `LineHints` events (upstream `PrepareForLines`). The hook
   * consumes them silently — they never surface in the view — so hosts
   * observe hints through the provider's `acceptLineHints` or the `dialogue`
   * escape hatch. Changing the flag rebuilds the dialogue (value compare,
   * like `startAt`).
   */
  lineHints?: boolean;
  /** Runtime error diagnostics. Defaults to `console.error`. Construction-time:
   *  changing it after the dialogue exists is ignored — pass a stable callback. */
  logError?: (message: string) => void;
  /** Runtime debug diagnostics. Defaults to silent. Construction-time: changing
   *  it after the dialogue exists is ignored — pass a stable callback. */
  logDebug?: (message: string) => void;
  /** Fired after commit when the dialogue completes (the `DialogueComplete`
   *  event, glossary). Takes precedence over the deprecated `onStoryEnd`. */
  onDialogueComplete?: (info: DialogueCompleteInfo) => void;
  /** @deprecated Renamed to `onDialogueComplete` (ticket 55); removed in the
   *  release after the one that ships this alias. Used only when
   *  `onDialogueComplete` is absent, with this option's original payload. */
  onStoryEnd?: (info: StoryEndInfo) => void;
}

export interface UseDialogueResult {
  result: DialogueViewResult | null;
  /** Continue past the current line or command (no-op while awaiting a
   *  selection) — glossary "Continue", the adapter-side counterpart of
   *  `Dialogue.continue()`. */
  continue: () => void;
  /** @deprecated Renamed to `continue` (ticket 55) — the same function;
   *  removed in the release after the one that ships this alias. */
  advance: () => void;
  /** Select a delivered option by its index (upstream `Dialogue.SetSelectedOption`). */
  selectOption: (index: number) => void;
  /** The underlying `Dialogue`, for escape hatches (variable reads, etc.). */
  dialogue: Dialogue;
}

function haveFunctionsChanged(
  prev: UseDialogueOptions["functions"],
  next: UseDialogueOptions["functions"],
): boolean {
  const prevFns = prev ?? {};
  const nextFns = next ?? {};
  const prevKeys = Object.keys(prevFns);
  const nextKeys = Object.keys(nextFns);
  if (prevKeys.length !== nextKeys.length) return true;
  for (const key of prevKeys) {
    if (!Object.prototype.hasOwnProperty.call(nextFns, key) || prevFns[key] !== nextFns[key]) {
      return true;
    }
  }
  return false;
}

function haveVariablesChanged(
  prev: UseDialogueOptions["variables"],
  next: UseDialogueOptions["variables"],
): boolean {
  return JSON.stringify(prev ?? {}) !== JSON.stringify(next ?? {});
}

function buildLibrary(functions?: Record<string, YarnFunction>): Library {
  const library = new Library();
  for (const [name, fn] of Object.entries(functions ?? {})) {
    library.registerFunction(name, fn);
  }
  return library;
}

export function useDialogue(
  program: Program,
  options: UseDialogueOptions,
): UseDialogueResult {
  const dialogueRef = useRef<Dialogue | null>(null);
  const queueRef = useRef<DialogueEvent[]>([]);
  const dialogueCompleteFiredRef = useRef(false);
  const dialogueCompletePendingRef = useRef(false);
  const viewRef = useRef<DialogueViewResult | null>(null);
  const programRef = useRef(program);
  const optionsRef = useRef(options);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  /**
   * Reduce buffered/pulled events until the next user-facing stopping point
   * and return the resulting view state.
   */
  const reduceView = useCallback((): DialogueViewResult | null => {
    const dialogue = dialogueRef.current;
    if (!dialogue) return null;
    for (;;) {
      if (queueRef.current.length === 0) {
        // At rest the queue is always empty (the runtime stops each batch at
        // exactly one stopping point; lifecycle events ride along), so the
        // dialogue's own state answers "is the surfaced view an awaiting
        // option set".
        if (dialogue.isWaitingForOptionSelection) return viewRef.current; // needs a selection first
        const batch = dialogue.continue();
        if (batch.length === 0) {
          return null; // stalled or ended without a complete event
        }
        queueRef.current = batch;
      }
      const event = queueRef.current.shift()!;
      switch (event.type) {
        case "line":
          return {
            type: "text",
            text: event.text,
            speaker: event.speaker,
            tags: event.tags,
            markup: event.markup,
            scene: dialogue.currentScene,
            isDialogueEnd: false,
          };
        case "options":
          return {
            type: "options",
            options: event.options.map((o) => ({
              index: o.index,
              text: o.text,
              tags: o.tags,
              markup: o.markup,
              isAvailable: o.isAvailable,
            })),
            scene: dialogue.currentScene,
          };
        case "command":
          // Surfaced briefly; the view's auto-continue effect calls continue().
          return { type: "command", command: event.command, scene: dialogue.currentScene };
        case "dialogueComplete":
          if (!dialogueCompleteFiredRef.current) {
            dialogueCompleteFiredRef.current = true;
            dialogueCompletePendingRef.current = true; // fired after commit (see effect below)
          }
          return null;
        case "nodeStart":
        case "nodeComplete":
        case "lineHints":
          continue; // lifecycle events flow through silently
      }
    }
  }, []);

  // Adjust during render: (re)create the dialogue when inputs changed, then
  // synchronously pull the first view state (keeps SSR markup correct).
  if (
    !dialogueRef.current ||
    programRef.current !== program ||
    haveFunctionsChanged(optionsRef.current?.functions, options.functions) ||
    optionsRef.current?.startAt !== options.startAt ||
    haveVariablesChanged(optionsRef.current?.variables, options.variables) ||
    optionsRef.current?.variableStorage !== options.variableStorage ||
    optionsRef.current?.textProvider !== options.textProvider ||
    !!optionsRef.current?.lineHints !== !!options.lineHints
  ) {
    const dialogue = new Dialogue(program, {
      startAt: options.startAt ?? "Start",
      library: buildLibrary(options.functions),
      variableStorage: options.variableStorage,
      textProvider: options.textProvider,
      lineHints: options.lineHints,
      logError: options.logError,
      logDebug: options.logDebug,
    });
    for (const [name, value] of Object.entries(options.variables ?? {})) {
      dialogue.setVariable(name, value);
    }
    dialogueRef.current = dialogue;
    queueRef.current = [];
    dialogueCompleteFiredRef.current = false;
    dialogueCompletePendingRef.current = false;
    programRef.current = program;
    optionsRef.current = options;
    viewRef.current = reduceView();
  }

  // Fire onDialogueComplete after commit, not during render. The deprecated
  // onStoryEnd keeps its original payload shape (exact alias: each name
  // delivers what its type documents; the new name wins when both are given).
  useEffect(() => {
    if (!dialogueCompletePendingRef.current) return;
    dialogueCompletePendingRef.current = false;
    const variables = Object.freeze({ ...dialogueRef.current?.getVariables() });
    if (optionsRef.current.onDialogueComplete) {
      optionsRef.current.onDialogueComplete({ dialogueComplete: true, variables });
    } else {
      optionsRef.current.onStoryEnd?.({ storyEnd: true, variables });
    }
  });

  // `continue` is a reserved word, so the binding carries the glossary term
  // with a suffix; the property name is exactly `continue`.
  const continueDialogue = useCallback(() => {
    if (dialogueRef.current?.isWaitingForOptionSelection) return;
    viewRef.current = reduceView();
    bump();
  }, [reduceView]);

  const selectOption = useCallback(
    (index: number) => {
      const dialogue = dialogueRef.current;
      if (!dialogue || !dialogue.isWaitingForOptionSelection) return;
      dialogue.selectOption(index);
      viewRef.current = reduceView();
      bump();
    },
    [reduceView],
  );

  return {
    result: viewRef.current,
    continue: continueDialogue,
    advance: continueDialogue,
    selectOption,
    dialogue: dialogueRef.current as Dialogue,
  };
}
