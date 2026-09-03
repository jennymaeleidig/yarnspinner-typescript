import React, { useMemo } from "react";
import { DialogueView } from "./DialogueView.js";
import type { DialogueViewProps } from "./DialogueView.js";
import { useDialogue } from "./useDialogue.js";
import type { UseDialogueOptions, UseDialogueLive } from "./useDialogue.js";
import type { Program } from "../compile/program.js";

/**
 * The wired dialogue component (headless split, headless-view ticket 01):
 * the container over the presentational [DialogueView](./DialogueView) — it
 * calls `useDialogue` with `program`/config/live and forwards the result,
 * so `<DialogueRunner program={...} />` is the one-component path. Hosts
 * that want control skip it and pair `useDialogue` with `DialogueView`
 * directly.
 *
 * The prop surface is the pre-split `DialogueView` surface: program +
 * config + live + presentation options, with the ticket-55 deprecated
 * alias names resolved here (new name wins) — the aliases live on the
 * container, not the clean presentational view.
 *
 * Derivation stays single-sourced (deepening-wave ticket 06): presentation
 * options are declared once, on `DialogueViewProps`; config/live derive
 * from the hook's types, so a runtime option flows in without a second
 * declaration. The config fields forward as one memoized spread (config
 * identity is dialogue identity, so it must be stable across renders); the
 * live fields forward as the whole props object — the hook ref-reads
 * exactly its live fields (logError, logDebug, onDialogueComplete,
 * onStoryEnd) and ignores everything else.
 */
export interface DialogueRunnerProps
  extends Omit<DialogueViewProps, "result">,
    UseDialogueOptions,
    UseDialogueLive {
  program: Program;
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

export function DialogueRunner(props: DialogueRunnerProps) {
  const {
    program,
    startAt,
    functions,
    variables,
    variableStorage,
    contentSaliencyStrategy,
    textProvider,
    lineHints,
    className,
    scenes,
    actorTransitionDuration,
    enableTypingAnimation,
    typingSpeed,
    showTypingCursor,
    cursorCharacter,
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
  // fields off it and ignores everything else, so new live options forward
  // with zero edits.
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
  const result = useDialogue(program, config, props);

  return (
    <DialogueView
      result={result}
      className={className}
      scenes={scenes}
      actorTransitionDuration={actorTransitionDuration}
      enableTypingAnimation={enableTypingAnimation}
      typingSpeed={typingSpeed}
      showTypingCursor={showTypingCursor}
      cursorCharacter={cursorCharacter}
      autoContinueAfterTyping={autoContinue}
      autoContinueDelay={continueDelay}
      pauseBeforeContinue={clickPause}
    />
  );
}
