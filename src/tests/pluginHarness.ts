// SPDX-License-Identifier: CC0-1.0
// Shared harness for driving the Vite plugin the way Vite does: hooks may
// arrive as {handler} wrappers or bare functions, every hook call carries a
// plugin context, and emitted ESM is evaluated via a data-URL import.
import { ok } from "node:assert";
import type { DialogueEvent } from "yarn-spinner-runner-ts";

/** Vite wraps hooks as {handler} | fn; call them the way Vite would. */
export const callHook = (hook: unknown, thisArg: unknown, ...args: unknown[]): unknown => {
  const fn = typeof hook === "function" ? hook : (hook as { handler?: unknown }).handler;
  ok(typeof fn === "function", "hook missing");
  return (fn as (...a: unknown[]) => unknown).call(thisArg, ...args);
};

/** Vite always supplies a plugin context on hook calls; the seam mirrors that. */
export const viteCtx = (): { warn: () => void } => ({ warn: () => {} });

/** Evaluate plugin-emitted module code without touching the filesystem. */
export const importEmitted = async (code: string): Promise<any> =>
  import(`data:text/javascript,${encodeURIComponent(code)}`);

/** The text of every line event, in order. */
export const lineTexts = (events: DialogueEvent[]): string[] =>
  events
    .filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line")
    .map((e) => e.text);

/** The first line event's text; asserts that one exists. */
export const firstLine = (events: DialogueEvent[]): string => {
  const line = events.find(
    (e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line",
  );
  ok(line, "expected a line event");
  return line.text;
};
