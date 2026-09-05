// SPDX-License-Identifier: CC0-1.0
/**
 * Saliency machinery: complexity scoring, the four built-in
 * strategies (Random BLRV default), the pluggable two-method strategy
 * interface, `<<set_saliency>>`, line groups (`=>`), and the node-group
 * query APIs — asserted through the public compile → run seam.
 *
 * Upstream references: `Yarn.Saliency` (v3.2.2 — FirstSaliencyStrategy,
 * BestSaliencyStrategy, BestLeastRecentlyViewedSaliencyStrategy,
 * RandomBestLeastRecentlyViewedSaliencyStrategy, ContentSaliencyOption),
 * `NodeGroupCompiler` (complexity scoring), `CodeGenerationVisitor`
 * (line-group lowering), `Dialogue` (`IsNodeGroup`,
 * `GetSaliencyOptionsForNodeGroup`, `HasSalientContent`, `has_any_content`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compileSource,
  Dialogue,
  Library,
  FirstSaliencyStrategy,
  BestSaliencyStrategy,
  BestLeastRecentlyViewedSaliencyStrategy,
  RandomBestLeastRecentlyViewedSaliencyStrategy,
  saliencyStrategyForMode,
  SALIENCY_MODES,
  booleanOperatorCount,
  type ContentSaliencyOption,
  type ContentSaliencyStrategy,
  type SaliencyState,
  type DialogueEvent,
} from "../index.js";
import { runUntilCompleteEvents } from "../index.js";

/** Compile a source, asserting it compiles clean. */
function compile(source: string) {
  const { program, diagnostics } = compileSource(source);
  assert.ok(program, `compilation failed: ${diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`);
  return program;
}

/** Run a dialogue to completion, returning each run's composed line texts. */
function runLines(
  source: string,
  runs: number,
  configure?: (d: Dialogue) => void,
  startAt?: string,
): string[][] {
  const dialogue = new Dialogue(compile(source), startAt ? { startAt } : undefined);
  configure?.(dialogue);
  const result: string[][] = [];
  for (let i = 0; i < runs; i++) {
    if (i > 0) dialogue.setNode(startAt ?? "Start");
    const lines: string[] = [];
    for (const event of drain(dialogue)) {
      if (event.type === "line") lines.push(event.speaker ? `${event.speaker}: ${event.text}` : event.text);
    }
    result.push(lines);
  }
  return result;
}

/** Pull events until the dialogue completes. */
const drain = runUntilCompleteEvents;

/** First line text a dialogue delivers. */
function firstLine(dialogue: Dialogue): string | null {
  for (const event of drain(dialogue)) {
    if (event.type === "line") return event.speaker ? `${event.speaker}: ${event.text}` : event.text;
  }
  return null;
}

// ── Complexity scoring (upstream Compiler.GetBooleanOperatorCountInExpression,
//    When_headerContext.ComplexityScore, NodeGroupCompiler totals) ──────────

test("boolean-operator count: and/or/xor (words and symbols), string literals excluded", () => {
  assert.equal(booleanOperatorCount("$a"), 0);
  assert.equal(booleanOperatorCount("$a and $b"), 1);
  assert.equal(booleanOperatorCount("$a and $b or $c"), 2);
  assert.equal(booleanOperatorCount("$a xor $b xor $c"), 2);
  assert.equal(booleanOperatorCount("$a && $b || $c"), 2);
  assert.equal(booleanOperatorCount("$a ^ $b"), 1);
  assert.equal(booleanOperatorCount('not $a and $b == "or maybe"'), 1);
  assert.equal(booleanOperatorCount('visited("x") and $b'), 1);
});

const NODE_GROUP_SOURCE = `title: Start
---
<<declare $conditionA = false>>
<<declare $conditionB = false>>
<<jump Group>>
===
title: Group
when: $conditionA
---
A
===
title: Group
when: always
---
B
===
title: Group
when: not $conditionA
---
C
===
title: Group
when: once
---
D
===
title: Group
when: once if $conditionB
---
E
===
`;

