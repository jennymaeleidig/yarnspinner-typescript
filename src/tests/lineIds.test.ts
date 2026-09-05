// SPDX-License-Identifier: CC0-1.0
/**
 * Line IDs + string table: the compile output carries the
 * upstream string-table contract — implicit line IDs via upstream's
 * CRC32(file + node + running count) scheme (little-endian hex, `sh_`
 * prefix for shadow lines, numeric suffix on collision), explicit `#line:`
 * used verbatim, `#shadow:` validated at compile time (YS0042/43/44, plus
 * the multi-tag guards YS0017/62), shadow lines present in the table with
 * `text: null`, and hashtag metadata (including the auto-added `lastline`)
 * attached.
 *
 * ID vectors are pinned as literals and cross-checked against node's
 * `zlib.crc32` — an implementation independent of this repo's
 * `src/compile/crc32.ts` (upstream seeds CRC32 over UTF-8 bytes of
 * `fileName + nodeName + tableCount` and formats the checksum as
 * little-endian lowercase hex, per C# `BitConverter`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 as zlibCrc32 } from "node:zlib";
import { compile, Dialogue } from "../index.js";
import { hasErrors } from "../compile/diagnostics.js";
import type { CompileFile } from "../index.js";

const file = (name: string, source: string): CompileFile => ({ name, source });

/**
 * Independent recomputation of the implicit-ID scheme: node's zlib CRC-32
 * (not this repo's src/compile/crc32.ts) over UTF-8 bytes of
 * `fileName + nodeName + count`, formatted little-endian lowercase hex.
 */
function zlibLineId(fileName: string, nodeName: string, count: number): string {
  const checksum = zlibCrc32(
    Buffer.from(`${fileName}${nodeName}${count}`, "utf8"),
  );
  const bytes = [
    checksum & 0xff,
    (checksum >>> 8) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 24) & 0xff,
  ];
  return `line:${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The expected implicit IDs for `story.yarn`'s Node (counts 0 and 1). */
const NODE_LINE_0 = "line:35777bfa";
const NODE_LINE_1 = "line:a3477c8d";

// ── Implicit line IDs: upstream CRC32 scheme ──────────────────────────────

test("implicit line IDs are CRC32(fileName + nodeName + count), little-endian hex", () => {
  const result = compile([
    file(
      "story.yarn",
      `title: Node
---
A.
B.
===
`,
    ),
  ]);
  assert.equal(
    hasErrors(result.diagnostics),
    false,
    result.diagnostics.map((d) => d.code).join(", "),
  );
  const ids = Object.keys(result.stringTable!);
  // The pinned literals must equal an independent zlib recomputation.
  assert.equal(NODE_LINE_0, zlibLineId("story.yarn", "Node", 0));
  assert.equal(NODE_LINE_1, zlibLineId("story.yarn", "Node", 1));
  assert.deepEqual(ids.sort(), [NODE_LINE_0, NODE_LINE_1].sort());
});

test("implicit IDs are deterministic across compiles and keyed by file + node", () => {
  const source = `title: One
---
A.
===
`;
  const first = compile([file("a.yarn", source), file("b.yarn", source)]);
  const second = compile([file("a.yarn", source), file("b.yarn", source)]);
  assert.deepEqual(first.stringTable, second.stringTable);

  // The running count is shared across files: b.yarn's line registers when
  // the table already holds one entry, so its seed count is 1 (the literals
  // are re-derived here via zlib: crc32le("b.yarn" + "One" + "1")).
  const table = first.stringTable!;
  assert.deepEqual(
    Object.keys(table).sort(),
    [zlibLineId("a.yarn", "One", 0), zlibLineId("b.yarn", "One", 1)].sort(),
    "a.yarn/One/0 and b.yarn/One/1 — the count is the table-wide registration count",
  );
  assert.equal(table[zlibLineId("a.yarn", "One", 0)].fileName, "a.yarn");
  assert.equal(table[zlibLineId("b.yarn", "One", 1)].fileName, "b.yarn");
});

test("entries carry the upstream StringInfo fields for implicit IDs", () => {
  const result = compile([
    file(
      "story.yarn",
      `title: Node
