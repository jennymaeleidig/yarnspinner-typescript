// SPDX-License-Identifier: CC0-1.0
/**
 * The transcript-reduction module (CONTEXT.md "Transcript" / "stopping
 * point"): one home for the stopping-point contract that adapter consumers
 * previously re-derived at every call site.
 *
 * `runUntilStopped` is exported non-upstream orchestration over the pull
 * API (the loader's and React adapter's standing — docs/compatibility.md):
 * upstream has no such accumulator, but the contract it encodes is upstream
 * behaviour, re-delivered — each `continue()` batch pauses at the next
 * stopping point and the consumer resumes (ADR 0002; .NET `Dialogue`
 * handlers / Rust `Dialogue::continue_`). `runUntilComplete` drains through
 * line and command stops to the terminal one (the auto-continue shape).
 * Pinned by `src/tests/transcript.test.ts` against those upstream
 * semantics.
 *
 * The module is a pure pull→transcript function (no I/O, no clocks — coding
 * standards §2): the per-framework seam that *creates* a dialogue and times
 * the first pull (the SSR idiom) stays with the host. It never mutates
 * `prior`; the merge returns fresh arrays so the result can be component
 * state directly.
 */

import { noOptionSelected } from "./events.js";
import type { DialogueEvent, DialogueOption, LineEvent } from "./events.js";
import type { Dialogue } from "./dialogue.js";

/** One delivered line in a transcript — the runtime's `LineEvent` content
 *  (derived, so the two shapes cannot drift). */
export type TranscriptLine = Omit<LineEvent, "type">;

/**
 * The accumulated view of a dialogue run (CONTEXT.md "Transcript"): every
 * delivered line in order, the live option set, and every surfaced command.
 * Hosts adopt this as component state; no per-host reshape layer.
 */
export interface Transcript {
  lines: TranscriptLine[];
  /**
   * The option set awaiting (or most recently delivered for) selection —
   * render it when non-null. A resolved set (a selection or a
   * `noOptionSelected` fall-through) leaves the transcript on the next pull.
   */
  options: DialogueOption[] | null;
  /** Surfaced `<<command>>` texts, in delivery order (state statements never surface). */
  commands: string[];
  /**
   * The `scene:` header of the most recently started node (from its
   * `NodeStartEvent`) — the scene name's one
   * delivery channel, carried forward across scene-less nodes the way the
   * view keeps its last background. Hosts cross-check it against their
   * `SceneCollection` right here, at node start — the one seam where the
   * name and the image collection meet.
   */
  scene?: string;
}

/** The transcript before the first pull — the merge identity. */
const EMPTY_LINES: TranscriptLine[] = Object.freeze([]) as unknown as TranscriptLine[];
const EMPTY_COMMANDS: string[] = Object.freeze([]) as unknown as string[];
export const EMPTY_TRANSCRIPT: Transcript = Object.freeze({
  lines: EMPTY_LINES,
  options: null,
  commands: EMPTY_COMMANDS,
});

/**
 * Where a run stopped (CONTEXT.md "stopping point") — the reason the
 * runtime handed the batch back:
 * - `"line"` — a line was delivered; the consumer shows it and resumes.
 * - `"options"` — an option set awaits selection (`selectOption` resumes it;
 *   the set is on the transcript).
 * - `"command"` — a command was surfaced; resume on the next pull to skip
 *   past it.
 * - `"complete"` — `DialogueComplete` was delivered (or was already — see
 *   the at-rest guards below); nothing further will ever deliver.
 */
export type StoppingPoint = "line" | "options" | "command" | "complete";

/**
 * Pull `dialogue` until the next stopping point, merging every delivered
 * batch into `prior`. Node lifecycle and line-hint events ride through and
 * never stop a pull.
 *
 * The two at-rest states are guarded, so callers need no pre-flight checks:
 * - while an option set is pending, the call is a no-op returning `prior`
 *   with `"options"` — the pending set is already on `prior`, and making
 *   the `continue()` would trip this fork's log-and-empty divergence
 *   (upstream fails loudly: .NET throws `DialogueException`,
 *   `VirtualMachine.cs:537–540`; Rust errs
 *   `virtual_machine.rs:214–224`);
 * - a complete dialogue (`Dialogue.isComplete`) returns `prior` with
 *   `"complete"` — the complete event delivers exactly once.
 *
 * A resolved option set on `prior` leaves the transcript here (see
 * `Transcript.options`): once the dialogue is no longer waiting, the set is
 * settled history, not live UI.
 *
 * The internal loop over lifecycle-only batches cannot run away: the VM's
 * batch contract delivers one stopping point per `continue()`, and both
 * at-rest states are guarded above — an empty batch is unreachable.
 */
