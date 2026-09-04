// SPDX-License-Identifier: CC0-1.0
import React, { useState, useMemo } from "react";
import { compileSource } from "../compile/compileSource.js";
import { DialogueRunner } from "./DialogueRunner.js";
import type { SceneCollection } from "../scene/types.js";

const EMPTY_SCENES: SceneCollection = { scenes: {} };

const DEFAULT_YARN = `title: Start
scene: scene1
---
<< declare $hasBadge = false >>
Narrator: Welcome to [b]yarn-spinner-runner-ts[/b], {$playerName}!
Narrator: Current street cred: {$reputation}
npc: This is a dialogue system powered by Yarn Spinner.
Narrator: Click anywhere to continue, or choose an option below.
-> Start the adventure <<if $hasBadge>>
    Narrator: Great! Let's begin your journey.
    <<jump NextScene>>
-> Learn more
    Narrator: Yarn Spinner is a powerful narrative scripting language.
    npc: It supports variables, conditions, and branching stories.
    <<jump NextScene>>
===

title: NextScene
---
npc: blablabla
Narrator: You've reached the next scene!
Narrator: The dialogue system supports rich features like:
Narrator: • Variables and expressions
Narrator: • Conditional branching
Narrator: • Options with conditions
Narrator: • Commands and functions
Narrator: This is the end of the demo. Refresh to start again!
===`;

// The demo's host-provided variables, declared once: type feeds the
// compile-time `declarations.variables`, value seeds the runtime `variables`
// prop. One source so the two can't drift (YS0029 if a declaration is
// missing; a wrong type silently misbehaves).
const DEMO_VARIABLES = {
  playerName: { type: "string", value: "V" },
  reputation: { type: "number", value: 3 },
} as const;

/**
 * The browser demo's dialogue tab. The scene YAML and its parser live with
 * the demo host (`examples/browser`) — the package ships no YAML scene
 * parser; the parsed `SceneCollection` is host
 * input, like any other prop.
 */
export function DialogueExample({
  scenes = EMPTY_SCENES,
}: {
  /** Pre-parsed scene/actor images; the demo host parses its own YAML. */
  scenes?: SceneCollection;
}) {
  const [yarnText] = useState(DEFAULT_YARN);
  const enableTypingAnimation = false;

  // The compile seam (coding standards §3): problems come back as
  // diagnostics with the result, not as throws. The variables seeded at
  // runtime below are declared externally so type checking can resolve
  // them (YS0029 otherwise).
  const { program, diagnostics } = useMemo(
    () =>
      compileSource(yarnText, {
        declarations: {
          variables: Object.fromEntries(
            Object.entries(DEMO_VARIABLES).map(([name, { type }]) => [name, { type }]),
          ),
        },
      }),
    [yarnText],
  );
  const errors = diagnostics.filter((d) => d.severity === "error");

  const customFunctions = useMemo(() => ({
    greet: () => {console.log('test')},
    double: (num: unknown) => Number(num) * 2
  }), []);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#1a1a2e",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ maxWidth: "1000px", width: "100%" }}>
        <h1 style={{ color: "#ffffff", textAlign: "center", marginBottom: "30px" }}>yarn-spinner-runner-ts Dialogue Demo</h1>

        {errors.map((d) => (
          <div
            key={`${d.code}:${d.range?.startLine ?? 0}:${d.message}`}
            style={{
              backgroundColor: "#ff4444",
              color: "#ffffff",
              padding: "16px",
              borderRadius: "8px",
              marginBottom: "20px",
            }}
          >
            <strong>{d.code}:</strong> {d.message}
          </div>
        ))}

        {program && (
          <DialogueRunner
            program={program}
            startAt="Start"
            scenes={scenes}
            variables={Object.fromEntries(
              Object.entries(DEMO_VARIABLES).map(([name, { value }]) => [name, value]),
            )}
            enableTypingAnimation={enableTypingAnimation}
            showTypingCursor={true}
            typingSpeed={20}
            cursorCharacter="$"
            autoContinueAfterTyping={true}
            autoContinueDelay={2000}
            actorTransitionDuration={1000}
            pauseBeforeContinue={enableTypingAnimation ? 1000 : 0}
            onDialogueComplete={(info) => {
              console.log('Dialogue completed with variables:', info.variables);
            }}
            functions={customFunctions}
          />
        )}
      </div>
    </div>
  );
}

