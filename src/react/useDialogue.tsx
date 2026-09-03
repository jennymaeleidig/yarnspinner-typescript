import { useCallback, useEffect, useReducer, useRef } from "react";
import { Dialogue, Library } from "../runtime/dialogue.js";
import type { DialogueEvent, YarnFunction } from "../runtime/dialogue.js";
import type { MarkupParseResult } from "../markup/types.js";
import type { Program } from "../compile/program.js";

/**
 * Deprecated 0.1.x names, kept as exact aliases for one release (removed in
 * the release after 0.2.0). New code uses `useDialogue` and the
 * `UseDialogue*` types.
 */

/** @deprecated Renamed to `useDialogue` in 0.2.0. */
export const useYarnRunner: typeof useDialogue = useDialogue;
export type UseYarnRunnerOptions = UseDialogueOptions;
export type UseYarnRunnerResult = UseDialogueResult;

/**
 * React adapter over the pull-based event-stream runtime (ticket 43).
 *
 * The `Dialogue` delivers batches of events; this hook reduces them into a
 * single user-facing view state:
 * - `line` events stop the reduction (the view waits for a click to advance).
 * - `options` events stop the reduction (the view waits for `selectOption`).
 * - `command` events stop the reduction too, so the view can flash them
 *   briefly; the next `advance()` resumes from the buffered batch.
 * - `dialogueComplete` clears the view and fires `onStoryEnd` (after commit).
 * - `nodeStart`/`nodeComplete`/`lineHints` are lifecycle events and flow
 *   through silently; the current node's `scene:` header is attached to
 *   every view state (the old per-result `scene` field, adapter-side now).
 *
 * The dialogue is created and first reduced synchronously during render (the
 * React "adjust state when props change" pattern) so server-side rendering
 * shows the opening line; `advance`/`selectOption` re-reduce from event
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

export interface UseDialogueOptions {
  startAt?: string;
  functions?: Record<string, YarnFunction>;
  /** Initial host variable values, seeded into storage before the first event. */
  variables?: Record<string, unknown>;
  onStoryEnd?: (info: { variables: Readonly<Record<string, unknown>>; storyEnd: true }) => void;
}

export interface UseDialogueResult {
  result: DialogueViewResult | null;
  /** Advance past the current line or command (no-op while awaiting a selection). */
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
  const awaitingSelectionRef = useRef(false);
  const storyEndFiredRef = useRef(false);
  const storyEndPendingRef = useRef(false);
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
        if (awaitingSelectionRef.current) return viewRef.current; // needs a selection first
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
          awaitingSelectionRef.current = true;
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
          // Surfaced briefly; the view's auto-advance effect calls advance().
          return { type: "command", command: event.command, scene: dialogue.currentScene };
        case "dialogueComplete":
          if (!storyEndFiredRef.current) {
            storyEndFiredRef.current = true;
            storyEndPendingRef.current = true; // fired after commit (see effect below)
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
    haveVariablesChanged(optionsRef.current?.variables, options.variables)
  ) {
    const dialogue = new Dialogue(program, {
      startAt: options.startAt ?? "Start",
      library: buildLibrary(options.functions),
    });
    for (const [name, value] of Object.entries(options.variables ?? {})) {
      dialogue.setVariable(name, value);
    }
    dialogueRef.current = dialogue;
    queueRef.current = [];
    awaitingSelectionRef.current = false;
    storyEndFiredRef.current = false;
    storyEndPendingRef.current = false;
    programRef.current = program;
    optionsRef.current = options;
    viewRef.current = reduceView();
  }

  // Fire onStoryEnd after commit, not during render.
  useEffect(() => {
    if (!storyEndPendingRef.current) return;
    storyEndPendingRef.current = false;
    optionsRef.current.onStoryEnd?.({
      storyEnd: true,
      variables: Object.freeze({ ...dialogueRef.current?.getVariables() }),
    });
  });

  const advance = useCallback(() => {
    if (awaitingSelectionRef.current) return;
    viewRef.current = reduceView();
    bump();
  }, [reduceView]);

  const selectOption = useCallback(
    (index: number) => {
      const dialogue = dialogueRef.current;
      if (!dialogue || !awaitingSelectionRef.current) return;
      awaitingSelectionRef.current = false;
      dialogue.selectOption(index);
      viewRef.current = reduceView();
      bump();
    },
    [reduceView],
  );

  return {
    result: viewRef.current,
    advance,
    selectOption,
    dialogue: dialogueRef.current as Dialogue,
  };
}