---
A. #colour
===
`,
    ),
  ]);
  assert.deepEqual(result.stringTable![NODE_LINE_0], {
    text: "A.",
    nodeName: "Node",
    lineNumber: 3,
    fileName: "story.yarn",
    isImplicitTag: true,
    metadata: ["colour"],
    shadowLineID: null,
  });
});

// ── Shadow lines: registration + validation (YS0042/43/44) ────────────────

test("shadow lines register with their own implicit ID and null text (upstream TestShadowLinesReflectSourceLines)", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
This is a line. #line:source #apple
This is a line. #shadow:source #banana
===
`,
    ),
  ]);
  assert.equal(
    hasErrors(result.diagnostics),
    false,
    result.diagnostics.map((d) => d.code).join(", "),
  );
  const table = result.stringTable!;
  assert.equal(Object.keys(table).length, 2, "source + shadow, one entry each");

  const sourceEntry = table["line:source"];
  assert.equal(sourceEntry.text, "This is a line.");
  assert.equal(
    sourceEntry.shadowLineID,
    null,
    "source lines do not have a shadow line ID",
  );
  assert.deepEqual(sourceEntry.metadata, ["line:source", "apple"]);

  const shadowEntry = Object.entries(table).find(
    ([id]) => id !== "line:source",
  )![1];
  assert.ok(
    Object.keys(table).find((id) => id.startsWith("line:sh_")),
    "implicit shadow IDs carry the sh_ prefix",
  );
  assert.equal(
    shadowEntry.text,
    null,
    "shadow lines do not contain any source text",
  );
  assert.equal(
    shadowEntry.shadowLineID,
    "line:source",
    "the #shadow: tag resolves with the line: prefix",
  );
  assert.equal(shadowEntry.isImplicitTag, true);
  assert.deepEqual(
    shadowEntry.metadata,
    ["shadow:source", "banana"],
    "shadow lines have their own metadata",
  );
});

test("YS0042 when the shadow target does not exist; the text is not stripped", () => {
  const result = compile(
    [
      file(
        "input",
        `title: Start
---
Line content #shadow:missing
===
`,
      ),
    ],
    { mode: "stringsOnly" },
  );
  const shadows = result.diagnostics.filter((d) => d.code === "YS0042");
  assert.equal(
    shadows.length,
    1,
    "upstream UnknownLineIDForShadowLine fires in every mode",
  );
  assert.match(shadows[0].message, /line:missing/);
  assert.equal(shadows[0].file, "input");
  const entry = Object.values(result.stringTable!).find(
    (e) => e.shadowLineID === "line:missing",
  );
  assert.ok(entry);
  assert.equal(
    entry!.text,
    "Line content",
    "an unresolvable shadow keeps its text (upstream continues past YS0042)",
  );
});

test("YS0043 when the source line has inline expressions; the text is stripped", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
Source {1 + 1} #line:abc123
Source {1 + 1} #shadow:abc123
===
`,
    ),
  ]);
  const shadows = result.diagnostics.filter((d) => d.code === "YS0043");
  assert.equal(shadows.length, 1, "upstream ShadowLinesCantHaveExpressions");
  const shadowEntry = Object.values(result.stringTable!).find(
    (e) => e.shadowLineID === "line:abc123",
  );
  assert.ok(shadowEntry);
  assert.equal(
    shadowEntry!.text,
    null,
    "upstream strips the text even when validation failed",
  );
});

test("YS0044 when the shadow text differs from its source; the text is stripped", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
This is a line. #line:source
This is also a line. #shadow:source
===
`,
    ),
  ]);
  const shadows = result.diagnostics.filter((d) => d.code === "YS0044");
  assert.equal(
    shadows.length,
    1,
    "upstream ShadowLinesMustHaveSameTextAsSource",
  );
  const shadowEntry = Object.values(result.stringTable!).find(
    (e) => e.shadowLineID === "line:source",
  );
  assert.ok(shadowEntry);
  assert.equal(shadowEntry!.text, null);
});

