import React, { useRef, useEffect, useState } from "react";
import { DialogueScene } from "./DialogueScene.js";
import type { SceneCollection } from "../scene/types.js";
import { TypingText } from "./TypingText.js";
import { useYarnRunner } from "./useYarnRunner.js";
import { MarkupRenderer } from "./MarkupRenderer.js";
// Note: CSS is imported in the browser demo entry point (examples/browser/main.tsx)
// This prevents Node.js from trying to resolve CSS imports during tests

import type { IRProgram } from "../compile/ir.js";

export interface DialogueViewProps {
  program: IRProgram;
  startNode?: string;
  className?: string;
  scenes?: SceneCollection;
  actorTransitionDuration?: number;
  // Custom functions and callbacks
  functions?: Record<string, (...args: unknown[]) => unknown>;
  variables?: Record<string, unknown>;
  onStoryEnd?: (info: { variables: Readonly<Record<string, unknown>>; storyEnd: true }) => void;
  // Typing animation options
  enableTypingAnimation?: boolean;
  typingSpeed?: number;
  showTypingCursor?: boolean;
  cursorCharacter?: string;
  // Auto-advance after typing completes
  autoAdvanceAfterTyping?: boolean;
  autoAdvanceDelay?: number; // Delay in ms after typing completes before auto-advancing
  // Pause before advance
  pauseBeforeAdvance?: number; // Delay in ms before advancing when clicking (0 = no pause)
}

export function DialogueView({
  program,
  startNode = "Start",
  className,
  scenes,
  actorTransitionDuration = 350,
  functions,
  variables,
  onStoryEnd,
  enableTypingAnimation = false,
  typingSpeed = 50, // Characters per second (50 cps = ~20ms per character)
  showTypingCursor = true,
  cursorCharacter = "|",
  autoAdvanceAfterTyping = false,
  autoAdvanceDelay = 500,
  pauseBeforeAdvance = 0,
}: DialogueViewProps) {
  const { result, advance, runner } = useYarnRunner(program, {
    startAt: startNode,
    functions,
    variables,
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
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storyEndTriggeredRef = useRef(false);

  useEffect(() => {
    storyEndTriggeredRef.current = false;
  }, [program, startNode]);

  useEffect(() => {
    if (!result || result.type !== "command") {
      return;
    }
    const timer = setTimeout(() => advance(), 50);
    return () => clearTimeout(timer);
  }, [result, advance]);

  useEffect(() => {
    if (!onStoryEnd || !result || storyEndTriggeredRef.current) {
      return;
    }
    if (!result.isDialogueEnd) {
      return;
    }
    if (result.type === "options") {
      return;
    }

    storyEndTriggeredRef.current = true;
    const variablesSnapshot = Object.freeze({ ...(runner?.getVariables?.() ?? {}) });
    onStoryEnd({ storyEnd: true, variables: variablesSnapshot });
  }, [result, onStoryEnd, runner]);

  // Reset typing completion when text changes
  useEffect(() => {
    if (result?.type === "text") {
      setTypingComplete(false);
      setSkipTyping(false);
      setCurrentTextKey((prev) => prev + 1); // Force re-render of TypingText
    }
    // Cleanup any pending advance timeouts when text changes
    return () => {
      if (advanceTimeoutRef.current) {
        clearTimeout(advanceTimeoutRef.current);
        advanceTimeoutRef.current = null;
      }
    };
  }, [result?.type === "text" ? result.text : null]);

  // Handle auto-advance after typing completes
  useEffect(() => {
    if (
      autoAdvanceAfterTyping &&
      typingComplete &&
      result?.type === "text" &&
      !result.isDialogueEnd
    ) {
      const timer = setTimeout(() => {
        advance();
      }, autoAdvanceDelay);
      return () => clearTimeout(timer);
    }
  }, [autoAdvanceAfterTyping, typingComplete, result, advance, autoAdvanceDelay]);

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
      
      // If typing is in progress, skip it; otherwise advance
      if (enableTypingAnimation && !typingComplete) {
        // Skip typing animation
        setSkipTyping(true);
        setTypingComplete(true);
      } else {
        // Clear any pending timeout
        if (advanceTimeoutRef.current) {
          clearTimeout(advanceTimeoutRef.current);
          advanceTimeoutRef.current = null;
        }

        // Apply pause before advance if configured
        if (pauseBeforeAdvance > 0) {
          advanceTimeoutRef.current = setTimeout(() => {
            advance();
            advanceTimeoutRef.current = null;
          }, pauseBeforeAdvance);
        } else {
          advance();
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
              {result.options.map((option, index) => {
                return (
                  <button
                    key={index}
                    className="yd-option-button"
                    onClick={() => advance(index)}
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

  // Command result - auto-advance
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
