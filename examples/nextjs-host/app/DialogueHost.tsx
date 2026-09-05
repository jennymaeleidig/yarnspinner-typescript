// SPDX-License-Identifier: CC0-1.0
"use client";

import { useRef, useState } from "react";
import {
  Dialogue,
  EMPTY_TRANSCRIPT,
  noOptionSelected,
  runUntilStopped,
} from "yarnspinner-typescript";
import type { Diagnostic, Program, Transcript } from "yarnspinner-typescript";

/**
 * The Next.js host's client component — the vanilla runtime in plain React
 * state: construct `Dialogue`, read `Transcript`, act on input, repeat.
 * The server component hands over the compiled program (the serializable
 * artifact, ADR 0001) plus loader context; this module imports only the
 * package's browser-safe main entry (coding standard §2).
 *
 * The first pull runs synchronously during render, so the opening line is
 * in the SSR markup with no effects or hydration. Manual input only:
 * Continue / option buttons each pull one stopping point; Reset discards
 * the Dialogue — a fresh instance is fresh variable storage, so the story
 * replays from the top (coding standard §4).
 */

export interface DialogueHostProps {
  /** The compiled program from the server-side `loadYarnProject()` call. */
  program: Program;
  projectName?: string;
  /** The source files the loader resolved. */
  sources: string[];
  /** Structured loader diagnostics (warnings ride along; errors never reach here). */
  diagnostics: Diagnostic[];
}

export default function DialogueHost({
  program,
  projectName,
  sources,
  diagnostics,
}: DialogueHostProps) {
  // The Dialogue instance and its transcript are imperative state held in
  // refs; React state only counts versions to re-render. Mutations stay in
  // event handlers, never in state updaters — StrictMode double-invokes
  // those, which would double-pull the shared Dialogue.
  const dialogueRef = useRef<Dialogue | null>(null);
  const transcriptRef = useRef<Transcript>(EMPTY_TRANSCRIPT);
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  // Render-time initial pull: create the Dialogue and pull its first batch
  // synchronously, so the opening line is in the SSR markup. Idempotent per
  // mount — StrictMode's double render hits the closed ref guard.
  if (dialogueRef.current === null) {
    const d = new Dialogue(program);
    dialogueRef.current = d;
    transcriptRef.current = runUntilStopped(d).transcript;
  }

  // One pull of the loop: deliver the next stopping point's events. The
  // module's at-rest guards (pending selection, complete) make this a no-op
  // when the dialogue has nothing to deliver.
  function onContinue(): void {
    const d = dialogueRef.current;
    if (!d) return;
    transcriptRef.current = runUntilStopped(
      d,
      transcriptRef.current,
    ).transcript;
    rerender();
  }

  // Resume a delivered option set: select, then pull through its body — the
  // resolved set leaves the transcript (module contract).
  function onOption(index: number): void {
    const d = dialogueRef.current;
    if (!d) return;
    d.selectOption(index);
    transcriptRef.current = runUntilStopped(
      d,
      transcriptRef.current,
    ).transcript;
    rerender();
  }

  // Variable-storage reset (coding standards §4): a fresh Dialogue is a
  // fresh storage — declares reseed, once-state and visit counts clear.
  function onReset(): void {
    const d = new Dialogue(program);
    dialogueRef.current = d;
    transcriptRef.current = runUntilStopped(d).transcript;
    rerender();
  }

  const dialogue = dialogueRef.current;
  const transcript = transcriptRef.current;
  const ended = dialogue?.isComplete ?? false;
  const awaitingSelection = dialogue?.isWaitingForOptionSelection ?? false;
  const muted = { color: "#9aa0b5" } as const;

  return (
    <main
      style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 60px" }}
    >
      <p style={{ ...muted, fontSize: 13 }}>
        {projectName ?? "Yarn project"} — Next.js host. Loaded server-side via{" "}
        <code>loadYarnProject()</code> ({sources.join(", ")}); the compiled
        program crossed the RSC boundary as a plain serializable object.
      </p>
      {diagnostics.length > 0 && (
        <p style={{ ...muted, fontSize: 13 }}>
          Loader diagnostics:{" "}
          {diagnostics.map((d) => `${d.code}: ${d.message}`).join(" · ")}
        </p>
      )}

      <div
        aria-live="polite"
        style={{ display: "grid", gap: 10, margin: "20px 0" }}
      >
        {transcript.lines.map((line, i) => (
          <p key={i} style={{ margin: 0 }}>
            {line.speaker && <strong>{line.speaker}: </strong>}
            <span>{line.text}</span>
          </p>
        ))}
        {transcript.commands.map((command, i) => (
          <p key={`c${i}`} style={{ ...muted, margin: 0 }}>
            [{command}]
          </p>
        ))}
      </div>

      {transcript.options !== null ? (
        <div
          role="group"
          aria-label="Dialogue options"
          style={{ display: "grid", gap: 8 }}
        >
          {transcript.options.map((option) => (
            <button
              key={option.index}
              type="button"
              onClick={() => onOption(option.index)}
            >
              {option.text}
            </button>
          ))}
          <button type="button" onClick={() => onOption(noOptionSelected)}>
            Choose none
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onContinue}
            disabled={ended || awaitingSelection}
          >
            Continue
          </button>
          <button type="button" onClick={onReset}>
            Reset
          </button>
        </div>
      )}

      {ended && (
        <p style={muted}>Dialogue complete — Reset replays from the top.</p>
      )}
    </main>
  );
}
