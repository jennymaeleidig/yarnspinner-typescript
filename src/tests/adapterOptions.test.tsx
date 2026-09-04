// SPDX-License-Identifier: CC0-1.0
/**
 * Adapter options passthrough: the newer `DialogueOptions` —
 * `variableStorage` (the persistence seam), `textProvider`
 * (localisation), the opt-in `lineHints` flag, and the
 * `logError`/`logDebug` diagnostics — reach React consumers through
 * `useDialogue` (and `<DialogueRunner>`, the wired container).
 *
 * The hook takes `(program, config, live)` with one comparison rule —
 * **config identity = dialogue identity** — pinned below alongside the
 * passthrough behaviour: a new config object rebuilds even with identical
 * values; a new `live` object never does, and its callbacks/logging are
 * always current (read through a ref, not frozen at construction).
 *
 * Harness: SSR hook probes (`renderToStaticMarkup` — the
 * hook runs during server render, and the captured result object keeps
 * working afterwards because its callbacks mutate refs, not React state).
 *
 * Two harness facts shape the assertions:
 * - `result` on the captured hook is the render-time snapshot — post-SSR
 *   `continue()` updates the hook's internal view but never re-renders, so
 *   advancing assertions go through spies and the documented `dialogue`
 *   escape hatch, not `hook.result`.
 * - `lineHints` is pinned through that escape hatch: the hook swallows
 *   `LineHints` events silently, but the event lands in the next batch a
 *   raw `dialogue.continue()` pulls on node entry (after the current
 *   node's `nodeComplete`).
 */

import { test } from "node:test";
import { ok, deepEqual, strictEqual } from "node:assert";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { compileOk } from "./compileOk.js";
import {
  useDialogue,
  type UseDialogueOptions,
  type UseDialogueLive,
  type UseDialogueResult,
} from "../react/useDialogue.js";
import { DialogueRunner } from "../react/DialogueRunner.js";
import type { DialogueRunnerProps } from "../react/DialogueRunner.js";
import { DialogueView } from "../react/DialogueView.js";
import type { DialogueViewProps } from "../react/DialogueView.js";
import type { DialogueOptions } from "../runtime/dialogue.js";
import { setupClientDom } from "./clientDomHarness.js";
import { InMemoryVariableStorage } from "../runtime/variableStorage.js";
import { StringTableTextProvider } from "../runtime/textProvider.js";
import type { Program } from "../compile/program.js";

