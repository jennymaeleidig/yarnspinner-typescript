import React, { useCallback, useEffect, useRef, useState } from "react";
import { parseYarn } from "../../src/parse/parser.js";
import { compileDocument } from "../../src/compile/compiler.js";
import { Dialogue } from "../../src/runtime/dialogue.js";
import { runUntilComplete } from "../../src/runtime/transcript.js";
import type { TranscriptLine } from "../../src/runtime/transcript.js";
import type { ContentSaliencyOption } from "../../src/runtime/saliency.js";

/**
 * The storylet demo (ticket 52): a node group whose members gate on `when:`
 * conditions of varying complexity, drawn repeatedly under switchable
 * saliency strategies. Exercises the runtime's saliency surface directly —
 * `setSaliencyStrategy`, `getSaliencyOptionsForNodeGroup`, `getVariables` —
 * through the public `Dialogue` API (the React adapter is migration-only and
 * intentionally carries no saliency features).
 *
 * The yarn below is mirrored in `src/tests/dialogue_view.test.tsx`, which
 * pins this exact story's draw sequence per strategy.
 */

const STORYLET_YARN = `title: Start
---
<<declare $metRogue = false>>
<<declare $trustHigh = false>>
===

title: Storylets
subtitle: crossroads
when: always
---
Narrator: Quiet at the crossroads. Another traveller, another tale.
===

title: Storylets
subtitle: rumor
when: not $metRogue
---
Narrator: Travellers whisper of a Rogue who works the far road.
===

title: Storylets
subtitle: first-meeting
when: once
---
Rogue: Well met. You don't look like the usual pilgrims.
<<set $metRogue = true>>
Narrator: You've met the Rogue. New roads just opened up.
===

title: Storylets
subtitle: rogue
when: $metRogue
---
Rogue: Back again? The road keeps throwing us together.
===

title: Storylets
subtitle: duel
when: once if $metRogue
---
Rogue: Prove your steel — once, and only once.
<<set $trustHigh = true>>
Narrator: Blades are crossed. Trust, somehow, was earned.
===

title: Storylets
subtitle: heist
when: $metRogue and $trustHigh
---
Rogue: One last job. The vault under the chapel. Are you in?
Narrator: The heist went off without a hitch. Trust does that.
===`;

/**
 * The built-in saliency strategies (upstream `<<set_saliency>>` vocabulary).
 * Each mode resolves to the matching upstream-semantics strategy; the
 * runtime's default is `random_best_least_recent`.
 */
const STRATEGIES: { mode: string; label: string; blurb: string }[] = [
  {
    mode: "first",
    label: "First",
    blurb: "Upstream FirstSaliencyStrategy — always the first written member whose conditions pass.",
  },
  {
    mode: "random",
    label: "Random",
    blurb: "Upstream <<set_saliency random>> — random among the least-seen, most complex members.",
  },
  {
    mode: "best",
    label: "Best",
    blurb: "Upstream BestSaliencyStrategy — the most complex available member, ignoring view counts.",
  },
  {
    mode: "best_least_recent",
    label: "Best least-recent",
    blurb: "Upstream BestLeastRecentlyViewedSaliencyStrategy — most complex of the least-seen, first of ties.",
  },
  {
    mode: "random_best_least_recent",
    label: "Random best least-recent",
    blurb: "The runtime default — random pick among the least-seen, most complex members.",
  },
];

interface DrawView {
  lines: TranscriptLine[];
  /** First line of the draw, for the history strip. */
  label: string;
}

