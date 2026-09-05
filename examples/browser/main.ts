// SPDX-License-Identifier: CC0-1.0
// The browser demo: two vanilla tabs over the framework-agnostic runtime.
// The demo consumes the built package through the workspace (dist/, the
// package root) and loads content via yarnspinner-vite-plugin's direct
// import — the shared examples/content projects, compiled at build time,
// no inline template strings.
import { el } from "./dom.js";
import { mountDialogueDemo } from "./dialogueDemo.js";
import { mountStoryletsDemo } from "./StoryletsDemo.js";
// The demo owns its styling (the package ships no CSS).
import "./dialogue.css";

const TABS = [
  { id: "dialogue", label: "Dialogue", mount: mountDialogueDemo },
  { id: "storylets", label: "Storylets", mount: mountStoryletsDemo },
] as const;

const nav = el("nav", "demo-tabs");
nav.setAttribute("role", "tablist");
nav.setAttribute("aria-label", "Demos");
const panels: Record<string, HTMLElement> = {};

for (const tab of TABS) {
  const button = el("button", "demo-tab", tab.label);
  button.type = "button";
  button.setAttribute("role", "tab");
  button.id = `tab-${tab.id}`;
  const panel = el("section", "demo-panel");
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", button.id);
  tab.mount(panel);
  panels[tab.id] = panel;
  button.addEventListener("click", () => activate(tab.id));
  nav.append(button);
}

function activate(id: string): void {
  for (const tab of TABS) {
    const selected = tab.id === id;
    const button = document.getElementById(`tab-${tab.id}`)!;
    button.setAttribute("aria-selected", String(selected));
    button.classList.toggle("demo-tab--active", selected);
    panels[tab.id].hidden = !selected;
  }
}

const app = document.getElementById("app");
if (!app) {
  throw new Error("Root element not found");
}
app.append(nav, ...TABS.map((tab) => panels[tab.id]));
activate("dialogue");
