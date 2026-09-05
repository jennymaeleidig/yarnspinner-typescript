// SPDX-License-Identifier: CC0-1.0
// The storylets tab: one node group ("Storylets") drawn repeatedly under a
// switchable saliency strategy, through the public Dialogue API —
// setSaliencyStrategy, setNode, runUntilComplete, getVariables,
// hasSalientContent. The storage-backed view-count history lives and dies
// with the Dialogue instance (Reset proves it). Vanilla, plain text.
import { Dialogue, runUntilComplete } from "yarnspinner-typescript";
import type { Transcript } from "yarnspinner-typescript";
import storyletsProgram from "../content/storylets.yarn";
import { el } from "./dom.js";

/** The built-in saliency strategy modes (upstream `<<set_saliency>>` vocabulary). */
const STRATEGIES = [
  "first",
  "random",
  "best",
  "best_least_recent",
  "random_best_least_recent",
] as const;
const NODE_GROUP = "Storylets";
const HISTORY_LENGTH = 8;

export function mountStoryletsDemo(root: HTMLElement): void {
  let dialogue: Dialogue | null = null;
  let strategy: (typeof STRATEGIES)[number] = "random_best_least_recent";
  let drawTranscript: Transcript | null = null;
  let history: string[] = [];

  const strategyEl = el("div", "demo-strategies");
  const drawEl = el("div", "demo-card");
  const historyEl = el("ol", "demo-history");
  const variablesEl = el("div", "demo-variables");
  root.append(
    el("h2", "demo-heading", "Saliency strategy"),
    strategyEl,
    el("h2", "demo-heading", "Draw"),
    drawEl,
    el("h2", "demo-heading", "Draw history"),
    historyEl,
    el("h2", "demo-heading", "Story variables"),
    variablesEl,
  );

  function getDialogue(): Dialogue {
    if (dialogue === null) {
      dialogue = new Dialogue(storyletsProgram, { startAt: "StoryletsIntro" });
      dialogue.setSaliencyStrategy(strategy);
    }
    return dialogue;
  }

  function drawStorylet(): void {
    const d = getDialogue();
    d.setNode(NODE_GROUP);
    // Storylets deliver lines only, so the draw drains to its terminal
    // stopping point (an option set can never be mistaken for over-drain).
    drawTranscript = runUntilComplete(d).transcript;
    if (drawTranscript.lines.length > 0) {
      history = [
        ...history.slice(-(HISTORY_LENGTH - 1)),
        drawTranscript.lines[0].text,
      ];
    }
    refresh();
  }

  function switchStrategy(mode: (typeof STRATEGIES)[number]): void {
    strategy = mode;
    // Takes effect at the next node-group entry; the view-count history
    // carries across the switch.
    dialogue?.setSaliencyStrategy(mode);
    refresh();
  }

  function reset(): void {
    dialogue = null;
    drawTranscript = null;
    history = [];
    refresh();
  }

  function refresh(): void {
    strategyEl.replaceChildren(
      ...STRATEGIES.map((mode) => {
        const button = el("button", "demo-button", mode);
        button.type = "button";
        if (mode === strategy) button.classList.add("demo-button--active");
        button.addEventListener("click", () => switchStrategy(mode));
        return button;
      }),
    );

    drawEl.replaceChildren(
      ...(drawTranscript === null
        ? [el("p", "demo-muted", "Draw to see which storylet runs.")]
        : drawTranscript.lines.map((line) => {
            const p = el("p", "demo-line");
            if (line.speaker)
              p.append(el("strong", "demo-speaker", line.speaker));
            p.append(el("span", undefined, line.text));
            return p;
          })),
    );
    drawEl.append(...actionRow());
    historyEl.replaceChildren(
      ...history.map((label) => {
        const li = el("li", undefined, label);
        return li;
      }),
    );
    variablesEl.replaceChildren(
      ...Object.entries(getDialogue().getVariables()).map(([name, value]) =>
        el("span", "demo-chip", `$${name} = ${String(value)}`),
      ),
    );
  }

  function actionRow(): HTMLElement[] {
    const row = el("div", "demo-controls");
    const drawButton = el(
      "button",
      "demo-button demo-button--primary",
      "Draw a storylet",
    );
    drawButton.type = "button";
    drawButton.addEventListener("click", drawStorylet);
    const resetButton = el("button", "demo-button", "Reset");
    resetButton.type = "button";
    resetButton.addEventListener("click", reset);
    row.append(drawButton, resetButton);
    if (dialogue !== null && !dialogue.hasSalientContent(NODE_GROUP)) {
      row.append(
        el(
          "span",
          "demo-muted",
          "No salient content — every member's conditions fail.",
        ),
      );
    }
    return [row];
  }

  refresh();
}