export function runUntilStopped(
  dialogue: Dialogue,
  prior: Transcript = EMPTY_TRANSCRIPT,
): { transcript: Transcript; stopped: StoppingPoint } {
  const { events, stopped } = pullUntilStopped(dialogue);
  // At-rest (pending selection or complete): no pull happened — `prior`
  // returns unchanged, the accumulating shape of `{ events: [], stopped }`.
  if (events.length === 0) {
    return { transcript: prior, stopped };
  }
  // A resolved option set leaves the transcript here: once the dialogue is
  // no longer waiting, the set is settled history, not live UI.
  const atRest = prior.options !== null ? { ...prior, options: null } : prior;
  return { transcript: mergeEvents(events, atRest), stopped };
}

/**
 * Merge delivered events into `prior` (fresh arrays; `prior` untouched).
 * The reduction half of the transcript family's interface: `pullUntilStopped`
 * hands back events, this reduces them — a stateless consumer (the React
 * hook reshapes a run's tail) uses the pair; the accumulators use it too.
 * Lifecycle events carry through (`nodeStart`'s scene header lands on the
 * transcript), lines/options/commands accumulate.
 */
export function mergeEvents(events: DialogueEvent[], prior: Transcript = EMPTY_TRANSCRIPT): Transcript {
  let lines: TranscriptLine[] | null = null;
  let options: DialogueOption[] | null = null;
  let commands: string[] | null = null;
  let scene = prior.scene;
  for (const event of events) {
    if (event.type === "line") {
      // TranscriptLine is derived from LineEvent (Omit "type"), so a new
      // required line field fails this literal at compile time.
      (lines ??= [...prior.lines]).push({
        lineId: event.lineId,
        speaker: event.speaker,
        text: event.text,
        tags: event.tags,
        markup: event.markup,
      });
    } else if (event.type === "options") {
      options = event.options;
    } else if (event.type === "command") {
      (commands ??= [...prior.commands]).push(event.command);
    } else if (event.type === "nodeStart") {
      // A scene-less node keeps the prior scene (the view keeps its last
      // background); a header starts a new one.
      scene = event.scene ?? scene;
    }
  }
  if (lines === null && options === null && commands === null && scene === prior.scene) {
    return prior;
  }
  return {
    lines: lines ?? prior.lines,
    options: options ?? prior.options,
    commands: commands ?? prior.commands,
    scene,
  };
}

/** The batch's stopping point, or `null` when only lifecycle events rode. */
function stoppingPointOf(batch: DialogueEvent[]): StoppingPoint | null {
  for (const event of batch) {
    switch (event.type) {
      case "line":
        return "line";
      case "options":
        return "options";
      case "command":
        return "command";
      case "dialogueComplete":
        return "complete";
      default:
        continue; // nodeStart / nodeComplete / lineHints ride through
    }
  }
  return null;
}

/**
 * The family's stateless member: pull `dialogue` until the next stopping
 * point and return the raw events, no accumulation, no `prior`. The
 * stopping-point contract is owned entirely here — a pending option set or
 * a complete dialogue is *data* (`{ events: [], stopped }`), not a contract
 * a caller must pre-empt: a consumer that must distinguish "nothing new"
 * from "a fresh tail" reads `events.length` instead of hand-copying the
 * at-rest guards before calling (the React hook's old shape —
 * CONTEXT.md "stopping point").
 *
 * Lifecycle-only batches accumulate into `events` (a node's scene header
 * can ride a batch of its own) — the run's events arrive in delivery order
 * across all pulls made. The internal loop cannot run away for the same
 * reason `runUntilStopped`'s could not: the VM's batch contract delivers
 * one stopping point per `continue()`.
 */
