import { useCallback, useEffect, useReducer, useRef } from "react";
import { Dialogue, Library } from "../runtime/dialogue.js";
import type { YarnFunction } from "../runtime/dialogue.js";
import { EMPTY_TRANSCRIPT, runUntilStopped } from "../runtime/transcript.js";
import type { StoppingPoint, Transcript } from "../runtime/transcript.js";
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
 * The stopping-point contract — line stops; options stop and await
 * selection; commands surface-then-skip; lifecycle events ride through;
 * completion terminates — lives in one place: the transcript-reduction
 * module (`runUntilStopped`, CONTEXT.md "Transcript"). This hook is a thin
 * reshaper over it: each pull's transcript is reshaped into the single
 * user-facing view state:
 * - a `line` stop becomes the text view (the view waits for a click).
 * - an `options` stop becomes the options view (awaits `selectOption`).
 * - a `command` stop becomes the command view (flashed briefly; the view's
 *   auto-continue effect calls `continue` to skip past it).
 * - a `complete` stop clears the view and fires `onDialogueComplete` (after
 *   commit).
 * The current node's `scene:` header is attached to every view state (the
 * old per-result `scene` field, adapter-side now).
 *
 * The dialogue is created and first pulled synchronously during render (the
 * React "adjust state when props change" pattern) so server-side rendering
 * shows the opening line; `continue`/`selectOption` re-pull from event
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

/**
 * Reshape one pull's transcript into the view state (the thin adapter over
 * the transcript-reduction module). The transcript holds exactly the
 * stopping point's events: its tail line / live option set / last command.
 */
function reshapeView(
  transcript: Transcript,
  stopped: StoppingPoint,
  scene?: string,
): DialogueViewResult | null {
  switch (stopped) {
    case "line": {
      const line = transcript.lines[transcript.lines.length - 1];
      if (!line) return null;
      return {
        type: "text",
        text: line.text,
        speaker: line.speaker,
        tags: line.tags,
        markup: line.markup,
        scene,
      };
    }
    case "options": {
      if (!transcript.options) return null;
      return {
        type: "options",
        options: transcript.options.map((o) => ({
          index: o.index,
          text: o.text,
          tags: o.tags,
          markup: o.markup,
          isAvailable: o.isAvailable,
        })),
        scene,
      };
    }
    case "command": {
      const command = transcript.commands[transcript.commands.length - 1];
      if (command === undefined) return null;
      // Surfaced briefly; the view's auto-continue effect calls continue().
      return { type: "command", command, scene };
    }
    case "complete":
      return null;
  }
}

export function useDialogue(
  program: Program,
  options: UseDialogueOptions,
): UseDialogueResult {
  const dialogueRef = useRef<Dialogue | null>(null);
  const dialogueCompleteFiredRef = useRef(false);
  const dialogueCompletePendingRef = useRef(false);
  const viewRef = useRef<DialogueViewResult | null>(null);
  const programRef = useRef(program);
  const optionsRef = useRef(options);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  /** Pull to the next stopping point and reshape the transcript into the
   *  view state; flags the completion callback for post-commit delivery. */
  const applyPull = useCallback((): void => {
    const dialogue = dialogueRef.current;
    if (!dialogue) return;
    const { transcript, stopped } = runUntilStopped(dialogue, EMPTY_TRANSCRIPT);
    viewRef.current = reshapeView(transcript, stopped, dialogue.currentScene);
    if (stopped === "complete" && !dialogueCompleteFiredRef.current) {
      dialogueCompleteFiredRef.current = true;
      dialogueCompletePendingRef.current = true; // fired after commit (see effect below)
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
    dialogueCompleteFiredRef.current = false;
    dialogueCompletePendingRef.current = false;
    programRef.current = program;
    optionsRef.current = options;
    applyPull();
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
    // UI-level idempotence: a click while a selection is pending is a no-op
    // (the module guards the same state; the view just stays as it is).
    if (dialogueRef.current?.isWaitingForOptionSelection) return;
    applyPull();
    bump();
  }, [applyPull]);

  const selectOption = useCallback(
    (index: number) => {
      const dialogue = dialogueRef.current;
      if (!dialogue || !dialogue.isWaitingForOptionSelection) return;
      dialogue.selectOption(index);
      applyPull();
      bump();
    },
    [applyPull],
  );

  return {
    result: viewRef.current,
    continue: continueDialogue,
    advance: continueDialogue,
    selectOption,
    dialogue: dialogueRef.current as Dialogue,
  };
}
