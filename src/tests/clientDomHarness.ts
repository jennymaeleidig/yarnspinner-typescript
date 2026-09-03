/**
 * Shared jsdom client-render harness for the React adapter's behavioural
 * tests (ticket 55 introduced it inside the alias suite; the continue
 * scheduler pins need the same effects-and-timers surface).
 *
 * `renderToStaticMarkup` never fires post-commit effects, so anything that
 * renders, schedules, or runs on the client (TypingText, the continue
 * scheduler) is pinned here: a JSDOM window copied onto Node's globals,
 * then `createRoot` + `act` from the test.
 */

import { act } from "react";
import { JSDOM } from "jsdom";
import type { TestContext } from "node:test";

let clientDomReady = false;

export function setupClientDom(): void {
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

/** Advance the fake clock (enabled by the caller via `t.mock.timers`) one
 *  millisecond at a time, inside one act scope. Node's `tick()` does not run
 *  timers scheduled during the same tick, so chained timeouts — TypingText
 *  schedules one `setTimeout` per character — advance exactly one step per
 *  ticked millisecond; ticking in 1ms steps walks the whole chain.
 *  Queued React updates flush once, at the act boundary. */
export function tickClock(t: TestContext, totalMs: number): Promise<void> {
  return act(async () => {
    for (let i = 0; i < totalMs; i++) {
      t.mock.timers.tick(1);
    }
  });
}