export function pullUntilStopped(
  dialogue: Dialogue,
): { events: DialogueEvent[]; stopped: StoppingPoint } {
  if (dialogue.isWaitingForOptionSelection) {
    return { events: [], stopped: "options" };
  }
  if (dialogue.isComplete) {
    return { events: [], stopped: "complete" };
  }
  const events: DialogueEvent[] = [];
  for (;;) {
    const batch = dialogue.continue();
    events.push(...batch);
    const stopped = stoppingPointOf(batch);
    if (stopped) return { events, stopped };
  }
}

/**
 * Drain `dialogue` through every stopping point to the terminal one:
 * auto-continue across line and command stops, stop at an option selection
 * (only `selectOption` can cross it — the transcript carries the live set)
 * or at completion. The drain-loop shape hosts and tests previously pasted
 * at every auto-continue site; the returned `stopped` names where it ended.
 */
export function runUntilComplete(
  dialogue: Dialogue,
  prior: Transcript = EMPTY_TRANSCRIPT,
): { transcript: Transcript; stopped: StoppingPoint } {
  let result = runUntilStopped(dialogue, prior);
  while (result.stopped === "line" || result.stopped === "command") {
    result = runUntilStopped(dialogue, result.transcript);
  }
  return result;
}

/**
 * Pull cap for `runUntilCompleteEvents` — far above any legitimate run (the
 * VM delivers one stopping point per `continue()`, so a cap of 1000 pulls
 * means a thousand stopping points); past it, a runaway loop throws instead
 * of silently returning a partial stream (the one stated policy for every
 * caller — the pasted test drains each carried their own, and no two
 * agreed).
 */
const MAX_DRAIN_PULLS = 1_000;

/**
 * Drain `dialogue` to the terminal stopping point and return the raw event
 * stream — the events-shaped convenience over the pull API that scripts and
 * runtime tests want (the transcript reducers keep the accumulator
 * interface; this owns the "pull until quiescent" loop and its guard
 * policy, stated once here).
 *
 * Terminal, in order:
 * - `DialogueComplete` is delivered (the complete event is in the stream);
 * - an option set is delivered and no `selectOption` policy was given —
 *   the set is the stream's last options event and the dialogue stays
 *   pending, exactly as a pull-API consumer would.
 *
 * With a `selectOption` policy, a delivered option set is answered inline
 * (return the index to select, or `noOptionSelected` to fall through) and
 * the drain continues past it. Past `MAX_DRAIN_PULLS` the drain throws —
 * a stalled runtime is a bug to surface, not a partial stream to pin.
 */
export function runUntilCompleteEvents(
  dialogue: Dialogue,
  selectOption?: (options: DialogueOption[]) => number | typeof noOptionSelected,
): DialogueEvent[] {
  const events: DialogueEvent[] = [];
  for (let pulls = 0; ; pulls++) {
    if (pulls === MAX_DRAIN_PULLS) {
      throw new Error(`runUntilCompleteEvents: stalled after ${MAX_DRAIN_PULLS} pulls without reaching a terminal stopping point`);
    }
    const { events: pulled, stopped } = pullUntilStopped(dialogue);
    // An empty pull is exactly the at-rest guard firing: the pending-
    // selection or complete check returned `{ events: [] }` without
    // pulling. It cannot be an empty batch — `pullUntilStopped`'s loop
    // only exits on a stopping point, and a stopping point requires an
    // event.
    if (pulled.length === 0) break;
    events.push(...pulled);
    if (stopped === "options") {
      if (!selectOption) {
        // The set is the stream's last options event; the dialogue stays
        // pending, exactly as a pull-API consumer would.
        break;
      }
      const optionsEvent = pulled.find((event): event is Extract<DialogueEvent, { type: "options" }> => event.type === "options");
      // The stopping point came from this pull's options event — `find` is
      // total here; if it ever isn't, the invariant is broken and a stalled
      // runtime is a bug to surface, not a drain to quietly end.
      if (!optionsEvent) {
        throw new Error("runUntilCompleteEvents: an options stopping point without an options event");
      }
      dialogue.selectOption(selectOption(optionsEvent.options));
    }
    if (stopped === "complete") break;
  }
  return events;
}