test("node-group member complexity: always=0, once=+1, expression = boolean-operator count + 1", () => {
  const program = compile(NODE_GROUP_SOURCE);
  const dialogue = new Dialogue(program);
  const options = dialogue.getSaliencyOptionsForNodeGroup("Group");
  // A ($conditionA): expression with no boolean operators → 1.
  // B (always): 0.
  // C (not $conditionA): `not` is unary — no binary boolean operators → 1.
  // D (once): +1 → 1.
  // E (once if $conditionB): the once marker (1) + the expression (0+1) → 2.
  assert.deepEqual(
    options.map((o) => o.complexityScore),
    [1, 0, 1, 1, 2],
  );
});

// ── Built-in strategies (upstream Yarn.Saliency semantics) ───────────────

function option(contentId: string, complexity: number, failing = 0): ContentSaliencyOption {
  return {
    contentId,
    complexityScore: complexity,
    passingConditionValueCount: failing === 0 ? 1 : 0,
    failingConditionValueCount: failing,
    contentType: "node",
  };
}

test("first strategy: first non-failing candidate", () => {
  const strategy = new FirstSaliencyStrategy();
  const content = [option("a", 0, 1), option("b", 5), option("c", 9)];
  assert.equal(strategy.queryBestContent([]), null);
  assert.equal(strategy.queryBestContent(content)?.contentId, "b");
  assert.equal(strategy.queryBestContent([option("a", 0, 1), option("b", 0, 2)]), null);
});

test("best strategy: highest complexity among non-failing, first of ties", () => {
  const strategy = new BestSaliencyStrategy();
  const content = [option("a", 1), option("b", 3), option("c", 3), option("d", 9, 2)];
  assert.equal(strategy.queryBestContent(content)?.contentId, "b");
  assert.equal(strategy.queryBestContent([option("a", 0, 1)]), null);
});

test("best-least-recently-viewed: least seen wins, then best complexity, then first", () => {
  const counts: Record<string, number> = { a: 3, b: 1, c: 1 };
  const state: SaliencyState = {
    getViewCount: (id) => counts[id] ?? 0,
    recordView: (id) => {
      counts[id] = (counts[id] ?? 0) + 1;
    },
  };
  const strategy = new BestLeastRecentlyViewedSaliencyStrategy(state);
  const content = [option("a", 9), option("b", 1), option("c", 2), option("d", 5, 1)];
  // b and c share the least view count (1); c has the higher complexity.
  assert.equal(strategy.queryBestContent(content)?.contentId, "c");
  // Selection records a view (the two-method interface: state updates live here).
  const selected = strategy.queryBestContent(content)!;
  strategy.contentWasSelected(selected);
  assert.equal(counts.c, 2);
  assert.equal(strategy.queryBestContent(content)?.contentId, "b");
});

test("random BLRV: picks within the least-seen, most-complex group", () => {
  const state: SaliencyState = { getViewCount: () => 0, recordView: () => {} };
  const strategy = new RandomBestLeastRecentlyViewedSaliencyStrategy(state);
  const content = [option("low", 0), option("high1", 5), option("high2", 5), option("failed", 9, 1)];
  for (let i = 0; i < 50; i++) {
    const pick = strategy.queryBestContent(content);
    assert.ok(pick);
    assert.ok(["high1", "high2"].includes(pick.contentId), `unexpected pick ${pick.contentId}`);
  }
  assert.equal(strategy.queryBestContent([option("a", 0, 1)]), null);
});

