import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { DialogueScene } from "./DialogueScene.js";
import type { SceneCollection } from "../scene/types.js";
import { TypingText } from "./TypingText.js";
import { useDialogue } from "./useDialogue.js";
import type { DialogueViewResult, UseDialogueOptions, UseDialogueLive } from "./useDialogue.js";
import { MarkupRenderer } from "./MarkupRenderer.js";
// Note: CSS is imported in the browser demo entry point (examples/browser/main.tsx)
// This prevents Node.js from trying to resolve CSS imports during tests

import type { Program } from "../compile/program.js";

/** Why the continue scheduler is deferring a continue; each cause maps to
 *  its delay: a command flashes for `COMMAND_CONTINUE_DELAY_MS`, a finished
 *  typing animation waits for `continueDelay`, a click waits for
 *  `clickPause`. */
type ContinueCause = "command" | "typing-done" | "click";

/** How long a surfaced command stays on screen before the scheduler skips
 *  past it (not configurable — commands are never the point of the story). */
const COMMAND_CONTINUE_DELAY_MS = 50;

export interface DialogueViewProps extends UseDialogueOptions, UseDialogueLive {
  program: Program;
  className?: string;
  scenes?: SceneCollection;
  actorTransitionDuration?: number;
  // Typing animation options
  enableTypingAnimation?: boolean;
  typingSpeed?: number;
  showTypingCursor?: boolean;
  cursorCharacter?: string;
  // Auto-continue after typing completes
  autoContinueAfterTyping?: boolean;
  autoContinueDelay?: number; // Delay in ms after typing completes before auto-continuing
  // Pause before continuing
  pauseBeforeContinue?: number; // Delay in ms before continuing when clicking (0 = no pause)
  /** @deprecated Renamed to `autoContinueAfterTyping` (ticket 55); removed in
   *  the release after the one that ships this alias. */
  autoAdvanceAfterTyping?: boolean;
  /** @deprecated Renamed to `autoContinueDelay` (ticket 55); removed in the
   *  release after the one that ships this alias. */
  autoAdvanceDelay?: number;
  /** @deprecated Renamed to `pauseBeforeContinue` (ticket 55); removed in the
   *  release after the one that ships this alias. */
  pauseBeforeAdvance?: number;
}

