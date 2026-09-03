import { test } from "node:test";
import { strictEqual, ok, deepEqual } from "node:assert";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseYarn, compileDocument, Dialogue, YarnRunner } from "../index.js";
import type { Program } from "../compile/program.js";
import {
  useDialogue,
  useYarnRunner,
  type StoryEndInfo,
  type UseDialogueResult,
} from "../react/useDialogue.js";
import type {
  UseDialogueOptions,
  UseYarnRunnerOptions,
  UseYarnRunnerResult,
} from "../react/useDialogue.js";
import { DialogueView } from "../react/DialogueView.js";
import { setupClientDom, tickClock } from "./clientDomHarness.js";

/**
 * Ticket 53 (the 0.2.0 breaking wave): `YarnRunner` → `Dialogue` and
 * `useYarnRunner` → `useDialogue` ship with one-release deprecated aliases.
 * These tests pin the alias contract — the aliases ARE the new names (same
 * value, same identity), so nothing can accidentally fork behavior between
 * them. The aliases are removed in the release after 0.2.0.
 */

test("YarnRunner is a deprecated alias of Dialogue (same value)", () => {
  strictEqual(YarnRunner, Dialogue);
});

test("useYarnRunner is a deprecated alias of useDialogue (same value)", () => {
  strictEqual(useYarnRunner, useDialogue);
});

test("the YarnRunner alias runs dialogue exactly like Dialogue", () => {
  const program = compileDocument(
    parseYarn(`title: Start
---
Narrator: Hi
===
`),
  );
  // Cast through the alias's documented type to prove it is usable as the
  // runtime in old consumer code.
  const runner: YarnRunner = new YarnRunner(program, { startAt: "Start" });
  const events = runner.continue();
  strictEqual(events[0].type, "nodeStart");
  strictEqual(events.some((e) => e.type === "line" && e.text === "Hi"), true);
});

// Type-level: the option/result aliases must remain interchangeable with the
// new names (compile-time contract, asserted by these assignments).
const _optionsAliasCheck: UseDialogueOptions = {} as UseYarnRunnerOptions;
const _resultAliasCheck: UseYarnRunnerResult = {} as UseDialogueResult;
void _optionsAliasCheck;
void _resultAliasCheck;

// ── Ticket 55 (adapter resurfacing): advance → continue, onStoryEnd →
// onDialogueComplete. Same one-release alias contract as ticket 53.

test("useDialogue result: advance is a deprecated exact alias of continue (same function)", () => {
  const program: Program = compileDocument(
    parseYarn(`title: Start
---
<<set $gold = 1>>
Mae: one
Mae: two
===
`),
  );

  // The hook runs during server render (useRef/useCallback/useReducer are
  // SSR-supported), so a probe component can capture the result object.
  const capture: { hook: UseDialogueResult | null } = { hook: null };
  function Probe(props: { program: Program }) {
    capture.hook = useDialogue(props.program, { startAt: "Start" });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe, { program }));

  const captured = capture.hook;
  ok(captured, "the hook did not run");
  ok(captured!.result?.type === "text", "the opening line reduced");
  // Exact alias: the same function value under both names.
  strictEqual(captured!.advance, captured!.continue);
  ok(typeof captured!.continue === "function");
});

// ── Ticket 55 behaviour pins (client-render harness) ─────────────────────
// The SSR harness (`renderToStaticMarkup`) never fires post-commit effects,
// so the behavioural half of the alias contract — `onStoryEnd`'s
// absent-precedence fallback with its original payload, and the three
// typing-flow prop aliases — is pinned with a jsdom client render
// (`createRoot` + `act`): effects and timers included. The harness lives in
// `clientDomHarness.ts`, shared with the continue-scheduler pins.

const COMPLETE_YARN = `title: Start
---
<<set $gold = 3>>
Mae: only
===
`;

// Config identity = dialogue identity: the config must be a stable object
// across re-renders (an inline literal would rebuild — and discard pending
// state — on every render). `live` may stay inline: the hook ref-reads it.
const EMPTY_CONFIG: UseDialogueOptions = {};

const TWO_LINE_YARN = `title: Start
---
Mae: one
Mae: two
===
`;

