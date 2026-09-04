// SPDX-License-Identifier: CC0-1.0
import { useCallback, useEffect, useReducer, useRef } from "react";
import { Dialogue, Library } from "../runtime/dialogue.js";
import type { YarnFunction, DialogueOptions } from "../runtime/dialogue.js";
import { mergeEvents, pullUntilStopped } from "../runtime/transcript.js";
import type { StoppingPoint, Transcript } from "../runtime/transcript.js";
import type { MarkupParseResult } from "../markup/types.js";
import type { DialogueOption } from "../runtime/events.js";
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
 * React adapter over the pull-based event-stream runtime.
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
 * The scene name travels on its one channel — the `NodeStartEvent` — and
 * the hook derives `sceneName` from the transcript; the old per-view-result
 * `scene` field is gone.
 *
 * The dialogue is created and first pulled synchronously during render (the
 * React "adjust state when props change" pattern) so server-side rendering
 * shows the opening line; `continue`/`selectOption` re-pull from event
 * handlers and bump a counter to re-render.
 *
 * The hook takes `(program, config, live)`: construction-only inputs go in
 * `config` — one rule, config identity = dialogue identity — and per-call
 * callbacks and logging go in `live`, read through a ref so the latest
 * object is always in effect (identity ignored; a fresh literal every
 * render is the intended shape).
 */

/**
 * The view's option is the runtime's option, derived — not re-declared —
 * so a field added to `DialogueOption` flows to the view instead of
 * silently dropping between runtime and view (the derivation treatment
 * `TranscriptLine` already has). Adapter-side alias; not upstream.
 */
export type DialogueViewOption = DialogueOption;

export type DialogueViewResult =
  | {
      type: "text";
      text: string;
      speaker?: string;
      tags?: string[];
      markup?: MarkupParseResult;
    }
  | { type: "options"; options: DialogueViewOption[] }
  | { type: "command"; command: string };

/** The `onDialogueComplete` payload: the story variables at completion
 *  (upstream `DialogueComplete`). */
export interface DialogueCompleteInfo {
  variables: Readonly<Record<string, unknown>>;
  dialogueComplete: true;
}

/** @deprecated Renamed to `DialogueCompleteInfo`; removed in the
 *  release after the one that ships this alias. */
export interface StoryEndInfo {
  variables: Readonly<Record<string, unknown>>;
  storyEnd: true;
}

/**
 * Construction-only inputs to `useDialogue` (the `config` parameter).
 * Reference-compared as a whole — one rule: **config identity = dialogue
 * identity**. A new config object means a new dialogue, even if every value
 * inside is identical; per-call inputs (callbacks, logging) belong in
 * `UseDialogueLive`.
 *
 * Derived from the runtime's `DialogueOptions`:
 * a runtime option declared there flows into the hook without a second
 * declaration. `library` is re-modeled as `functions` (the hook builds the
 * `Library`); the diagnostics live in `UseDialogueLive`, never frozen at
 * construction.
 */
export interface UseDialogueOptions
  extends Omit<DialogueOptions, "library" | "logError" | "logDebug"> {
  /** Host functions and command handlers, imported over the built-ins —
   *  the hook's re-model of `DialogueOptions.library`. */
  functions?: Record<string, YarnFunction>;
}

/**
 * Per-call inputs to `useDialogue` (the `live` parameter): callbacks and
 * logging. Read through a ref — identity is ignored and the latest object is
 * always in effect, so passing a fresh literal every render is fine and
 * swapping callbacks after construction works.
 */
export interface UseDialogueLive {
  /** Runtime error diagnostics. Defaults to `console.error`. */
  logError?: (message: string) => void;
  /** Runtime debug diagnostics. Defaults to silent. */
  logDebug?: (message: string) => void;
  /** Fired after commit when the dialogue completes (the `DialogueComplete`
   *  event, glossary). Takes precedence over the deprecated `onStoryEnd`. */
  onDialogueComplete?: (info: DialogueCompleteInfo) => void;
  /** @deprecated Renamed to `onDialogueComplete`; removed in the
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
  /** @deprecated Renamed to `continue` — the same function;
   *  removed in the release after the one that ships this alias. */
  advance: () => void;
  /** Select a delivered option by its index (upstream `Dialogue.SetSelectedOption`). */
  selectOption: (index: number) => void;
  /** The `scene:` header of the most recently started node, derived from the
   *  transcript's `NodeStartEvent` and carried forward across scene-less
   *  nodes. Cross-check it against your `SceneCollection` here — the one
   *  seam where the name and the image collection meet. */
  sceneName?: string;
  /** The underlying `Dialogue`, for escape hatches (variable reads, etc.). */
  dialogue: Dialogue;
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
 * The scene name is not part of the view state — it travels on the
 * `NodeStartEvent` and the hook surfaces it separately (`sceneName`).
 */
function reshapeView(
  transcript: Transcript,
  stopped: StoppingPoint,
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
      };
    }
    case "options": {
      if (!transcript.options) return null;
      // The option set passes through: DialogueViewOption is derived from
      // DialogueOption, so no field copy stands between runtime and view.
      return { type: "options", options: transcript.options };
    }
    case "command": {
      const command = transcript.commands[transcript.commands.length - 1];
      if (command === undefined) return null;
      // Surfaced briefly; the view's auto-continue effect calls continue().
      return { type: "command", command };
    }
    case "complete":
      return null;
  }
}