test("saliency modes map to the four built-in strategies", () => {
  const state: SaliencyState = { getViewCount: () => 0, recordView: () => {} };
  // Upstream `<<set_saliency>>` vocabulary (Try Yarn Spinner) plus the
  // conformance harness's plan-step spellings.
  assert.deepEqual([...SALIENCY_MODES].sort(), [
    "best",
    "best_least_recent",
    "best_least_recently_seen",
    "first",
    "random",
    "random_best_least_recent",
    "random_best_least_recently_seen",
  ]);
  assert.ok(saliencyStrategyForMode("first", state) instanceof FirstSaliencyStrategy);
  assert.ok(saliencyStrategyForMode("best", state) instanceof BestSaliencyStrategy);
  assert.ok(saliencyStrategyForMode("random", state) instanceof RandomBestLeastRecentlyViewedSaliencyStrategy);
  assert.ok(saliencyStrategyForMode("best_least_recent", state) instanceof BestLeastRecentlyViewedSaliencyStrategy);
  assert.ok(saliencyStrategyForMode("random_best_least_recent", state) instanceof RandomBestLeastRecentlyViewedSaliencyStrategy);
  assert.ok(saliencyStrategyForMode("best_least_recently_seen", state) instanceof BestLeastRecentlyViewedSaliencyStrategy);
  assert.equal(saliencyStrategyForMode("nonsense", state), null);
});

// ── Node-group selection through the runtime (upstream hub semantics) ───

test("deterministic BLRV node-group selection matches upstream's stable ordering", () => {
  // Mirrors NodeGroups.yarn's plan (saliency: best_least_recently_seen) step
  // for step, including its `set:` steps:
  // run 1 → C (complexity 1, first of the complexity-1 tie), run 2 → D (once,
  // complexity 1 beats always at the least-seen tier), run 3 → E (once-if,
  // complexity 2), run 4 → B, run 5 → A (first of the complexity-1 tie).
  const dialogue = new Dialogue(compile(NODE_GROUP_SOURCE));
  dialogue.setSaliencyStrategy("best_least_recently_seen");
  const collectRun = (): string[] => {
    const lines: string[] = [];
    for (const event of drain(dialogue)) {
      if (event.type === "line") lines.push(event.text);
    }
    return lines;
  };
  const runs: string[][] = [];
  runs.push(collectRun());
  dialogue.setNode("Start");
  runs.push(collectRun());
  dialogue.setVariable("conditionB", true);
  dialogue.setNode("Start");
  runs.push(collectRun());
  dialogue.setVariable("conditionB", true);
  dialogue.setNode("Start");
  runs.push(collectRun());
  dialogue.setVariable("conditionA", true);
  dialogue.setNode("Start");
  runs.push(collectRun());
  assert.deepEqual(runs, [["C"], ["D"], ["E"], ["B"], ["A"]]);
});

test("default strategy is random best-least-recently-viewed", () => {
  const dialogue = new Dialogue(compile(NODE_GROUP_SOURCE));
  assert.ok(dialogue.contentSaliencyStrategy instanceof RandomBestLeastRecentlyViewedSaliencyStrategy);
});

test("a node group with no salient content completes the dialogue (upstream hub Return)", () => {
  const runs = runLines(`title: Start
---
<<jump Empty>>
===
title: Empty
when: false
---
never
===
`, 1);
  assert.deepEqual(runs, [[]]);
});

test("a single node with when: headers is a one-member node group", () => {
  const runs = runLines(`title: Start
---
<<jump Solo>>
===
title: Solo
when: $open
---
solo content
===
`, 2, (d) => d.setSaliencyStrategy("best_least_recently_seen"));
  // $open is undeclared (unset → false): no content on either run — the
  // group machinery applies uniformly to single-member groups.
  assert.deepEqual(runs, [[], []]);
});

test("node-group saliency history lives as generated variables in variable storage", () => {
  const dialogue = new Dialogue(compile(NODE_GROUP_SOURCE));
  dialogue.setSaliencyStrategy("best_least_recently_seen");
  drain(dialogue);
  // Generated variables never surface in the story-variable snapshot, and
  // the first selection is reproduced from a clean store (view counts are
  // not module state — coding standards §4).
  assert.ok(
    !Object.keys(dialogue.getVariables()).some((k) => k.startsWith("$Yarn.Internal.")),
  );
  const fresh = new Dialogue(compile(NODE_GROUP_SOURCE));
  fresh.setSaliencyStrategy("best_least_recently_seen");
  assert.equal(firstLine(fresh), "C");
});