test("onStoryEnd (deprecated): fires only when onDialogueComplete is absent, with its original payload", async () => {
  setupClientDom();
  const program = compileDocument(parseYarn(COMPLETE_YARN));
  const storyEnds: StoryEndInfo[] = [];
  const capture: { hook: UseDialogueResult | null } = { hook: null };
  function Probe() {
    capture.hook = useDialogue(program, EMPTY_CONFIG, { onStoryEnd: (info) => storyEnds.push(info) });
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(React.createElement(Probe));
    });
    ok(capture.hook, "the hook did not run");
    await act(async () => {
      capture.hook!.continue(); // completes the one-line story
    });

    strictEqual(storyEnds.length, 1, "expected exactly one storyEnd");
    strictEqual(storyEnds[0].storyEnd, true, "the alias keeps its original payload flag");
    deepEqual(storyEnds[0].variables, { gold: 3 }, "the payload carries the story variables");
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("onStoryEnd (deprecated): onDialogueComplete wins when both are given", async () => {
  setupClientDom();
  const program = compileDocument(parseYarn(COMPLETE_YARN));
  const storyEnds: StoryEndInfo[] = [];
  const completes: { variables: Readonly<Record<string, unknown>>; dialogueComplete: boolean }[] = [];
  const capture: { hook: UseDialogueResult | null } = { hook: null };
  function Probe() {
    capture.hook = useDialogue(program, EMPTY_CONFIG, {
      onDialogueComplete: (info) => completes.push(info),
      onStoryEnd: (info) => storyEnds.push(info),
    });
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(React.createElement(Probe));
    });
    ok(capture.hook, "the hook did not run");
    await act(async () => {
      capture.hook!.continue();
    });

    strictEqual(completes.length, 1, "the new name must fire");
    strictEqual(completes[0].dialogueComplete, true);
    deepEqual(completes[0].variables, { gold: 3 });
    deepEqual(storyEnds, [], "the deprecated name must not also fire");
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("DialogueView typing-flow aliases: autoAdvanceAfterTyping + autoAdvanceDelay drive the auto-continue", async (t) => {
  setupClientDom();
  // The continue scheduler is under test, so the clock is fake: typing
  // (typingSpeed 3 ms/character is setTimeout-driven in TypingText) and the
  // scheduled continue both advance only when ticked — no real-time polling,
  // no event-loop margins.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const program = compileDocument(parseYarn(TWO_LINE_YARN));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        React.createElement(DialogueView, {
          program,
          enableTypingAnimation: true,
          typingSpeed: 3,
          // Both deprecated aliases must fold into their new names: the flag
          // enables auto-continue, and the 5ms alias delay must be used in
          // place of the 500ms default (which would never fire inside these
          // ticks).
          autoAdvanceAfterTyping: true,
          autoAdvanceDelay: 5,
        }),
      );
    });
    ok(container.textContent?.includes("Mae"), "the opening line rendered");

    // "one" types over 3×3ms ticks and completes at 12ms; the alias delay
    // (5ms, not the 500ms default) then precedes the auto-continue.
    await tickClock(t, 15);
    await tickClock(t, 10); // continue fires at ~20ms; line two starts typing
    await tickClock(t, 15); // line two finishes typing
    ok(
      container.textContent?.includes("two"),
      `expected the alias-driven auto-continue to reach line two, got: ${container.textContent}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test("DialogueView typing-flow aliases: pauseBeforeAdvance pauses a click before continuing", async (t) => {
  setupClientDom();
  // Fake clock: the 50ms alias pause and the probe can't reorder, no matter
  // how the event loop stalls — tick draws the exact timeline instead.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const program = compileDocument(parseYarn(TWO_LINE_YARN));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(DialogueView, { program, pauseBeforeAdvance: 50 }));
    });
    ok(container.textContent?.includes("one"), "the first line rendered");

    const box = container.querySelector(".yd-dialogue-box");
    ok(box, "the clickable dialogue box rendered");
    await act(async () => {
      box!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Ten ticks into the 50ms alias pause: the click must not have advanced.
    await tickClock(t, 10);
    ok(!container.textContent?.includes("two"), "the click must not advance inside the pause");

    // ...and once the pause has elapsed, it advances.
    await tickClock(t, 45); // t=55, strictly past the 50ms pause
    ok(
      container.textContent?.includes("two"),
      `expected the paused click to reach line two, got: ${container.textContent}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
