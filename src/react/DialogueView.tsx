import React, { useRef, useEffect, useState } from "react";
import { DialogueScene } from "./DialogueScene.js";
import type { SceneCollection } from "../scene/types.js";
import { TypingText } from "./TypingText.js";
import { useDialogue } from "./useDialogue.js";
import { MarkupRenderer } from "./MarkupRenderer.js";
// Note: CSS is imported in the browser demo entry point (examples/browser/main.tsx)
// This prevents Node.js from trying to resolve CSS imports during tests

import type { Program } from "../compile/program.js";
import type { TextProvider } from "../runtime/textProvider.js";
import type { VariableStorage } from "../runtime/variableStorage.js";

export interface DialogueViewProps {
  program: Program;
  startNode?: string;
  className?: string;
  scenes?: SceneCollection;
  actorTransitionDuration?: number;
  // Custom functions and callbacks
  functions?: Record<string, (...args: unknown[]) => unknown>;
  variables?: Record<string, unknown>;
  /** Variable storage (the persistence seam); identity change rebuilds the dialogue. */
  variableStorage?: VariableStorage;
  /** Text provider (localisation); identity change rebuilds the dialogue. There is no
   *  component-level language switch — hosts needing `setLanguage` should use the
   *  `useDialogue` hook, whose result exposes the `dialogue` for it. */
  textProvider?: TextProvider;
  /** Opt-in `LineHints` events (consumed silently by the hook); flipping rebuilds. */
  lineHints?: boolean;
  /** Runtime error diagnostics (default `console.error`); changing it is ignored. */
  logError?: (message: string) => void;
  /** Runtime debug diagnostics (default silent); changing it is ignored. */
  logDebug?: (message: string) => void;
  /** Fired after commit when the dialogue completes (the `DialogueComplete`
   *  event). Takes precedence over the deprecated `onStoryEnd`. */
  onDialogueComplete?: (info: { variables: Readonly<Record<string, unknown>>; dialogueComplete: true }) => void;
  /** @deprecated Renamed to `onDialogueComplete` (ticket 55); removed in the
   *  release after the one that ships this alias. */
  onStoryEnd?: (info: { variables: Readonly<Record<string, unknown>>; storyEnd: true }) => void;
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

export function DialogueView({
  program,
  startNode = "Start",
  className,
  scenes,
  actorTransitionDuration = 350,
  functions,
  variables,
  variableStorage,
  textProvider,
  lineHints,
  logError,
  logDebug,
  onDialogueComplete,
  onStoryEnd,
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
}: DialogueViewProps) {
  // Deprecated names fold into the new ones (new name wins).
  const autoContinue = autoContinueAfterTyping ?? autoAdvanceAfterTyping ?? false;
  const continueDelay = autoContinueDelay ?? autoAdvanceDelay ?? 500;
  const clickPause = pauseBeforeContinue ?? pauseBeforeAdvance ?? 0;

  const { result, continue: continueDialogue, selectOption } = useDialogue(program, {
    startAt: startNode,
    functions,
    variables,
    variableStorage,
    textProvider,
    lineHints,
    logError,
    logDebug,
    onDialogueComplete,
    onStoryEnd,
  });

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

  const [typingComplete, setTypingComplete] = useState(false);
  const [currentTextKey, setCurrentTextKey] = useState(0);
  const [skipTyping, setSkipTyping] = useState(false);
  const continueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!result || result.type !== "command") {
      return;
    }
    const timer = setTimeout(() => continueDialogue(), 50);
    return () => clearTimeout(timer);
  }, [result, continueDialogue]);

  // Reset typing completion when text changes
  useEffect(() => {
    if (result?.type === "text") {
      setTypingComplete(false);
      setSkipTyping(false);
      setCurrentTextKey((prev) => prev + 1); // Force re-render of TypingText
    }
    // Cleanup any pending continue timeouts when text changes
    return () => {
      if (continueTimeoutRef.current) {
        clearTimeout(continueTimeoutRef.current);
        continueTimeoutRef.current = null;
      }
    };
  }, [result?.type === "text" ? result.text : null]);

  // Handle auto-continue after typing completes
  useEffect(() => {
    if (
      autoContinue &&
      typingComplete &&
      result?.type === "text" &&
      !result.isDialogueEnd
    ) {
      const timer = setTimeout(() => {
        continueDialogue();
      }, continueDelay);
      return () => clearTimeout(timer);
    }
  }, [autoContinue, typingComplete, result, continueDialogue, continueDelay]);

  if (!result) {
    return (
      <div className={`yd-empty ${className || ""}`}>
        <p>Dialogue ended or not started.</p>
      </div>
    );
  }

  if (result.type === "text") {
    const displayText = result.text || "\u00A0";
    const shouldShowContinue = !result.isDialogueEnd && !enableTypingAnimation;

    const handleClick = () => {
      if (result.isDialogueEnd) return;
      
      // If typing is in progress, skip it; otherwise continue
      if (enableTypingAnimation && !typingComplete) {
        // Skip typing animation
        setSkipTyping(true);
        setTypingComplete(true);
      } else {
        // Clear any pending timeout
        if (continueTimeoutRef.current) {
          clearTimeout(continueTimeoutRef.current);
          continueTimeoutRef.current = null;
        }

        // Apply pause before continuing if configured
        if (clickPause > 0) {
          continueTimeoutRef.current = setTimeout(() => {
            continueDialogue();
            continueTimeoutRef.current = null;
          }, clickPause);
        } else {
          continueDialogue();
        }
      }
    };

    return (
      <div className="yd-container">
        {sceneElement}
        <div
          className={`yd-dialogue-box ${result.isDialogueEnd ? "yd-text-box-end" : ""} ${className || ""}`}
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
                  onComplete={() => setTypingComplete(true)}
                />
              ) : (
                <MarkupRenderer text={displayText} markup={result.markup} />
              )}
            </p>
            {shouldShowContinue && (
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