// ── Multi-tag guards (YS0017 / YS0062) ────────────────────────────────────

test("YS0017 when a line carries both #line: and #shadow:; nothing registers", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
ordinary line
both tags #line:abc123 #shadow:def123
===
`,
    ),
  ]);
  const mixed = result.diagnostics.filter((d) => d.code === "YS0017");
  assert.equal(
    mixed.length,
    2,
    "upstream reports the pair: the shadow tag then the line tag",
  );
  assert.ok(
    Object.values(result.stringTable!).every((e) => e.text !== "both tags"),
    "the line registers no entry",
  );
  assert.equal(
    result.containsImplicitStringTags,
    true,
    "the ordinary line still registered",
  );
});

test("YS0062 when a line carries multiple #line: tags", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
ordinary line
dupe #line:abc123 #line:def123
===
`,
    ),
  ]);
  const multis = result.diagnostics.filter((d) => d.code === "YS0062");
  assert.equal(multis.length, 2, "one diagnostic per offending tag");
});

// ── lastline metadata ─────────────────────────────────────────────────────

test("the line immediately before an options block carries lastline metadata", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
Choose. #line:choose
-> Red
-> Blue
===
`,
    ),
  ]);
  assert.deepEqual(result.stringTable!["line:choose"].metadata, [
    "line:choose",
    "lastline",
  ]);
});

test("a command between the line and the options suppresses lastline (upstream LastLineBeforeOptionsVisitor)", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
Choose. #line:choose
<<set $x to 1>>
-> Red
===
`,
    ),
  ]);
  assert.deepEqual(result.stringTable!["line:choose"].metadata, [
    "line:choose",
  ]);
});

test("lastline applies inside if-bodies but not inside <<once>> blocks (upstream visitor scope)", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
<<if true>>
Pick. #line:in_if
-> A
-> B
<<endif>>
<<once>>
Once pick. #line:in_once
-> C
-> D
<<endonce>>
===
`,
    ),
  ]);
  assert.deepEqual(result.stringTable!["line:in_if"].metadata, [
    "line:in_if",
    "lastline",
  ]);
  assert.deepEqual(result.stringTable!["line:in_once"].metadata, [
    "line:in_once",
  ]);
});

// ── Program ⇄ table agreement ─────────────────────────────────────────────

test("a shadow line's program instruction carries its own implicit ID; the runtime plays it", () => {
  const source = `title: Start
---
This is a line. #line:source
This is a line. #shadow:source
===
`;
  const result = compile([file("input", source)]);
  assert.equal(
    hasErrors(result.diagnostics),
    false,
    result.diagnostics.map((d) => d.code).join(", "),
  );

  const shadowID = Object.keys(result.stringTable!).find((id) =>
    id.startsWith("line:sh_"),
  )!;
  assert.ok(shadowID);
  const node = result.program!.nodes["Start"] as {
    instructions: Array<{ op: string; text?: string; tags?: string[] }>;
  };
  const shadowIns = node.instructions.find(
    (ins) =>
      ins.op === "runLine" &&
      ins.text === "This is a line." &&
      ins.tags?.includes(shadowID),
  );
  assert.ok(
    shadowIns,
    "the shadow line's runLine carries the sh_ ID the table registered",
  );

  // The runtime still plays the shadow line (the program keeps authored text).
  const dialogue = new Dialogue(result.program!, { startAt: "Start" });
  const first = dialogue.continue();
  const second = dialogue.continue();
  const lines = [...first, ...second].filter((e) => e.type === "line");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[1].tags, ["shadow:source", shadowID]);
});

test("containsImplicitStringTags ignores shadow lines' implicit IDs", () => {
  const result = compile([
    file(
      "input",
      `title: Start
---
Only. #line:the_one
Shadow. #shadow:the_one
===
`,
    ),
  ]);
  assert.equal(
    result.containsImplicitStringTags,
    false,
    "the only implicit ID belongs to a shadow line",
  );
});