export function useDialogue(
  program: Program,
  config: UseDialogueOptions,
  live: UseDialogueLive = {},
): UseDialogueResult {
  const dialogueRef = useRef<Dialogue | null>(null);
  const dialogueCompleteFiredRef = useRef(false);
  const dialogueCompletePendingRef = useRef(false);
  const viewRef = useRef<DialogueViewResult | null>(null);
  const sceneNameRef = useRef<string | undefined>(undefined);
  const programRef = useRef(program);
  const configRef = useRef(config);
  const liveRef = useRef(live);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // `live` is per-call: identity is ignored, the latest object is always in
  // effect. Synced after every commit, and declared ahead of the completion
  // effect below so a same-commit completion reads fresh callbacks.
  useEffect(() => {
    liveRef.current = live;
  });

  /** Pull to the next stopping point and reshape the run's tail into the
   *  view state; flags the completion callback for post-commit delivery.
   *  The scene name rides on the transcript's `NodeStartEvent`; the hook
   *  carries it forward across pulls (the hook reduces the tail events of
   *  each pull only — no accumulation).
   *
   *  The pull is the transcript module's stateless member: the at-rest
   *  states are *data* on the result — an empty `events` with its stopping
   *  point means the dialogue was pending a selection or already complete,
   *  so there is nothing new to reshape and the view stays exactly as it
   *  is. The hook reads the module's contract instead of pre-empting it
   *  (deepening-wave-3 ticket 04; the old shape hand-copied the
   *  pending-selection guard before the pull). */
  const applyPull = useCallback((): void => {
    const dialogue = dialogueRef.current;
    if (!dialogue) return;
    const { events, stopped } = pullUntilStopped(dialogue);
    if (events.length === 0) return;
    const transcript = mergeEvents(events);
    if (transcript.scene !== undefined) sceneNameRef.current = transcript.scene;
    viewRef.current = reshapeView(transcript, stopped);
    if (stopped === "complete" && !dialogueCompleteFiredRef.current) {
      dialogueCompleteFiredRef.current = true;
      dialogueCompletePendingRef.current = true; // fired after commit (see effect below)
    }
  }, []);

  // Adjust during render: create the dialogue when the program or the config
  // identity changed, then synchronously pull the first view state (keeps SSR
  // markup correct). One comparison rule — config identity = dialogue
  // identity; a fresh object with identical values still rebuilds.
  //
  // The config spreads into the runtime's DialogueOptions: new
  // runtime options forward without per-field code here. `variables` seeds
  // in the VM constructor after <<declare>> defaults (with `$`-prefix
  // normalization); diagnostics route to the live object's current logging
  // via trampolines, never frozen at construction.
  if (
    !dialogueRef.current ||
    programRef.current !== program ||
    configRef.current !== config
  ) {
    const dialogue = new Dialogue(program, {
      ...config,
      library: buildLibrary(config.functions),
      logError: (message) => {
        const onError = liveRef.current.logError;
        if (onError) onError(message);
        else console.error(message);
      },
      logDebug: (message) => {
        liveRef.current.logDebug?.(message);
      },
    });
    dialogueRef.current = dialogue;
    dialogueCompleteFiredRef.current = false;
    dialogueCompletePendingRef.current = false;
    sceneNameRef.current = undefined;
    programRef.current = program;
    configRef.current = config;
    applyPull();
  }

  // Fire onDialogueComplete after commit, not during render. The deprecated
  // onStoryEnd keeps its original payload shape (exact alias: each name
  // delivers what its type documents; the new name wins when both are given).
  useEffect(() => {
    if (!dialogueCompletePendingRef.current) return;
    dialogueCompletePendingRef.current = false;
    const variables = Object.freeze({ ...dialogueRef.current?.getVariables() });
    if (liveRef.current.onDialogueComplete) {
      liveRef.current.onDialogueComplete({ dialogueComplete: true, variables });
    } else {
      liveRef.current.onStoryEnd?.({ storyEnd: true, variables });
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
    sceneName: sceneNameRef.current,
    dialogue: dialogueRef.current as Dialogue,
  };
}
