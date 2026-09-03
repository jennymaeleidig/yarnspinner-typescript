"use client";

import { useCallback, useReducer, useRef } from "react";
import { Dialogue, EMPTY_TRANSCRIPT, noOptionSelected, runUntilStopped } from "yarn-spinner-runner-ts";
import type { Diagnostic, Program, Transcript } from "yarn-spinner-runner-ts";

/**
 * The Next.js host's client component (yarn-project-support ticket 04):
 * `Dialogue`'s pull-based continue loop runs natively in a client component.
 * The server component hands over the compiled program — the serializable
 * artifact (ADR 0001) — plus loader context (project name, resolved sources,
 * structured diagnostics). This module imports the package's main entry,
 * which is browser-safe by construction (coding standard §2): no Node APIs
 * in the client path; file access lives entirely in the server component's
 * loader call.
 *
 * Variable-storage reset: every variable — story variables, once-state,
 * visit counts — lives in the Dialogue's storage (coding standard §4), so
 * Reset discards the instance and the next dialogue is born fresh: the
 * `<<declare>>` seeds reapply and the story replays from the top.
 *
 * Render-time adjustment follows the in-package adapter's house pattern
 * (useDialogue): the dialogue is created and its first batch pulled
 * synchronously behind an idempotent ref guard — SSR markup is correct, and
 * StrictMode's double render hits the closed guard on pass two and changes
 * nothing.
 */

export interface DialogueHostProps {
  /** The compiled program from the server-side `loadYarnProject()` call. */
  program: Program;
  projectName?: string;
  /** The source files the loader resolved — surfaced like `listSources()`. */
  sources: string[];
  /** Structured loader diagnostics (warnings ride along; errors never reach here). */
  diagnostics: Diagnostic[];
}

/** The transcript (CONTEXT.md) is the component state: lines accumulate,
 *  the live option set renders when present, commands accumulate. */