export function StoryletsDemo() {
  const dialogueRef = useRef<Dialogue | null>(null);
  const [strategy, setStrategy] = useState("random_best_least_recent");
  const [draw, setDraw] = useState<DrawView | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [saliencyOptions, setSaliencyOptions] = useState<ContentSaliencyOption[]>([]);
  const [storyVariables, setStoryVariables] = useState<Record<string, unknown>>({});
  const [ended, setEnded] = useState(false);

  const program = useRef(compileDocument(parseYarn(STORYLET_YARN))).current;

  const getDialogue = useCallback((): Dialogue => {
    if (dialogueRef.current === null) {
      // The storage-backed saliency history (view counts, once-state) is
      // born and dies with this instance — Reset proves it (coding
      // standards §4).
      dialogueRef.current = new Dialogue(program, { startAt: "Start" });
      dialogueRef.current.setSaliencyStrategy(strategy);
    }
    return dialogueRef.current;
  }, [program, strategy]);

  const refreshPanel = useCallback((dialogue: Dialogue) => {
    setSaliencyOptions(dialogue.getSaliencyOptionsForNodeGroup("Storylets"));
    setStoryVariables({ ...dialogue.getVariables() });
    setEnded(!dialogue.hasSalientContent("Storylets"));
  }, []);

  // Initial panel fill happens after commit (never setState during render);
  // it also re-fills whenever the strategy changes, since getDialogue's
  // identity tracks it.
  useEffect(() => {
    refreshPanel(getDialogue());
  }, [getDialogue, refreshPanel]);

  const drawStorylet = useCallback(() => {
    const dialogue = getDialogue();
    dialogue.setNode("Storylets");
    // Drain the draw to its terminal stopping point (storylets deliver
    // lines only). The module owns the stopping contract — an awaiting
    // option set or a completed dialogue can never be mistaken for an
    // over-drain here.
    const { transcript } = runUntilComplete(dialogue);
    const lines = transcript.lines;
    if (lines.length > 0) {
      setDraw({ lines, label: lines[0].text });
      setHistory((prev) => [...prev.slice(-7), lines[0].text]);
    } else {
      setDraw(null);
    }
    refreshPanel(dialogue);
  }, [getDialogue, refreshPanel]);

  const switchStrategy = useCallback(
    (mode: string) => {
      setStrategy(mode);
      const dialogue = dialogueRef.current;
      if (!dialogue) return;
      // Takes effect at the next node-group entry; the view-count history
      // (in variable storage) carries across the switch.
      dialogue.setSaliencyStrategy(mode);
      refreshPanel(dialogue);
    },
    [refreshPanel],
  );

  const reset = useCallback(() => {
    dialogueRef.current = null;
    setDraw(null);
    setHistory([]);
    refreshPanel(getDialogue());
  }, [getDialogue, refreshPanel]);

  const activeBlurb = STRATEGIES.find((s) => s.mode === strategy)?.blurb ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40 }}>
      <p style={{ color: "#c2c5d4", lineHeight: 1.5, margin: 0 }}>
        Six storylets — one node group, each member gated by a{" "}
        <code style={codeStyle}>when:</code> header. Complexity:{" "}
        <code style={codeStyle}>always</code> = 0, <code style={codeStyle}>once</code> = +1, an
        expression = its boolean-operator count + 1. Draw repeatedly, switch strategies
        mid-story, and watch the selection policy steer which storylet the world picks.
      </p>

      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Saliency strategy</legend>
        <div role="group" aria-label="Saliency strategy" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {STRATEGIES.map((s) => (
            <button
              key={s.mode}
              type="button"
              aria-pressed={strategy === s.mode}
              onClick={() => switchStrategy(s.mode)}
              style={
                strategy === s.mode
                  ? { ...buttonStyle, backgroundColor: "#4f7cff", borderColor: "#4f7cff" }
                  : buttonStyle
              }
            >
              {s.label}
            </button>
          ))}
        </div>
        <p style={{ color: "#9aa0b5", fontSize: 13, margin: "8px 0 0" }}>{activeBlurb}</p>
      </fieldset>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={drawStorylet}
          disabled={ended}
          style={{ ...buttonStyle, backgroundColor: "#2e7d4f", borderColor: "#2e7d4f", padding: "10px 18px" }}
        >
          Draw a storylet
        </button>
        <button type="button" onClick={reset} style={buttonStyle}>
          Reset
        </button>
        <span style={{ color: "#9aa0b5", fontSize: 13 }} aria-live="polite">
          {ended ? "No salient content — every member's conditions fail." : ""}
        </span>
      </div>

      <div aria-live="polite">
        {draw ? (
          <div style={cardStyle}>
            {draw.lines.map((line, i) => (
              <p key={i} style={{ margin: i === 0 ? 0 : "8px 0 0" }}>
                {line.speaker && (
                  <strong style={{ color: "#8fb3ff", marginRight: 8 }}>{line.speaker}</strong>
                )}
                <span style={{ color: "#e8eaf2" }}>{line.text}</span>
              </p>
            ))}
          </div>
        ) : (
          <div style={{ ...cardStyle, color: "#9aa0b5" }}>Draw to see which storylet runs.</div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <h2 style={headingStyle}>Draw history</h2>
          <ol style={{ margin: 0, paddingLeft: 20, color: "#c2c5d4", fontSize: 13, lineHeight: 1.7 }}>
            {history.map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <h2 style={headingStyle}>Story state</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(storyVariables).length === 0 ? (
            <span style={{ color: "#9aa0b5", fontSize: 13 }}>No story variables yet.</span>
          ) : (
            Object.entries(storyVariables).map(([name, value]) => (
              <span key={name} style={chipStyle}>
                <code style={codeStyle}>${name}</code> = {String(value)}
              </span>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 style={headingStyle}>
          Saliency options <span style={{ color: "#9aa0b5", fontWeight: 400 }}>(getSaliencyOptionsForNodeGroup)</span>
        </h2>
        <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640 }}>
          <thead>
            <tr>
              {["Member (contentId)", "Complexity", "Conditions passing", "Conditions failing"].map((h) => (
                <th key={h} scope="col" style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {saliencyOptions.map((o) => (
              <tr key={o.contentId}>
                <td style={{ ...tdStyle, fontFamily: "monospace" }}>
                  {o.contentId.replace(/^Storylets\./, "")}
                </td>
                <td style={tdStyle}>{o.complexityScore}</td>
                <td style={{ ...tdStyle, color: "#7fc98f" }}>{o.passingConditionValueCount}</td>
                <td style={{ ...tdStyle, color: o.failingConditionValueCount > 0 ? "#e07f7f" : "#9aa0b5" }}>
                  {o.failingConditionValueCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
  padding: "16px 20px",
  fontSize: 16,
  lineHeight: 1.5,
};

const fieldsetStyle: React.CSSProperties = {
  border: "1px solid #43475c",
  borderRadius: 8,
  padding: "12px 16px 14px",
  margin: 0,
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

const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "#9aa0b5",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: "1px solid #43475c",
  padding: "6px 10px",
};

const tdStyle: React.CSSProperties = {
  color: "#e8eaf2",
  fontSize: 14,
  borderBottom: "1px solid #2a2d3e",
  padding: "6px 10px",
};
