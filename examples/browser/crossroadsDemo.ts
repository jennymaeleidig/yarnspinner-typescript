// SPDX-License-Identifier: CC0-1.0
// The dialogue tab: the vanilla runtime with no view layer — construct
// Dialogue, render the transcript (plain text) and the live option set,
// act on input, repeat. Manual continue only; no scheduling, no typing
// effect, no markup rendering.
import {
  Dialogue,
  EMPTY_TRANSCRIPT,
  runUntilStopped,
} from "yarnspinner-typescript";
import type { StoppingPoint, Transcript } from "yarnspinner-typescript";
import wayside from "../content/project.yarnproject";
import { el } from "./dom.js";

export function mountDialogueDemo(root: HTMLElement): void {
  if (!wayside.program) {
    throw new Error("the shared project compiled to no program");
  }
  const program = wayside.program;

  let dialogue: Dialogue;
  let transcript: Transcript = EMPTY_TRANSCRIPT;
  let stopped: StoppingPoint = "line";

  const linesEl = el("div", "demo-lines");
  const controlsEl = el("div", "demo-controls");
  root.append(linesEl, controlsEl);

  function start(): void {
    dialogue = new Dialogue(program, { startAt: "Start" });
    transcript = EMPTY_TRANSCRIPT;
    step();
  }

  function step(): void {
    ({ transcript, stopped } = runUntilStopped(dialogue, transcript));
    render();
  }

  function select(index: number): void {
    dialogue.selectOption(index);
    step();
  }

  function render(): void {
    linesEl.replaceChildren(
      ...transcript.lines.map((line) => {
        const p = el("p", "demo-line");
        if (line.speaker) p.append(el("strong", "demo-speaker", line.speaker));
        p.append(el("span", undefined, line.text));
        return p;
      }),
      ...transcript.commands.map((command) => el("p", "demo-command", command)),
    );

    const controls: HTMLElement[] = [];
    if (transcript.options) {
      for (const option of transcript.options) {
        const button = el("button", "demo-option", option.text);
        button.type = "button";
        button.addEventListener("click", () => select(option.index));
        controls.push(button);
      }
    } else {
      const complete = stopped === "complete";
      const button = el(
        "button",
        "demo-button",
        complete ? "Restart" : "Continue",
      );
      button.type = "button";
      button.addEventListener("click", complete ? start : step);
      controls.push(button);
    }
    controlsEl.replaceChildren(...controls);
  }

  start();
}