export function DialogueView(props: DialogueViewProps) {
  const {
    program,
    startAt,
    className,
    scenes,
    actorTransitionDuration = 350,
    functions,
    variables,
    variableStorage,
    contentSaliencyStrategy,
    textProvider,
    lineHints,
    enableTypingAnimation = false,
    typingSpeed = 50, // Characters per second (50 cps = ~20ms per character)
    showTypingCursor = true,
    cursorCharacter = "|",
    autoContinueAfterTyping,
    autoContinueDelay,
    pauseBeforeContinue,
    autoAdvanceAfterTyping,
    autoAdvanceDelay,
    pauseBeforeAdvance,
  } = props;
  // Deprecated names fold into the new ones (new name wins).
  const autoContinue = autoContinueAfterTyping ?? autoAdvanceAfterTyping ?? false;
  const continueDelay = autoContinueDelay ?? autoAdvanceDelay ?? 500;
  const clickPause = pauseBeforeContinue ?? pauseBeforeAdvance ?? 0;

  // The config fields forward as one memoized spread (config identity is
  // dialogue identity, so it must be stable across renders); the live fields
  // forward as the whole props object — the hook ref-reads exactly its live
  // fields off it (logError, logDebug, onDialogueComplete, onStoryEnd) and
  // ignores everything else, so new live options forward with zero edits.
  const config = useMemo<UseDialogueOptions>(
    () => ({
      startAt,
      functions,
      variables,
      variableStorage,
      contentSaliencyStrategy,
      textProvider,
      lineHints,
    }),
    [startAt, functions, variables, variableStorage, contentSaliencyStrategy, textProvider, lineHints],
  );
  const { result, continue: continueDialogue, selectOption } = useDialogue(program, config, props);

  const sceneName = result?.type === "text" || result?.type === "options" ? result.scene : undefined;
  const speaker = result?.type === "text" ? result.speaker : undefined;
  const sceneCollection = scenes || { scenes: {} };
  const sceneElement = (
    <DialogueScene
      sceneName={sceneName}
      speaker={speaker}
      scenes={sceneCollection}
      actorTransitionDuration={actorTransitionDuration}
    />
  );

  const [typingDoneFor, setTypingDoneFor] = useState<DialogueViewResult | null>(
    null,
  );
  const [currentTextKey, setCurrentTextKey] = useState(0);
  const [skipTyping, setSkipTyping] = useState(false);
  const continueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Cancel the scheduled continue, if one is pending — the scheduler owns
   *  exactly one timer, so cancelling is clearing that one slot. */
  const cancelScheduledContinue = useCallback(() => {
    if (continueTimerRef.current !== null) {
      clearTimeout(continueTimerRef.current);
      continueTimerRef.current = null;
    }
  }, []);

  /** The continue scheduler: one timer for every deferred continue, fed by
   *  named causes. Scheduling replaces any pending timer — there is never
   *  more than one. */
  const scheduleContinue = useCallback(
    (cause: ContinueCause) => {
      cancelScheduledContinue();
      const delay =
        cause === "command"
          ? COMMAND_CONTINUE_DELAY_MS
          : cause === "typing-done"
            ? continueDelay
            : clickPause;
      continueTimerRef.current = setTimeout(() => {
        continueTimerRef.current = null;
        continueDialogue();
      }, delay);
    },
    [cancelScheduledContinue, continueDialogue, continueDelay, clickPause],
  );

  // The one invalidation site: a scheduled continue belongs to the view
  // state that scheduled it, so a new view state (or unmount) cancels it.
  // React runs cleanups before setups in a commit, so the previous state's
  // timer is always gone before the next state's effects schedule anew.
  useEffect(() => cancelScheduledContinue, [cancelScheduledContinue, result]);

  // A surfaced command auto-continues after its brief flash.
  useEffect(() => {
    if (result?.type === "command") {
      scheduleContinue("command");
    }
  }, [result, scheduleContinue]);

  // Reset typing state when the text changes (TypingText remounts per line).
  useEffect(() => {
    if (result?.type === "text") {
      setTypingDoneFor(null);
      setSkipTyping(false);
      setCurrentTextKey((prev) => prev + 1); // Force re-render of TypingText
    }
  }, [result?.type === "text" ? result.text : null]);

  // Auto-continue after the typing animation completes (if enabled). The
  // guard is the result identity the typing finished for, so a stale
  // completion can never schedule a continue for newer text.
  useEffect(() => {
    if (autoContinue && result?.type === "text" && typingDoneFor === result) {
      scheduleContinue("typing-done");
    }
  }, [autoContinue, typingDoneFor, result, scheduleContinue]);

  if (!result) {
    return (
      <div className={`yd-empty ${className || ""}`}>
        <p>Dialogue ended or not started.</p>
      </div>
    );
  }

  if (result.type === "text") {
    const displayText = result.text || "\u00A0";

    const handleClick = () => {
      // If typing is in progress, skip it; the scheduler's typing-done cause
      // takes over from there.
      if (enableTypingAnimation && typingDoneFor !== result) {
        setSkipTyping(true);
        setTypingDoneFor(result);
        return;
      }
      // A click supersedes any scheduled continue (a pending typing-done,
      // say), then continues now or after the configured pause — a zero
      // pause stays synchronous, continuing within the click.
      cancelScheduledContinue();
      if (clickPause > 0) {
        scheduleContinue("click");
      } else {
        continueDialogue();
      }
    };

    return (
      <div className="yd-container">
        {sceneElement}
        <div
          className={`yd-dialogue-box ${className || ""}`}
          onClick={handleClick}
        >
          <div className="yd-text-box">
            {result.speaker && (
              <div className="yd-speaker">
                {result.speaker}
              </div>
            )}
            <p className={`yd-text ${result.speaker ? "yd-text-with-speaker" : ""}`}>
              {enableTypingAnimation ? (
                <TypingText
                  key={currentTextKey}
                  text={displayText}
                  markup={result.markup}
                  typingSpeed={typingSpeed}
                  showCursor={showTypingCursor}
                  cursorCharacter={cursorCharacter}
                  disabled={skipTyping}
                  onComplete={() => setTypingDoneFor(result)}
                />
              ) : (
                <MarkupRenderer text={displayText} markup={result.markup} />
              )}
            </p>
            {!enableTypingAnimation && (
              <div className="yd-continue">
                ▼
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (result.type === "options") {
    return (
      <div className="yd-container">
        {sceneElement}
        <div className={`yd-options-container ${className || ""}`}>
          <div className="yd-options-box">
            <div className="yd-options-title">Choose an option:</div>
            <div className="yd-options-list">
              {result.options.map((option) => {
                return (
                  <button
                    key={option.index}
                    className="yd-option-button"
                    disabled={!option.isAvailable}
                    onClick={() => selectOption(option.index)}
                  >
                    <MarkupRenderer text={option.text} markup={option.markup} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Command result - auto-continue
  if (result.type === "command") {
    return (
      <div className="yd-container">
        {sceneElement}
        <div className={`yd-command ${className || ""}`}>
          <p>Executing: {result.command}</p>
        </div>
      </div>
    );
  }

  return null;
}