/** SSR harness: render a probe, hand back the captured hook. */
function captureHook(
  program: Program,
  config: UseDialogueOptions = {},
  live: UseDialogueLive = {},
): UseDialogueResult {
  const capture: { hook: UseDialogueResult | null } = { hook: null };
  function Probe() {
    capture.hook = useDialogue(program, config, live);
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  if (!capture.hook) throw new Error("the hook did not run");
  return capture.hook;
}

// ── variableStorage (the persistence seam) ──────────────────────

const DECLARE_YARN = `title: Start
---
<<declare $playerName = "In-memory default">>
Narrator: Hello {$playerName}!
===
`;

test("useDialogue variableStorage: a pre-populated storage restores state (SSR renders it)", () => {
  const program = compileOk(DECLARE_YARN);
  const storage = new InMemoryVariableStorage();
  storage.set("playerName", "Persisted");

  const hook = captureHook(program, { variableStorage: storage });

  const view = hook.result;
  ok(view?.type === "text", "the opening line reduced");
  ok(
    view.text.includes("Hello Persisted"),
    `expected the restored storage value to survive construction, got: ${view.text}`,
  );
  deepEqual(hook.dialogue.getVariables(), { playerName: "Persisted" });
});

test("useDialogue variableStorage: without one, the declare default stands (default unchanged)", () => {
  const program = compileOk(DECLARE_YARN);
  const hook = captureHook(program, {});
  const view = hook.result;
  ok(view?.type === "text");
  ok(
    view.text.includes("Hello In-memory default"),
    "the in-memory default storage must keep seeding declare defaults",
  );
});

// ── lineHints (opt-in LineHints events) ───────────────────────────────────

const HINTS_YARN = `title: Start
---
Mae: one
<<jump Next>>
===
title: Next
---
Mae: two #line:next_two
Mae: three
===
`;

test("useDialogue lineHints: the flag forwards — entering the next node emits the hints", () => {
  const program = compileOk(HINTS_YARN);
  const hook = captureHook(program, { lineHints: true });

  ok(hook.result?.type === "text", "the opening line reduced");

  // The hook consumes LineHints events silently; the escape hatch proves
  // the flag reached the hook's Dialogue: entering the second node emits
  // the opt-in event in the batch (after the first node's nodeComplete).
  const batch = hook.dialogue.continue();
  const hints = batch.find((e) => e.type === "lineHints");
  ok(hints, "expected a LineHints event in the second node's batch");
  ok(
    hints.lineIds.includes("line:next_two"),
    `expected the node's tagged line ID in the hints, got: ${JSON.stringify(hints.lineIds)}`,
  );
  ok(
    batch.some((e) => e.type === "nodeStart" && e.nodeName === "Next"),
    "the hints ride the same node entry",
  );
});

test("useDialogue lineHints: default off — no LineHints event flows", () => {
  const program = compileOk(HINTS_YARN);
  const hook = captureHook(program, {});
  ok(hook.result?.type === "text");
  const batch = hook.dialogue.continue();
  ok(
    !batch.some((e) => e.type === "lineHints"),
    "without the opt-in flag no LineHints event may be emitted",
  );
  ok(batch.some((e) => e.type === "nodeStart" && e.nodeName === "Next"));
});

// ── textProvider + language switching ──────────────────────────

const LOCALISED_YARN = `title: Start
---
Mae: Hello baked in #line:greet
Mae: Second baked in #line:second
===
`;

function makeProvider(): StringTableTextProvider {
  const provider = new StringTableTextProvider();
  // The base table differs from the program's text: rendering it proves the
  // provider (not the baked-in text) resolved the line.
  provider.extendBaseLanguage({ "line:greet": "Hello from provider", "line:second": "Second from provider" });
  provider.extendTranslation("fr", { "line:greet": "Bonjour du provider", "line:second": "Deuxième du provider" });
  return provider;
}

/**
 * A provider that records its own delivery: the language it resolved under
 * and which line IDs it was asked for. `result` on a captured hook is a
 * render-time snapshot, so post-SSR delivery is observed through this spy
 * — which also proves the hook injected this exact instance (a rebuild
 * with a clone would record nothing here).
 */
class RecordingProvider {
  language: string | null = null;
  readonly queries: string[] = [];

  getText(lineId: string): string | undefined {
    this.queries.push(`${this.language ?? "base"}:${lineId}`);
    // Provider text is the whole line — the speaker split composes from it.
    return this.language === "fr" ? "Mae: Deuxième" : "Mae: BASE";
  }

  setLanguage(language: string | null): void {
    this.language = language;
  }

  areLinesAvailable(): boolean {
    return true;
  }
}

test("useDialogue textProvider: lines resolve through the injected provider (SSR)", () => {
  const program = compileOk(LOCALISED_YARN);
  const provider = new RecordingProvider();
  const hook = captureHook(program, { textProvider: provider });

  const view = hook.result;
  ok(view?.type === "text");
  strictEqual(view.text, "BASE", "the SSR line resolved through the provider");
  ok(provider.queries.includes("base:line:greet"));
});

test("useDialogue textProvider: language switching stays on Dialogue.setLanguage via the escape hatch", () => {
  const program = compileOk(LOCALISED_YARN);
  const provider = new RecordingProvider();
  const hook = captureHook(program, { textProvider: provider });

  // No rebuild, no hook-level language API: the language surface is
  // Dialogue.setLanguage, reached through the documented escape hatch.
  hook.dialogue.setLanguage("fr");
  hook.continue(); // delivers the second line

  ok(
    provider.queries.includes("fr:line:second"),
    `expected line 2 to resolve under fr on the SAME provider instance, got: ${JSON.stringify(provider.queries)}`,
  );
});

// ── logError / logDebug (runtime diagnostics) ─────────────────────────────

const OPTIONS_YARN = `title: Start
---
-> Sit
-> Leave
===
`;

test("useDialogue logError: runtime diagnostics reach the host callback", () => {
  const program = compileOk(OPTIONS_YARN);
  const errors: string[] = [];
  const hook = captureHook(program, {}, { logError: (m) => errors.push(m) });

  ok(hook.result?.type === "options", "the option set delivered");
  hook.selectOption(99); // out of range → the VM reports through logError

  ok(
    errors.some((m) => m.includes("not a valid option")),
    `expected the invalid-selection diagnostic, got: ${JSON.stringify(errors)}`,
  );
});

test("useDialogue logError: default behaviour unchanged — diagnostics fall to console.error", () => {
  const program = compileOk(LOCALISED_YARN);
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => errors.push(message);
  try {
    const hook = captureHook(program, {}); // no logError option
    hook.dialogue.setLanguage("fr"); // no provider → the default diagnostic
  } finally {
    console.error = original;
  }
  ok(
    errors.some((m) => m.includes("setLanguage was called")),
    `expected console.error to receive the diagnostic, got: ${JSON.stringify(errors)}`,
  );
});

test("useDialogue logDebug: runtime debug diagnostics reach the host callback", () => {
  const program = compileOk(`title: Start
---
Mae: only
===
`);
  const debug: string[] = [];
  const hook = captureHook(program, {}, { logDebug: (m) => debug.push(m) });

  ok(hook.result?.type === "text");
  hook.continue(); // completes the one-line story
  // The hook's own pulls never hit an inactive dialogue (the transcript
  // module's at-rest guards return before continue()), so the diagnostic is
  // triggered through the documented escape hatch to prove the logDebug
  // option reaches the Dialogue.
  hook.dialogue.continue(); // inactive dialogue → the VM's debug diagnostic

  ok(
    debug.some((m) => m.includes("inactive")),
    `expected the inactive-dialogue debug message, got: ${JSON.stringify(debug)}`,
  );
});

// ── <DialogueRunner> passthrough (headless split: the wired surface) ──

test("DialogueView forwards variableStorage and textProvider to the hook", () => {
  const restored = compileOk(DECLARE_YARN);
  const storage = new InMemoryVariableStorage();
  storage.set("playerName", "Persisted");
  const persistedHtml = renderToStaticMarkup(
    React.createElement(DialogueRunner, { program: restored, variableStorage: storage }),
  );
  ok(
    persistedHtml.includes("Hello Persisted"),
    "expected DialogueRunner to pass variableStorage through to the hook",
  );

  const localised = compileOk(LOCALISED_YARN);
  const localisedHtml = renderToStaticMarkup(
    React.createElement(DialogueRunner, { program: localised, textProvider: makeProvider() }),
  );
  ok(
    localisedHtml.includes("Hello from provider"),
    "expected DialogueRunner to pass textProvider through to the hook",
  );
});

// ── config/live split: the one rule ──────────────────────────

// Type-level: the one-edit rule — an option
// declared on the runtime's `DialogueOptions` flows into both adapter types
// without a second declaration. These assignments compile only while
// `UseDialogueOptions` derives from `DialogueOptions` and
// `DialogueRunnerProps` derives from the hook's types (the wired surface
// moved from `DialogueView` to `DialogueRunner`).
const _runtimeOptionsFlowToHook: UseDialogueOptions = {} as DialogueOptions;
const _runtimeOptionsFlowToRunner: DialogueRunnerProps = {
  program: {} as Program,
} as DialogueOptions & { program: Program };
void _runtimeOptionsFlowToHook;
void _runtimeOptionsFlowToRunner;

// Headless split: presentation options stay
// single-sourced on `DialogueViewProps` — the runner derives them, so a
// presentation option declared on the view flows into the runner without a
// second declaration. And the view itself takes no `program`.
const _presentationSingleSourced: Omit<DialogueViewProps, "result"> =
  {} as DialogueRunnerProps;
void _presentationSingleSourced;
// The presentational view has no `program` prop; passing one must not compile.
function _noProgramOnView(props: { program: Program }) {
  void props;
  return (
    // @ts-expect-error
    <DialogueView program={{}} result={{} as UseDialogueResult} />
  );
}
void _noProgramOnView;

// The deprecated prop aliases live on the wired container
// (DialogueRunner), not on the clean view; passing them here must not compile.
function _noAliasesOnView() {
  return (
    // @ts-expect-error
    <DialogueView result={{} as UseDialogueResult} autoAdvanceAfterTyping autoAdvanceDelay={5} pauseBeforeAdvance={50} />
  );
}
void _noAliasesOnView;
void _noProgramOnView;

const CONFIG_LIVE_YARN = `title: Start
---
Mae: only
===
`;

/** Shared probe: the SAME component type across renders, so the hook's
 *  state persists and rebuild-vs-ref-read is observable. */
const capture: { hook: UseDialogueResult | null } = { hook: null };
function ConfigLiveProbe(props: {
  program: Program;
  config: UseDialogueOptions;
  live: UseDialogueLive;
}) {
  capture.hook = useDialogue(props.program, props.config, props.live);
  return null;
}

function renderConfigLive(
  root: ReturnType<typeof createRoot>,
  program: Program,
  config: UseDialogueOptions,
  live: UseDialogueLive,
): Promise<void> {
  return act(async () => {
    root.render(React.createElement(ConfigLiveProbe, { program, config, live }));
  });
}

test("useDialogue config/live: config identity is dialogue identity", async () => {
  setupClientDom();
  const program = compileOk(CONFIG_LIVE_YARN);
  const root = createRoot(document.getElementById("root")!);
  const config: UseDialogueOptions = { startAt: "Start" };
  try {
    await renderConfigLive(root, program, config, {});
    const first = capture.hook!.dialogue;

    // The SAME config object (and a fresh live literal): no rebuild.
    await renderConfigLive(root, program, config, {});
    strictEqual(capture.hook!.dialogue, first, "the same config object must not rebuild");

    // A new config object with identical values: a new dialogue — identity
    // is the whole rule, no per-field compare survives.
    await renderConfigLive(root, program, { ...config }, {});
    ok(
      capture.hook!.dialogue !== first,
      "a new config object means a new dialogue, even with identical values",
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("useDialogue config/live: live callbacks are always current (no rebuild, no freeze)", async () => {
  setupClientDom();
  const program = compileOk(CONFIG_LIVE_YARN);
  const root = createRoot(document.getElementById("root")!);
  const config: UseDialogueOptions = {}; // stable config — identity is the rule
  const errorsA: string[] = [];
  const errorsB: string[] = [];
  try {
    await renderConfigLive(root, program, config, { logError: (m) => errorsA.push(m) });
    const first = capture.hook!.dialogue;

    // Swap the logger (a new live object): no rebuild, and the NEW callback
    // receives diagnostics — the old construction-time freeze is gone.
    await renderConfigLive(root, program, config, { logError: (m) => errorsB.push(m) });
    strictEqual(capture.hook!.dialogue, first, "a new live object must not rebuild");

    // Trigger a diagnostic through the documented escape hatch: setLanguage
    // without a provider reports through logError.
    capture.hook!.dialogue.setLanguage("fr");
    deepEqual(errorsA, [], "the pre-swap live callback must be detached");
    ok(
      errorsB.some((m) => m.includes("setLanguage was called")),
      `expected the current live logger to receive the diagnostic, got: ${JSON.stringify(errorsB)}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