export default function DialogueHost({
  program,
  projectName,
  sources,
  diagnostics,
}: DialogueHostProps) {
  const dialogueRef = useRef<Dialogue | null>(null);
  const transcriptRef = useRef<Transcript>(EMPTY_TRANSCRIPT);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // Render-time adjustment (the useDialogue house pattern): create the
  // dialogue and synchronously pull its first transcript — the shared
  // runUntilStopped module, run during render — so the opening line is in
  // the initial markup, on the server too. Idempotent per mount.
  if (dialogueRef.current === null) {
    const d = new Dialogue(program);
    dialogueRef.current = d;
    transcriptRef.current = runUntilStopped(d).transcript;
  }

  /** One pull of the loop: deliver the next stopping point's events. The
   *  module's at-rest guards (pending selection, complete) make this a
   *  no-op when the dialogue has nothing to deliver. */
  const onContinue = useCallback(() => {
    const d = dialogueRef.current;
    if (!d) return;
    transcriptRef.current = runUntilStopped(d, transcriptRef.current).transcript;
    bump();
  }, []);

  /** Resume a delivered option set: select, then pull through its body —
   *  the resolved set leaves the transcript (module contract). */
  const onOption = useCallback((index: number) => {
    const d = dialogueRef.current;
    if (!d) return;
    d.selectOption(index);
    transcriptRef.current = runUntilStopped(d, transcriptRef.current).transcript;
    bump();
  }, []);

  /** Variable-storage reset (coding standards §4): a fresh Dialogue is a
   *  fresh storage — declares reseed, once-state and visit counts clear. */
  const onReset = useCallback(() => {
    const d = new Dialogue(program);
    dialogueRef.current = d;
    transcriptRef.current = runUntilStopped(d).transcript;
    bump();
  }, [program]);

  const transcript = transcriptRef.current;
  const dialogue = dialogueRef.current;
  const ended = dialogue?.isComplete ?? false;
  const awaitingSelection = dialogue?.isWaitingForOptionSelection ?? false;
  const variables = dialogue ? { ...dialogue.getVariables() } : {};

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px 60px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>
          {projectName ?? "Yarn project"}{" "}
          <span style={{ color: "#9aa0b5", fontWeight: 400 }}>— Next.js host</span>
        </h1>
        <p style={{ color: "#9aa0b5", fontSize: 13, margin: 0 }}>
          Loaded server-side via <code style={codeStyle}>loadYarnProject()</code> ({sources.length}{" "}
          source{sources.length === 1 ? "" : "s"}: {sources.join(", ")}); the compiled program
          crossed the RSC boundary as a plain serializable object.
        </p>
        {diagnostics.length > 0 && (
          <p style={{ color: "#e0b050", fontSize: 13, margin: "6px 0 0" }}>
            Loader diagnostics:{" "}
            {diagnostics.map((d, i) => (
              <span key={i}>
                {i > 0 && " · "}
                <code style={codeStyle}>{d.code}</code> {d.message}
              </span>
            ))}
          </p>
        )}
      </header>

      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {transcript.lines.map((line, i) => (
          <p key={i} style={cardStyle}>
            {line.speaker && <strong style={{ color: "#8fb3ff", marginRight: 8 }}>{line.speaker}</strong>}
            <span>{line.text}</span>
          </p>
        ))}
        {transcript.lines.length === 0 && (
          <p style={{ ...cardStyle, color: "#9aa0b5" }}>Press Continue to begin.</p>
        )}
      </div>

      {transcript.options !== null && (
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Options</legend>
          <div role="group" aria-label="Dialogue options" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {transcript.options.map((option, i) => (
              <button key={i} type="button" onClick={() => onOption(i)} style={buttonStyle}>
                {option.text}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onOption(noOptionSelected)}
              style={{ ...buttonStyle, color: "#9aa0b5" }}
            >
              Choose none (noOptionSelected)
            </button>
          </div>
        </fieldset>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button
          type="button"
          onClick={onContinue}
          disabled={ended || awaitingSelection}
          style={{ ...buttonStyle, backgroundColor: "#2e7d4f", borderColor: "#2e7d4f", padding: "10px 18px" }}
        >
          Continue
        </button>
        <button type="button" onClick={onReset} style={buttonStyle}>
          Reset (variable-storage reset)
        </button>
        <span style={{ color: "#9aa0b5", fontSize: 13 }} aria-live="polite">
          {ended ? "Dialogue complete — Reset replays from the top." : ""}
        </span>
      </div>

      <section style={{ marginTop: 24 }}>
        <h2 style={headingStyle}>Story variables</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.keys(variables).length === 0 ? (
            <span style={{ color: "#9aa0b5", fontSize: 13 }}>
              Continue once to deliver the first batch — variables are seeded by{" "}
              <code style={codeStyle}>{"<<declare>>"}</code>.
            </span>
          ) : (
            Object.entries(variables).map(([name, value]) => (
              <span key={name} style={chipStyle}>
                <code style={codeStyle}>${name}</code> = {String(value)}
              </span>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#2a2d3e",
  color: "#e8eaf2",
  border: "1px solid #43475c",
  borderRadius: 6,
  padding: "8px 14px",
  fontSize: 14,
  cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "#23263a",
  border: "1px solid #43475c",
  borderRadius: 8,
  padding: "14px 18px",
  fontSize: 16,
  lineHeight: 1.5,
  margin: 0,
};

const fieldsetStyle: React.CSSProperties = {
  border: "1px solid #43475c",
  borderRadius: 8,
  padding: "12px 16px 14px",
  marginTop: 14,
};

const legendStyle: React.CSSProperties = {
  color: "#e8eaf2",
  fontSize: 14,
  fontWeight: 600,
  padding: "0 6px",
};

const headingStyle: React.CSSProperties = {
  color: "#e8eaf2",
  fontSize: 15,
  margin: "0 0 8px",
};

const chipStyle: React.CSSProperties = {
  backgroundColor: "#2a2d3e",
  border: "1px solid #43475c",
  borderRadius: 999,
  padding: "4px 12px",
  fontSize: 13,
  color: "#c2c5d4",
};

const codeStyle: React.CSSProperties = {
  backgroundColor: "#1a1d2c",
  borderRadius: 4,
  padding: "1px 5px",
  fontSize: "0.9em",
};
