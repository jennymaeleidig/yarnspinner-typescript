// SPDX-License-Identifier: CC0-1.0
import React, { useRef, useEffect, useState, useCallback } from "react";
import { DialogueScene } from "./DialogueScene.js";
import type { SceneCollection } from "../scene/types.js";
import { TypingText } from "./TypingText.js";
import type { DialogueViewResult, UseDialogueResult } from "./useDialogue.js";
import { MarkupRenderer } from "./MarkupRenderer.js";

/** Why the continue scheduler is deferring a continue; each cause maps to
 *  its delay: a command flashes for `COMMAND_CONTINUE_DELAY_MS`, a finished
 *  typing animation waits for `continueDelay`, a click waits for
 *  `clickPause`. */
type ContinueCause = "command" | "typing-done" | "click";

/** How long a surfaced command stays on screen before the scheduler skips
 *  past it (not configurable — commands are never the point of the story). */
const COMMAND_CONTINUE_DELAY_MS = 50;

/**
 * The presentational dialogue view (headless split, headless-view ticket
 * 01): it renders a `UseDialogueResult` — no `program`, no hook call — and
 * owns **presentation state only**: the typing progress and skip, and the
 * one continue scheduler (ticket 04's causes: command flash, typing-done,
 * click). All dialogue state and transitions arrive on the result object.
 *
 * Hosts that want the wiring done for them use `DialogueRunner` (program +
 * config + live, the deprecated alias names resolved there); hosts that
 * want control pair `useDialogue` with this view directly:
 *
 * ```tsx
 * const result = useDialogue(program, config);
 * <DialogueView result={result} enableTypingAnimation />
 * ```
 */
export interface DialogueViewProps {
  /** The dialogue to render — the hook's whole return value. */
  result: UseDialogueResult;
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
}

export function DialogueView(props: DialogueViewProps) {
  const {
    result,
    className,
    scenes,
    actorTransitionDuration = 350,
    enableTypingAnimation = false,
    typingSpeed = 50, // Characters per second (50 cps = ~20ms per character)
    showTypingCursor = true,
    cursorCharacter = "|",
    autoContinueAfterTyping,
    autoContinueDelay,
    pauseBeforeContinue,
  } = props;
  const continueDelay = autoContinueDelay ?? 500;
  const clickPause = pauseBeforeContinue ?? 0;

  // The result object carries every dialogue state and transition; the view
  // destructures the parts presentation needs.
  const { result: view, continue: continueDialogue, selectOption, sceneName } = result;

  const speaker = view?.type === "text" ? view.speaker : undefined;
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
  useEffect(() => cancelScheduledContinue, [cancelScheduledContinue, view]);

  // A surfaced command auto-continues after its brief flash.
  useEffect(() => {
    if (view?.type === "command") {
      scheduleContinue("command");
    }
  }, [view, scheduleContinue]);

  // Reset typing state when the text changes (TypingText remounts per line).
  useEffect(() => {
    if (view?.type === "text") {
      setTypingDoneFor(null);
      setSkipTyping(false);
      setCurrentTextKey((prev) => prev + 1); // Force re-render of TypingText
    }
  }, [view?.type === "text" ? view.text : null]);

  // Auto-continue after the typing animation completes (if enabled). The
  // guard is the result identity the typing finished for, so a stale
  // completion can never schedule a continue for newer text.
  useEffect(() => {
    if (
      autoContinueAfterTyping &&
      view?.type === "text" &&
      typingDoneFor === view
    ) {
      scheduleContinue("typing-done");
    }
  }, [autoContinueAfterTyping, typingDoneFor, view, scheduleContinue]);

  if (!view) {
    return (
      <div className={`yd-empty ${className || ""}`}>
        <p>Dialogue ended or not started.</p>
      </div>
    );
  }

  if (view.type === "text") {
    const displayText = view.text || "\u00A0";

    const handleClick = () => {
      // If typing is in progress, skip it; the scheduler's typing-done cause
      // takes over from there.
      if (enableTypingAnimation && typingDoneFor !== view) {
        setSkipTyping(true);
        setTypingDoneFor(view);
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
            {view.speaker && (
              <div className="yd-speaker">
                {view.speaker}
              </div>
            )}
            <p className={`yd-text ${view.speaker ? "yd-text-with-speaker" : ""}`}>
              {enableTypingAnimation ? (
                <TypingText
                  key={currentTextKey}
                  text={displayText}
                  markup={view.markup}
                  typingSpeed={typingSpeed}
                  showCursor={showTypingCursor}
                  cursorCharacter={cursorCharacter}
                  disabled={skipTyping}
                  onComplete={() => setTypingDoneFor(view)}
                />
              ) : (
                <MarkupRenderer text={displayText} markup={view.markup} />
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

  if (view.type === "options") {
    return (
      <div className="yd-container">
        {sceneElement}
        <div className={`yd-options-container ${className || ""}`}>
          <div className="yd-options-box">
            <div className="yd-options-title">Choose an option:</div>
            <div className="yd-options-list">
              {view.options.map((option) => {
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
  if (view.type === "command") {
    return (
      <div className="yd-container">
        {sceneElement}
        <div className={`yd-command ${className || ""}`}>
          <p>Executing: {view.command}</p>
        </div>
      </div>
    );
  }

  return null;
}
