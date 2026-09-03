import { test } from "node:test";
import { ok, deepEqual } from "node:assert";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseYarn } from "../parse/parser.js";
import { compileOk } from "./compileOk.js";
import { DialogueView } from "../react/DialogueView.js";
import { DialogueExample } from "../react/DialogueExample.js";
import { Dialogue } from "../runtime/dialogue.js";

test("DialogueView renders initial variables provided via props", () => {
  const yarn = `
title: Start
---
Narrator: Hello {$playerName}!
===`;

  const program = compileOk(yarn, {
    declarations: { variables: { playerName: { type: "string" } } },
  });

  const html = renderToStaticMarkup(
    <DialogueView program={program} startAt="Start" variables={{ playerName: "V" }} />
  );

  ok(
    html.includes("Hello V"),
    "Expected rendered dialogue to include the interpolated variable value from props"
  );
});

test("DialogueView keeps scene visible during command results", () => {
  const yarn = `
title: Run
scene: street
---
<<set $score = 5>>
Narrator: Done
===`;

  const program = compileOk(yarn);
  const scenes = {
    scenes: {
      street: {
        background: "bg.png",
        actors: {},
      },
    },
  };

  const html = renderToStaticMarkup(
    <DialogueView program={program} startAt="Run" scenes={scenes} variables={{}} />
  );

  ok(
    html.includes("yd-scene"),
    "Expected DialogueScene container even when the first result is a command"
  );
});

test("DialogueExample (the browser demo) renders its opening line", () => {
  // The demo component compiles its own yarn and renders the first view
  // state during SSR — the package-level "demo green" harness (ticket 52).
  const html = renderToStaticMarkup(<DialogueExample />);

  ok(html.includes("Welcome to"), "Expected the demo's opening line to render");
  ok(html.includes("Narrator"), "Expected the opening line's speaker to render");
  ok(html.includes("yd-scene"), "Expected the demo's scene: header to reach the scene view");
});

test("DialogueView renders a node-group program through the adapter", () => {
  // The adapter works over node groups unchanged: the runtime picks a
  // member by saliency and the view shows the selected member's line.
  const yarn = `
title: Start
---
<<jump Tavern>>
===
title: Tavern
subtitle: quiet
when: always
---
Innkeep: The fire's warm. Sit.
===
title: Tavern
subtitle: tale
when: once
---
Innkeep: A tale for the road, then — once only.
===`;

  const program = compileOk(yarn);
  const html = renderToStaticMarkup(<DialogueView program={program} startAt="Start" />);

  // Default saliency (random best-least-recent) deterministically picks the
  // sole most-complex member (`once`, complexity 1) on a fresh dialogue.
  ok(
    html.includes("A tale for the road"),
    "Expected the saliency-selected node-group member's line to render"
  );
});

// The storylet demo's content (mirrored in examples/browser/StoryletsDemo.tsx):
// a node group whose members gate on `when:` conditions of varying complexity,
// drawn repeatedly under switchable saliency strategies.
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

/** One storylet draw: enter the node group and collect the member's lines. */
function drawStorylet(dialogue: Dialogue): string[] {
  dialogue.setNode("Storylets");
  const lines: string[] = [];
  for (;;) {
    const batch = dialogue.continue();
    if (batch.length === 0) break;
    for (const event of batch) {
      if (event.type === "line") lines.push(event.text);
      if (event.type === "dialogueComplete") return lines;
    }
    if (!dialogue.isActive) break;
  }
  return lines;
}

test("storylet demo: saliency strategies switch mid-story and steer the draws", () => {
  const program = compileOk(STORYLET_YARN);
  const dialogue = new Dialogue(program, { startAt: "Start" });

  // The query APIs the demo panel shows: every member with its complexity
  // score (always=0, once=+1, expression = boolean operators + 1).
  const options = dialogue.getSaliencyOptionsForNodeGroup("Storylets");
  deepEqual(
    options.map((o) => [o.contentId, o.complexityScore]),
    [
      ["Storylets.crossroads", 0],
      ["Storylets.rumor", 1],
      ["Storylets.first-meeting", 1],
      ["Storylets.rogue", 1],
      ["Storylets.duel", 2],
      ["Storylets.heist", 2],
    ],
  );

  ok(
    !dialogue.setSaliencyStrategy("no-such-strategy"),
    "An unknown mode must be rejected, leaving the strategy unchanged",
  );
  ok(dialogue.setSaliencyStrategy("best_least_recent"));

  // Best least-recently-seen walks the story open deterministically:
  // rumor → first-meeting (unlocks $metRogue) → duel (unlocks $trustHigh)
  // → heist — each draw the least-seen, most-complex available member.
  deepEqual(drawStorylet(dialogue), ["Travellers whisper of a Rogue who works the far road."]);
  deepEqual(drawStorylet(dialogue), [
    "Well met. You don't look like the usual pilgrims.",
    "You've met the Rogue. New roads just opened up.",
  ]);
  deepEqual(drawStorylet(dialogue), [
    "Prove your steel — once, and only once.",
    "Blades are crossed. Trust, somehow, was earned.",
  ]);
  deepEqual(drawStorylet(dialogue), [
    "One last job. The vault under the chapel. Are you in?",
    "The heist went off without a hitch. Trust does that.",
  ]);

  // Switching to `best` mid-history ignores view counts: heist is still the
  // most complex available member (the two `once` members are spent).
  ok(dialogue.setSaliencyStrategy("best"));
  deepEqual(drawStorylet(dialogue), [
    "One last job. The vault under the chapel. Are you in?",
    "The heist went off without a hitch. Trust does that.",
  ]);

  // On a fresh dialogue, `first` takes the first written member, `best` the
  // highest-complexity one (rumor and first-meeting tie at 1; rumor first).
  const fresh = new Dialogue(program, { startAt: "Start" });
  ok(fresh.setSaliencyStrategy("first"));
  deepEqual(drawStorylet(fresh), [
    "Quiet at the crossroads. Another traveller, another tale.",
  ]);
  const freshBest = new Dialogue(program, { startAt: "Start" });
  ok(freshBest.setSaliencyStrategy("best"));
  deepEqual(drawStorylet(freshBest), [
    "Travellers whisper of a Rogue who works the far road.",
  ]);

  // The generated saliency history lives in the variable storage (coding
  // standards §4): a fresh dialogue's view counts reset with it.
  deepEqual(
    fresh.getVariables(),
    { metRogue: false, trustHigh: false },
    "Generated variables (view counts, once-state) must not surface as story variables",
  );
});
