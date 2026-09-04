// SPDX-License-Identifier: CC0-1.0
import { test } from "node:test";
import { ok } from "node:assert";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { compileOk } from "./compileOk.js";
import { DialogueRunner } from "../react/DialogueRunner.js";
import { DialogueView } from "../react/DialogueView.js";
import { useDialogue } from "../react/useDialogue.js";
import { setupClientDom, tickClock } from "./clientDomHarness.js";

/**
 * The continue scheduler: the view defers
 * continues through ONE timer fed by named causes — a surfaced command
 * flashes for a hardcoded 50ms, a finished typing animation waits for
 * `autoContinueDelay`, a clicked line waits for `pauseBeforeContinue` —
 * scheduling replaces any pending timer, and a scheduled continue is
 * cancelled when the view state that scheduled it changes (or on unmount).
 *
 * These pins draw exact timelines on a fake clock (`t.mock.timers`): the
 * clock only moves when ticked, and React effect flushes land at `act`
 * boundaries, so every assertion is deterministic — no widened margins, no
 * event-loop races (the flake that motivated the rewrite).
 */

const TWO_LINE_YARN = `title: Start
---
Mae: one
Mae: two
===
`;

const THREE_LINE_YARN = `title: Start
---
Mae: one
Mae: two
Mae: three
===
`;

const COMMAND_THEN_LINE_YARN = `title: Start
---
<<flash>>
Mae: after the command
===
`;

test("scheduler: works headless — a host's own useDialogue + DialogueView, no runner", async (t) => {
  // The headless split: the scheduler and typing
  // state are presentation state owned by the view, and the result object
  // carries every dialogue transition — so a host that pairs `useDialogue`
  // with `DialogueView` directly (no `DialogueRunner`) gets the identical
  // behavior. Pinned with the command-flash timeline.
  setupClientDom();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const program = compileOk(COMMAND_THEN_LINE_YARN);
  // Config identity = dialogue identity: the host must pass a stable config
  // object (a fresh literal every render would rebuild the dialogue on every
  // render — the documented rule, obeyed by the host under test too).
  const EMPTY_CONFIG: Parameters<typeof useDialogue>[1] = {};
  function HeadlessHost(props: { program: typeof program }) {
    const result = useDialogue(props.program, EMPTY_CONFIG);
    return React.createElement(DialogueView, { result });
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(HeadlessHost, { program }));
    });
    ok(
      container.textContent?.includes("Executing"),
      `expected the command view to surface first, got: ${container.textContent}`,
    );

    // The scheduler is the view's own: past the 50ms flash it continues via
    // the result object's `continue` — no runner in sight.
    await tickClock(t, 60);
    ok(
      container.textContent?.includes("after the command"),
      `expected the headless scheduler to skip past the command, got: ${container.textContent}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

function clickBox(container: HTMLElement): void {
  const box = container.querySelector(".yd-dialogue-box");
  ok(box, "the clickable dialogue box rendered");
  box!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

test("scheduler: a surfaced command auto-continues after its 50ms flash", async (t) => {
  setupClientDom();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const program = compileOk(COMMAND_THEN_LINE_YARN);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(DialogueRunner, { program }));
    });
    ok(
      container.textContent?.includes("Executing"),
      `expected the command view to surface first, got: ${container.textContent}`,
    );
    ok(
      !container.textContent?.includes("after the command"),
      "the line behind the command must not surface early",
    );

    // Twenty ticks in: still flashing (50ms hardcoded, not configurable).
    await tickClock(t, 20);
    ok(!container.textContent?.includes("after the command"));

    // ...and past the flash, the scheduler has skipped to the line.
    await tickClock(t, 40);
    ok(
      container.textContent?.includes("after the command"),
      `expected the scheduler to skip past the command, got: ${container.textContent}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test("scheduler: a zero-pause click continues synchronously within the click", async (t) => {
  setupClientDom();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const program = compileOk(TWO_LINE_YARN);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(DialogueRunner, { program }));
    });
    ok(container.textContent?.includes("one"), "the first line rendered");

    // No pause configured: the continue happens inside the click handler,
    // before any tick — the view has already advanced when the act returns.
    await act(async () => {
      clickBox(container);
    });
    ok(
      container.textContent?.includes("two"),
      `expected a zero-pause click to advance synchronously, got: ${container.textContent}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test("scheduler: a paused click defers, and re-clicking replaces the pending timer", async (t) => {
  setupClientDom();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const program = compileOk(TWO_LINE_YARN);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(DialogueRunner, { program, pauseBeforeContinue: 50 }));
    });
    ok(container.textContent?.includes("one"), "the first line rendered");

    await act(async () => {
      clickBox(container);
    }); // schedules the continue for t=50
    await tickClock(t, 10); // t=10, still inside the pause
    ok(!container.textContent?.includes("two"), "the click must not advance inside the pause");

    // A second click replaces the pending timer (one timer, never stacked):
    // the new deadline is t=60, and the original t=50 deadline is gone —
    // ticking past 50 must therefore NOT advance.
    await act(async () => {
      clickBox(container);
    });
    await tickClock(t, 45); // t=55: past the abandoned deadline, before the new one
    ok(
      !container.textContent?.includes("two"),
      "re-clicking must replace the pending timer, not stack a second one",
    );

    await tickClock(t, 10); // t=65: past the replaced deadline
    ok(
      container.textContent?.includes("two"),
      `expected the replaced timer to fire at its new deadline, got: ${container.textContent}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test("scheduler: a click supersedes a pending typing-done continue", async (t) => {
  setupClientDom();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const program = compileOk(THREE_LINE_YARN);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        React.createElement(DialogueRunner, {
          program,
          enableTypingAnimation: true,
          typingSpeed: 1, // setTimeout-driven typing on the fake clock
          autoContinueAfterTyping: true,
          autoContinueDelay: 100,
        }),
      );
    });

    // "one" finishes typing at t=4; the effect flush lands at t=10, so its
    // auto-continue is scheduled for t=110 (now + the 100ms delay).
    await tickClock(t, 10);
    ok(container.textContent?.includes("one"), "the first line typed");

    // A click with no pause continues synchronously and MUST cancel the
    // pending typing-done timer — otherwise it would yank the view off line
    // two mid-typing.
    await act(async () => {
      clickBox(container);
    }); // t=10: line two renders and restarts typing
    await tickClock(t, 5); // t=15: line two typed; its own auto-continue due at t=115
    ok(container.textContent?.includes("two"), "the click advanced to line two");

    // Tick past the abandoned t=110 deadline: line two must still be on
    // screen (had the click not cancelled the stale timer, it would have
    // fired at t=110 and pulled the view off line two).
    await tickClock(t, 96); // t=111, strictly past the abandoned t=110 deadline
    ok(
      container.textContent?.includes("two") && !container.textContent?.includes("three"),
      "the cancelled typing-done timer must not skip line two",
    );

    // Line two's own auto-continue still fires at its own deadline (t=115).
    // The view that continue pulls in flushes at the act boundary, so one
    // more tick act walks line three's typing chain before asserting.
    await tickClock(t, 10); // t=121: past line two's scheduled continue
    await tickClock(t, 7); // line three types out (chars from t=122)
    ok(
      container.textContent?.includes("three"),
      `expected line two's own auto-continue to fire, got: ${container.textContent}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
