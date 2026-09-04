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
   * `NodeStartEvent`, deepening-wave ticket 07) — the scene name's one
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
  if (dialogue.isWaitingForOptionSelection) {
    return { transcript: prior, stopped: "options" };
  }
  if (dialogue.isComplete) {
    return { transcript: prior, stopped: "complete" };
  }
  let transcript = prior.options !== null ? { ...prior, options: null } : prior;
  for (;;) {
    const batch = dialogue.continue();
    transcript = mergeBatch(transcript, batch);
    const stopped = stoppingPointOf(batch);
    if (stopped) return { transcript, stopped };
  }
}

/** Merge one delivered batch into `prior` (fresh arrays; `prior` untouched). */
function mergeBatch(prior: Transcript, batch: DialogueEvent[]): Transcript {
  let lines: TranscriptLine[] | null = null;
  let options: DialogueOption[] | null = null;
  let commands: string[] | null = null;
  let scene = prior.scene;
  for (const event of batch) {
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
