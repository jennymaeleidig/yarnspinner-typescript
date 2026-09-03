import { test } from "node:test";
import { strictEqual, ok, deepEqual } from "node:assert";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
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
// (`createRoot` + `act`): effects and timers included.

let clientDomReady = false;
function setupClientDom(): void {
  if (clientDomReady) return;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, // supplies requestAnimationFrame for TypingText
    url: "http://localhost/",
  });
  const win = dom.window as unknown as Record<string, unknown>;
  // Copy the DOM surface onto Node's globals; names Node already owns
  // (Object, console, …) are skipped, so only DOM-specific ones land.
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!(key in globalThis)) {
      try {
        (globalThis as Record<string, unknown>)[key] = win[key];
      } catch {
        // read-only Node global; handled explicitly below where it matters
      }
    }
  }
  // Node ≥21 ships a read-only global `navigator`; replace it wholesale —
  // React only reads a userAgent-ish surface from it.
  Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clientDomReady = true;
}

const COMPLETE_YARN = `title: Start
---
<<set $gold = 3>>
Mae: only
===
`;

const TWO_LINE_YARN = `title: Start
---
Mae: one
Mae: two
===
`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("onStoryEnd (deprecated): fires only when onDialogueComplete is absent, with its original payload", async () => {
  setupClientDom();
  const program = compileDocument(parseYarn(COMPLETE_YARN));
  const storyEnds: StoryEndInfo[] = [];
  const capture: { hook: UseDialogueResult | null } = { hook: null };
  function Probe() {
    capture.hook = useDialogue(program, { onStoryEnd: (info) => storyEnds.push(info) });
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
    capture.hook = useDialogue(program, {
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

test("DialogueView typing-flow aliases: autoAdvanceAfterTyping + autoAdvanceDelay drive the auto-continue", async () => {
  setupClientDom();
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
          typingSpeed: 0, // rAF-driven typing; jsdom's pretendToBeVisual supplies the frames
          // Both deprecated aliases must fold into their new names: the flag
          // enables auto-continue, and the 5ms delay must be used in place of
          // the 500ms default (this test's 150ms budget fails at 500ms).
          autoAdvanceAfterTyping: true,
          autoAdvanceDelay: 5,
        }),
      );
    });
    ok(container.textContent?.includes("Mae"), "the opening line rendered");

    // The deprecated aliases fold in: after the rAF-driven typing completes,
    // the 5ms alias delay — not the 500ms default — precedes line two. Poll
    // rather than sample a fixed instant (typing re-starts per line), and
    // budget 400ms: if the delay alias were ignored, the 500ms default alone
    // would push line two past this deadline and fail the pin.
    const deadline = Date.now() + 400;
    let reachedLineTwo = false;
    while (Date.now() < deadline) {
      await act(async () => {
        await sleep(20);
      });
      if (container.textContent?.includes("two")) {
        reachedLineTwo = true;
        break;
      }
    }
    ok(
      reachedLineTwo,
      `expected the alias-driven auto-continue to reach line two within 400ms, got: ${container.textContent}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test("DialogueView typing-flow aliases: pauseBeforeAdvance pauses a click before continuing", async () => {
  setupClientDom();
  const program = compileDocument(parseYarn(TWO_LINE_YARN));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(DialogueView, { program, pauseBeforeAdvance: 25 }));
    });
    ok(container.textContent?.includes("one"), "the first line rendered");

    // A click defers the continue by the alias's pause (25ms): shortly after
    // the click the view still shows line one...
    const box = container.querySelector(".yd-dialogue-box");
    ok(box, "the clickable dialogue box rendered");
    await act(async () => {
      box!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(5);
    });
    ok(!container.textContent?.includes("two"), "the click must not advance synchronously");

    // ...and after the pause it has advanced.
    await act(async () => {
      await sleep(60);
    });
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