// ── `<<set_saliency>>` (project extension: runtime strategy switching) ──

test("<<set_saliency>> switches the strategy at runtime, observable in the stream", () => {
  const dialogue = new Dialogue(
    compile(`title: Start
---
<<set_saliency first>>
<<jump Group>>
===
title: Group
when: $x
---
conditional
===
title: Group
when: always
---
fallback
===
`),
  );
  // `first` takes the first non-failing candidate — the always member.
  assert.equal(firstLine(dialogue), "fallback");
  assert.ok(dialogue.contentSaliencyStrategy instanceof FirstSaliencyStrategy);

  // Best picks the highest-complexity salient member (the conditional one,
  // when it passes).
  const dialogue2 = new Dialogue(
    compile(`title: Start
---
<<set_saliency best>>
<<jump Group>>
===
title: Group
when: always
---
fallback
===
title: Group
when: true
---
specific
===
`),
  );
  assert.equal(firstLine(dialogue2), "specific");
  assert.ok(dialogue2.contentSaliencyStrategy instanceof BestSaliencyStrategy);

  // Unknown mode: a runtime diagnostic, not a crash; selection proceeds.
  const errors: string[] = [];
  const dialogue3 = new Dialogue(
    compile(`title: Start
---
<<set_saliency nonsense>>
Hello
===
`),
    { logError: (m) => errors.push(m) },
  );
  const events = drain(dialogue3);
  assert.ok(errors.some((m) => m.includes("saliency")));
  const hello = events.find((e) => e.type === "line");
  assert.ok(hello && hello.type === "line");
  assert.equal(hello.text, "Hello");
});

// ── Query APIs (upstream Dialogue.IsNodeGroup / GetSaliencyOptionsForNodeGroup /
//    HasSalientContent / StandardLibrary.has_any_content) ─────────────────

const QUERY_SOURCE = `title: Start
---
Has conditional: {has_any_content("Conditional")}
Has always: {has_any_content("Always")}
Has plain: {has_any_content("Plain")}
Has missing: {has_any_content("Missing")}
===
title: Conditional
when: $a
---
conditional
===
title: Always
when: always
---
always
===
title: Plain
---
plain
===
`;

test("query APIs: isNodeGroup, getSaliencyOptionsForNodeGroup, hasSalientContent", () => {
  const dialogue = new Dialogue(compile(QUERY_SOURCE));
  assert.equal(dialogue.isNodeGroup("Conditional"), true);
  assert.equal(dialogue.isNodeGroup("Plain"), false);
  assert.equal(dialogue.isNodeGroup("Missing"), false);

  assert.equal(dialogue.hasSalientContent("Conditional"), false);
  assert.equal(dialogue.hasSalientContent("Always"), true);
  assert.equal(dialogue.hasSalientContent("Plain"), true);

  // A plain node queries as a single passing option (upstream behavior).
  assert.deepEqual(dialogue.getSaliencyOptionsForNodeGroup("Plain"), [
    {
      contentId: "Plain",
      complexityScore: 0,
      passingConditionValueCount: 1,
      failingConditionValueCount: 0,
      contentType: "node",
    },
  ]);
  // A node group reports one option per member with pass/fail counts.
  const options = dialogue.getSaliencyOptionsForNodeGroup("Conditional");
  assert.equal(options.length, 1);
  assert.equal(options[0].failingConditionValueCount, 1);
});

test("has_any_content() builtin: missing=false, plain node=true, group=any salient", () => {
  assert.deepEqual(runLines(QUERY_SOURCE, 1), [
    ["Has conditional: False", "Has always: True", "Has plain: True", "Has missing: False"],
  ]);
});

