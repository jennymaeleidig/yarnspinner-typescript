// SPDX-License-Identifier: CC0-1.0
/**
 * tagLines + line-tag generators (spec ticket 51; upstream
 * `Utility.TagLines` + `ILineTagGenerator` + the Random/Descriptive
 * built-ins): every user-visible line lacking a `#line:` (or `#shadow:`)
 * tag gets one appended, via a pluggable generator asked per node and per
 * line index. Upstream's returned tuple is data here — the modified source,
 * the full known-ID set, and any tagging exceptions (coding standards §3:
 * upstream's `LineTaggingException`/`InvalidOperationException` demote to
 * returned exceptions with ` // ERROR: …` comments left in the source,
 * honoring the `TagAbortBehaviour`).
 *
 * The Random generator emits `line:` + 7 hex chars (upstream `{0:x7}` of a
 * value below 0x1000000); the Descriptive generator ports upstream's
 * `DescriptiveLineTagGenerator` insertion algorithm — `line:<node>_<NNNN>`
 * numbered by 100s, midpoints rounded to 5s, `_gN` generations when no gap
 * remains, and the speaker's character name from the line's parsed
 * `character` markup attribute — including the node's *unique* title for
 * node-group members (`Title.Subtitle`, or `Title.<crc32>` without one).
 *
 * Divergence (recorded in ticket 51): upstream's Random generator aborts on
 * a 500 ms stopwatch; the library reads no clocks (coding standards §2), so
 * the same "running out of time" exception fires after an attempt cap.
 *
 * Ported inline upstream tests (TagTests.cs) cover the no-fixture tagging
 * paths: the escaped-text retag (TestCommentsArentTagged) and round-trips
 * through the compile seam.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, Dialogue } from "../index.js";
import { hasErrors } from "../compile/diagnostics.js";
import type { CompileFile } from "../index.js";
import {
  tagLines,
  RandomLineTagGenerator,
  DescriptiveLineTagGenerator,
  LineTaggingError,
  type LineTagGenerator,
} from "../compile/tagLines.js";

const file = (name: string, source: string): CompileFile => ({ name, source });

const node = (body: string): string => `title: Node
---
${body}
===
`;

// ── RandomLineTagGenerator (the default) ───────────────────────────────────

test("tagLines tags every untagged line and option with unique 7-hex random IDs", () => {
  const source = node(`
Alice: Hi there
Bob: Hello
-> An option
    Bob: Option body
`);
  const result = tagLines(source);
  assert.equal(result.tagExceptions.length, 0);

  const taggedIds = [...result.modifiedSource.matchAll(/#(line:[0-9a-f]{7})/g)].map((m) => m[1]);
  assert.equal(taggedIds.length, 4, "lines, options, and option bodies all tag");
  assert.equal(new Set(taggedIds).size, 4, "generated IDs are unique");

  // The returned ID set is the known-ID set (excluded + found + added).
  for (const id of taggedIds) assert.ok(result.lineIds.includes(id));
});

test("already-tagged lines keep their IDs; shadow lines are not tagged", () => {
  const source = node(`
Alice: Hi there #line:keepme
Bob: Hello #shadow:keepme
`);
  const result = tagLines(source);
  assert.equal(result.tagExceptions.length, 0);
  assert.ok(result.modifiedSource.includes("#line:keepme"));
  assert.ok(result.modifiedSource.includes("#shadow:keepme"));
  assert.ok(!/#line:[0-9a-f]{7}/.test(result.modifiedSource), "nothing new to tag");
  assert.deepEqual(result.lineIds, []);
});

test("tagLines round-trips through the compile seam and the runtime (Random)", () => {
  const source = node(`
Narrator: One
-> Opt
    Narrator: Option body
`);
  const tagged = tagLines(source).modifiedSource;

  const result = compile([file("input", tagged)]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  // Every generated ID is now a string-table key.
  for (const id of tagged.matchAll(/#(line:[0-9a-f]{7})/g)) {
    assert.ok(id[1] in result.stringTable!, `string table contains ${id[1]}`);
  }

  // And the runtime delivers lines under those IDs.
  const dialogue = new Dialogue(result.program!, { startAt: "Node" });
  const events = [...dialogue.continue(), ...dialogue.continue()];
  const line = events.find((e) => e.type === "line");
  assert.ok(line && line.type === "line");
  assert.match(line.lineId!, /^line:[0-9a-f]{7}$/);
});

test("a second tagging run adds nothing (upstream: tags are stable across runs)", () => {
  const source = node(`Alice: Hi there`);
  const once = tagLines(source).modifiedSource;
  const twice = tagLines(once);
  assert.equal(twice.modifiedSource, once);
  assert.deepEqual(twice.lineIds, []);
});

test("excludedLineIDs are never generated", () => {
  const source = node(`Alice: Hi there`);
  const seen: Array<Set<string>> = [];
  const inner = new RandomLineTagGenerator();
  const probe: LineTagGenerator = {
    prepareForLines(contexts, excludedIDs): void {
      seen.push(new Set(excludedIDs));
      inner.prepareForLines(contexts, excludedIDs);
    },
    // The Random generator takes (node, lineIndex) but ignores both.
    generateLineTag: () => inner.generateLineTag(),
  };
  tagLines(source, { generator: probe, excludedLineIDs: ["line:badbad1"] });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].has("line:badbad1"));
});

test("a file that fails to parse is returned unchanged (upstream bails before tagging)", () => {
  const source = "this is not yarn at all\n";
  const result = tagLines(source);
  assert.equal(result.modifiedSource, source);
  assert.deepEqual(result.lineIds, []);
  assert.deepEqual(result.tagExceptions, []);
});

test("ported TestCommentsArentTagged: escaped text tags and recompiles clean", () => {
  const escapedText = `title: Start
---
\\\\
===`;
  // The base text compiles clean.
  const before = compile([file("input", escapedText)]);
  assert.equal(hasErrors(before.diagnostics), false, before.diagnostics.map((d) => d.code).join(", "));

  // Tagging adds a line ID to the (escaped) line.
  const tagged = tagLines(escapedText);
  assert.equal(tagged.tagExceptions.length, 0);
  assert.match(tagged.modifiedSource, /#line:[0-9a-f]{7}/);

  // And the tagged source recompiles clean.
  const after = compile([file("input", tagged.modifiedSource)]);
  assert.equal(hasErrors(after.diagnostics), false, after.diagnostics.map((d) => d.code).join(", "));
});

// ── DescriptiveLineTagGenerator ─────────────────────────────────────────────

test("descriptive IDs: node name, 100-step indices, and character names", () => {
  const source = node(`
Alice: This is me saying a line
Alice: And another line
<<some command>>
Bob: And me responding
And finally a line that isn't from a character
`);
  const result = tagLines(source, { generator: new DescriptiveLineTagGenerator() });
  assert.equal(result.tagExceptions.length, 0);
  assert.ok(result.modifiedSource.includes("#line:Node_0100_Alice"));
  assert.ok(result.modifiedSource.includes("#line:Node_0200_Alice"));
  assert.ok(result.modifiedSource.includes("#line:Node_0300_Bob"));
  assert.ok(result.modifiedSource.includes("#line:Node_0400"));
});

test("descriptive IDs: node-group members use their unique Title.Subtitle name", () => {
  const source = `title: Node
subtitle: Subtitle
when: always
---
Alice: This is me saying a line
===
`;
  const result = tagLines(source, { generator: new DescriptiveLineTagGenerator() });
  assert.equal(result.tagExceptions.length, 0);
  assert.ok(result.modifiedSource.includes("#line:Node.Subtitle_0100_Alice"));
});

test("descriptive IDs: insertions take midpoints rounded to 5s", () => {
  const source = node(`
Alice: This is me saying a line #line:Node_0100_Alice
Bob: We added a retort here
Alice: And another line #line:Node_0200_Alice
<<some command>>
Bob: And me responding #line:Node_0300_Bob
And finally a line that isn't from a character #line:Node_0400
`);
  const result = tagLines(source, { generator: new DescriptiveLineTagGenerator() });
  assert.equal(result.tagExceptions.length, 0);
  assert.ok(result.modifiedSource.includes("#line:Node_0150_Bob"));
});

test("descriptive IDs: no space left forces a _g1 generation suffix", () => {
  const source = node(`
Alice: This is me saying a line #line:Node_0100_Alice
Alice: And saying a bit more
Bob: I have a retort #line:Node_0101_Bob
`);
  const result = tagLines(source, { generator: new DescriptiveLineTagGenerator() });
  assert.equal(result.tagExceptions.length, 0);
  assert.ok(result.modifiedSource.includes("#line:Node_0101_g1_Alice"));
});

test("descriptive IDs: descending existing tags raise a tagging exception", () => {
  const source = node(`
Alice: later line #line:Node_0200_Alice
Bob: inserted line
Alice: earlier line #line:Node_0100_Alice
`);
  const result = tagLines(source, { generator: new DescriptiveLineTagGenerator() });
  assert.equal(result.tagExceptions.length, 1);
  assert.match(result.tagExceptions[0].message, /greater tagged value/);
  // The error is left in the source as a comment; the offending node's tags
  // are discarded (the default TagAbortBehaviour is currentNode).
  assert.match(result.modifiedSource, /\/\/ ERROR: The preceeding dialogue has a greater tagged value/);
});

test("descriptive IDs: a generated ID in the exclusion set raises a tagging exception", () => {
  const source = node(`Alice: This is me saying a line`);
  const result = tagLines(source, {
    generator: new DescriptiveLineTagGenerator(),
    excludedLineIDs: ["line:Node_0100_Alice"],
  });
  assert.equal(result.tagExceptions.length, 1);
  assert.match(result.tagExceptions[0].message, /conflicts with an id/);
});

test("descriptive tagging round-trips through the compile seam and the runtime", () => {
  const source = node(`
Alice: Hi there
Bob: Hello
`);
  const tagged = tagLines(source, { generator: new DescriptiveLineTagGenerator() }).modifiedSource;
  const result = compile([file("input", tagged)]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  assert.ok("line:Node_0100_Alice" in result.stringTable!);
  assert.ok("line:Node_0200_Bob" in result.stringTable!);

  const dialogue = new Dialogue(result.program!, { startAt: "Node" });
  const events = [...dialogue.continue(), ...dialogue.continue()];
  const line = events.find((e) => e.type === "line");
  assert.ok(line && line.type === "line");
  assert.equal(line.lineId, "line:Node_0100_Alice");
});

const nodeTitled = (title: string, body: string): string => `title: ${title}
---
${body}
===
`;

// ── TagAbortBehaviour ───────────────────────────────────────────────────────

test("tagAbortBehaviour currentNode skips the offending node but tags the rest", () => {
  const source = nodeTitled("Broken", "Alice: broken line") + nodeTitled("Fine", "Bob: fine line");
  // A generator that fails for the first node only.
  const failing = {
    prepareForLines(): void {},
    generateLineTag(node: string): string {
      if (node === "Broken") throw new LineTaggingError("no tags for you");
      return "line:fine0001";
    },
  };
  const result = tagLines(source, { generator: failing });
  assert.equal(result.tagExceptions.length, 1);
  assert.match(result.modifiedSource, /\/\/ ERROR: no tags for you/);
  // The second node's line was still tagged.
  assert.match(result.modifiedSource, /title: Fine[\s\S]*#line:fine0001/);
  // And the first node's line was not.
  const firstNode = result.modifiedSource.slice(0, result.modifiedSource.indexOf("title: Fine"));
  assert.doesNotMatch(firstNode, /#line:[0-9a-f]{7}/);
});

test("tagAbortBehaviour entireTagging leaves no tags anywhere", () => {
  const source = nodeTitled("Broken", "Alice: broken line") + nodeTitled("Fine", "Bob: fine line");
  const failing = {
    prepareForLines(): void {},
    generateLineTag(): string {
      throw new LineTaggingError("no tags for you");
    },
  };
  const result = tagLines(source, { generator: failing, tagAbortBehaviour: "entireTagging" });
  assert.equal(result.tagExceptions.length, 1);
  assert.doesNotMatch(result.modifiedSource, /#line:[0-9a-f]{7}/);
  assert.match(result.modifiedSource, /\/\/ ERROR: no tags for you/);
});

test("tagAbortBehaviour currentLine tags every other line", () => {
  const source = nodeTitled("Node", "Alice: broken line\nBob: fine line");
  let calls = 0;
  const failingOnce = {
    prepareForLines(): void {},
    generateLineTag(): string {
      if (calls++ === 0) throw new LineTaggingError("no tags for you");
      return `line:generated${calls}`;
    },
  };
  const result = tagLines(source, { generator: failingOnce, tagAbortBehaviour: "currentLine" });
  assert.equal(result.tagExceptions.length, 1);
  assert.match(result.modifiedSource, /#line:generated[0-9]+/);
  // The line after the failure was still tagged.
  assert.match(result.modifiedSource, /Bob: fine line #line:generated[0-9]+/);
});
