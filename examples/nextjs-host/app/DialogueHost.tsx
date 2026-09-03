"use client";

import { useCallback, useRef, useState } from "react";
import { Dialogue, noOptionSelected } from "yarn-spinner-runner-ts";
import type { DialogueEvent, DialogueOption, Program } from "yarn-spinner-runner-ts";

/**
 * The Next.js host's client component (yarn-project-support ticket 04):
 * `Dialogue`'s pull-based continue loop runs natively in a client component.
 * The only prop is the compiled program — the serializable artifact (ADR
 * 0001) the server component handed across the React Server Component
 * boundary. This module imports the package's main entry, which is
 * browser-safe by construction (coding standard §2): no Node APIs in the
 * client path; file access lives entirely in the server component's loader
 * call.
 *
 * Variable-storage reset: every variable — story variables, once-state,
 * visit counts — lives in the Dialogue's storage (coding standard §4), so
 * Reset discards the instance and the next dialogue is born fresh: the
 * `<<declare>>` seeds reapply and the story replays from the top.
 */

export interface DialogueHostProps {
  /** The compiled program from the server-side `loadProject()` call. */
  program: Program;
  projectName?: string;
  /** The source files the loader resolved — surfaced like `listSources()`. */
  sources: string[];
  /** Loader diagnostics (warnings ride along; errors never reach here). */
  diagnostics: string[];
}

interface DeliveredLine {
  speaker?: string;
  text: string;
}

/** The transcript: one pull of the continue loop merged into the last. */
interface Transcript {
  lines: DeliveredLine[];
  /** The pending option set, when the last stopping point was an option set. */
  options: DialogueOption[] | null;
  ended: boolean;
}

const EMPTY_TRANSCRIPT: Transcript = { lines: [], options: null, ended: false };

/** Pull one `continue()` batch from `dialogue` and merge it into `prior`. */
function pump(dialogue: Dialogue, prior: Transcript): Transcript {
  const batch: DialogueEvent[] = dialogue.continue();
  const lines = [...prior.lines];
  let options = prior.options;
  let ended = prior.ended;
  for (const event of batch) {
    if (event.type === "line") {
      lines.push({ speaker: event.speaker, text: event.text });
    } else if (event.type === "options") {
      options = event.options;
    } else if (event.type === "dialogueComplete") {
      ended = true;
    }
  }
  return { lines, options, ended };
}

export default function DialogueHost({
  program,
  projectName,
  sources,
  diagnostics,
}: DialogueHostProps) {
  const dialogueRef = useRef<Dialogue | null>(null);

  // The first pull runs during the initial render — on the server too — so
  // the opening line is in the SSR output (the ticket-52 demo-harness shape).
  const [transcript, setTranscript] = useState<Transcript>(() => {
    const d = new Dialogue(program);
    dialogueRef.current = d;
    return pump(d, EMPTY_TRANSCRIPT);
  });
  const [variables, setVariables] = useState<Record<string, unknown>>({});

  const syncVariables = useCallback((d: Dialogue) => {
    setVariables({ ...d.getVariables() });
  }, []);

  /** One pull of the loop: deliver the next batch (line, options, or end). */
  const onContinue = useCallback(() => {
    const d = dialogueRef.current;
    if (!d || transcript.ended || transcript.options !== null) return;
    setTranscript((t) => pump(d, t));
    syncVariables(d);
  }, [transcript.ended, transcript.options, syncVariables]);

  /** Resume a delivered option set: select, then pull through its body. */
  const onOption = useCallback(
    (index: number) => {
      const d = dialogueRef.current;
      if (!d) return;
      d.selectOption(index);
      setTranscript((t) => pump(d, { ...t, options: null }));
      syncVariables(d);
    },
    [syncVariables],
  );

  /** Variable-storage reset (coding standards §4): a fresh Dialogue is a
   *  fresh storage — declares reseed, once-state and visit counts clear. */
  const onReset = useCallback(() => {
    const d = new Dialogue(program);
    dialogueRef.current = d;
    setTranscript(pump(d, EMPTY_TRANSCRIPT));
    syncVariables(d);
  }, [program, syncVariables]);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px 60px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>
          {projectName ?? "Yarn project"} <span style={{ color: "#9aa0b5", fontWeight: 400 }}>— Next.js host</span>
        </h1>
        <p style={{ color: "#9aa0b5", fontSize: 13, margin: 0 }}>
          Loaded server-side via <code style={codeStyle}>loadProject()</code> ({sources.length} source
          {sources.length === 1 ? "" : "s"}: {sources.join(", ")}); the compiled program crossed the
          RSC boundary as a plain serializable object.
        </p>
        {diagnostics.length > 0 && (
          <p style={{ color: "#e0b050", fontSize: 13, margin: "6px 0 0" }}>
            Loader diagnostics: {diagnostics.join(" · ")}
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
          disabled={transcript.ended || transcript.options !== null}
          style={{ ...buttonStyle, backgroundColor: "#2e7d4f", borderColor: "#2e7d4f", padding: "10px 18px" }}
        >
          Continue
        </button>
        <button type="button" onClick={onReset} style={buttonStyle}>
          Reset (variable-storage reset)
        </button>
        <span style={{ color: "#9aa0b5", fontSize: 13 }} aria-live="polite">
          {transcript.ended ? "Dialogue complete — Reset replays from the top." : ""}
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