test("host libraries may override has_any_content", () => {
  const library = new Library();
  library.registerFunction("has_any_content", () => "overridden");
  const dialogue = new Dialogue(compile(QUERY_SOURCE), { library });
  const line = drain(dialogue).find((e) => e.type === "line");
  assert.ok(line && line.type === "line");
  const composed = line.speaker ? `${line.speaker}: ${line.text}` : line.text;
  assert.match(composed, /Has conditional: overridden/);
});

// ── Line groups (`=>`) ──────────────────────────────────────────────────

test("line groups: exactly one alternative runs, cycling under BLRV", () => {
  const runs = runLines(`title: Start
---
=> first
=> second
=> third
===
`, 3, (d) => d.setSaliencyStrategy("best_least_recently_seen"));
  // Equal complexity; least-recently-seen with stable tie-break cycles them.
  assert.deepEqual(runs, [["first"], ["second"], ["third"]]);
});

test("line groups: a once item runs once, then the fallback carries", () => {
  const runs = runLines(`title: Start
---
=> intro <<once>>
=> fallback
===
`, 3, (d) => d.setSaliencyStrategy("best_least_recently_seen"));
  assert.deepEqual(runs, [["intro"], ["fallback"], ["fallback"]]);
});

test("line groups: complexity scoring picks the most specific available line", () => {
  const source = `title: Start
---
<<declare $pies = 0>>
=> generic
=> specific <<if $pies > 0>>
===
`;
  // Run 1: only the generic line passes → generic.
  assert.deepEqual(runLines(source, 1, (d) => d.setSaliencyStrategy("best_least_recently_seen")), [["generic"]]);

  // Fresh dialogue with a host-set variable: both pass; the conditional
  // line's complexity (1) beats the plain line's (0) → specific.
  const dialogue = new Dialogue(compile(source), { variables: { pies: 1 } });
  dialogue.setSaliencyStrategy("best_least_recently_seen");
  assert.equal(firstLine(dialogue), "specific");
});

test("line groups: speaker prefixes, line IDs, and comments work on => lines", () => {
  const dialogue = new Dialogue(
    compile(`title: Start
---
// a comment between items does not break the group
=> Baker: Hello #line:hello
=> Baker: Hi
===
`),
  );
  dialogue.setSaliencyStrategy("first");
  const line = drain(dialogue).find((e) => e.type === "line");
  assert.ok(line && line.type === "line");
  assert.equal(line.speaker, "Baker");
  assert.equal(line.text, "Hello");
  assert.equal(line.lineId, "line:hello");
});

test("line groups: no salient candidate skips the whole group", () => {
  const runs = runLines(`title: Start
---
Before
=> never <<if $off>>
After
===
`, 1);
  assert.deepEqual(runs, [["Before", "After"]]);
});

// ── Pluggable two-method strategy interface (upstream IContentSaliencyStrategy) ──

test("a host-provided strategy selects content through queryBestContent/contentWasSelected", () => {
  const selections: string[] = [];
  const strategy: ContentSaliencyStrategy = {
    queryBestContent: (content) => content.find((c) => c.contentId === "Group.1") ?? content[0] ?? null,
    contentWasSelected: (content) => selections.push(content.contentId),
  };
  const source = `title: Start
---
<<jump Group>>
===
title: Group
when: always
---
one
===
title: Group
when: always
---
two
===
`;
  const dialogue = new Dialogue(compile(source), { contentSaliencyStrategy: strategy });
  assert.equal(firstLine(dialogue), "two");
  assert.deepEqual(selections, ["Group.1"]);

  // The setter swaps strategies mid-dialogue.
  dialogue.contentSaliencyStrategy = new FirstSaliencyStrategy();
  dialogue.setNode("Start");
  assert.equal(firstLine(dialogue), "one");
});

// ── Node-group conformance errors assert exact YS codes ─────────────────

