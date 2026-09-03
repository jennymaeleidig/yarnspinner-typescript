import React, { useState, useMemo } from "react";
import { parseYarn } from "../parse/parser.js";
import { compileDocument } from "../compile/compiler.js";
import { programLanguageVersion } from "../compile/program.js";
import { DialogueView } from "./DialogueView.js";
import { parseScenes } from "../scene/parser.js";
import type { SceneCollection } from "../scene/types.js";

const DEFAULT_YARN = `title: Start
scene: scene1
---
<< declare $hasBadge = false >>
Narrator: Welcome to [b]yarn-spinner-ts[/b], {$playerName}!
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

const DEFAULT_SCENES = `
scenes:
    scene1: https://i.pinimg.com/1200x/73/f6/86/73f686e3c62e5982055ce34ed5c331b9.jpg
  
actors:
    user: https://i.pinimg.com/1200x/d3/ed/cd/d3edcd8574301cf78f5e93ecca57e18b.jpg
    Narrator: https://i.pinimg.com/1200x/ad/8d/f4/ad8df4186827c20ba5bdb98883e12262.jpg
    npc: https://i.pinimg.com/1200x/81/12/1c/81121c69ef3e5bf657a7bacd9ff9d08e.jpg
`;

export function DialogueExample() {
  const [yarnText] = useState(DEFAULT_YARN);
  const [error, setError] = useState<string | null>(null);
  const enableTypingAnimation = false;
  
  const scenes: SceneCollection = useMemo(() => {
    try {
      return parseScenes(DEFAULT_SCENES);
    } catch (e) {
      console.warn("Failed to parse scenes:", e);
      return { scenes: {} };
    }
  }, []);

  const program = useMemo(() => {
    try {
      setError(null);
      const ast = parseYarn(yarnText);
      return compileDocument(ast);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [yarnText]);

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
        <h1 style={{ color: "#ffffff", textAlign: "center", marginBottom: "30px" }}>yarn-spinner-ts Dialogue Demo</h1>

        {error && (
          <div
            style={{
              backgroundColor: "#ff4444",
              color: "#ffffff",
              padding: "16px",
              borderRadius: "8px",
              marginBottom: "20px",
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        <DialogueView 
          program={program || { languageVersion: programLanguageVersion, nodes: {}, enums: {}, initialValues: {}, smartVariables: {} }}
          startNode="Start"
          scenes={scenes}
          variables={{ playerName: "V", reputation: 3 }}
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
      </div>
    </div>
  );
}