test("node-group conformance: member without when: is YS0031; duplicate subtitle is YS0032", () => {
  const missingWhen = compileSource(`title: Group
when: always
---
a
===
title: Group
---
b
===
`);
  const codes = missingWhen.diagnostics.map((d) => d.code);
  assert.ok(codes.includes("YS0031"), `expected YS0031, got ${codes.join(", ")}`);

  const duplicateSubtitle = compileSource(`title: Group
when: always
subtitle: Same
---
a
===
title: Group
when: always
subtitle: Same
---
b
===
`);
  const codes2 = duplicateSubtitle.diagnostics.map((d) => d.code);
  assert.ok(codes2.includes("YS0032"), `expected YS0032, got ${codes2.join(", ")}`);
});

// ── Storylet demo walk: saliency strategies switch mid-story and steer the
// draws (re-homed from the deleted React adapter suite, which only sat in a
// .tsx file by accident — every API here is core `Dialogue`). The demo
// content mirrors examples/browser/StoryletsDemo.ts.

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
subtitle: first_meeting
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
  const dialogue = new Dialogue(compile(STORYLET_YARN), { startAt: "Start" });

  // The query APIs the demo panel shows: every member with its complexity
  // score (always=0, once=+1, expression = boolean operators + 1).
  const options = dialogue.getSaliencyOptionsForNodeGroup("Storylets");
  assert.deepEqual(
    options.map((o) => [o.contentId, o.complexityScore]),
    [
      ["Storylets.crossroads", 0],
      ["Storylets.rumor", 1],
      ["Storylets.first_meeting", 1],
      ["Storylets.rogue", 1],
      ["Storylets.duel", 2],
      ["Storylets.heist", 2],
    ],
  );

  assert.ok(
    !dialogue.setSaliencyStrategy("no-such-strategy"),
    "An unknown mode must be rejected, leaving the strategy unchanged",
  );
  assert.ok(dialogue.setSaliencyStrategy("best_least_recent"));

  // Best least-recently-seen walks the story open deterministically:
  // rumor → first_meeting (unlocks $metRogue) → duel (unlocks $trustHigh)
  // → heist — each draw the least-seen, most-complex available member.
  assert.deepEqual(drawStorylet(dialogue), ["Travellers whisper of a Rogue who works the far road."]);
  assert.deepEqual(drawStorylet(dialogue), [
    "Well met. You don't look like the usual pilgrims.",
    "You've met the Rogue. New roads just opened up.",
  ]);
  assert.deepEqual(drawStorylet(dialogue), [
    "Prove your steel — once, and only once.",
    "Blades are crossed. Trust, somehow, was earned.",
  ]);
  assert.deepEqual(drawStorylet(dialogue), [
    "One last job. The vault under the chapel. Are you in?",
    "The heist went off without a hitch. Trust does that.",
  ]);

  // Switching to `best` mid-history ignores view counts: heist is still the
  // most complex available member (the two `once` members are spent).
  assert.ok(dialogue.setSaliencyStrategy("best"));
  assert.deepEqual(drawStorylet(dialogue), [
    "One last job. The vault under the chapel. Are you in?",
    "The heist went off without a hitch. Trust does that.",
  ]);

  // On a fresh dialogue, `first` takes the first written member, `best` the
  // highest-complexity one (rumor and first_meeting tie at 1; rumor first).
  const fresh = new Dialogue(compile(STORYLET_YARN), { startAt: "Start" });
  assert.ok(fresh.setSaliencyStrategy("first"));
  assert.deepEqual(drawStorylet(fresh), [
    "Quiet at the crossroads. Another traveller, another tale.",
  ]);
  const freshBest = new Dialogue(compile(STORYLET_YARN), { startAt: "Start" });
  assert.ok(freshBest.setSaliencyStrategy("best"));
  assert.deepEqual(drawStorylet(freshBest), [
    "Travellers whisper of a Rogue who works the far road.",
  ]);

  // The generated saliency history lives in the variable storage (coding
  // standards §4): a fresh dialogue's view counts reset with it.
  assert.deepEqual(
    fresh.getVariables(),
    { metRogue: false, trustHigh: false },
    "Generated variables (view counts, once-state) must not surface as story variables",
  );
});
