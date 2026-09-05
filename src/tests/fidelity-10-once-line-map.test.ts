// SPDX-License-Identifier: CC0-1.0
/**
 * Ticket 10 review risk: `buildOnceLineMap` (src/compile/compileSource.ts)
 * aligns `<<once>>` blocks to source lines for the once-state keys — the
 * input upstream's `TypeCheckerListener.ExitOnce_primary_clause` location
 * checksum needs (upstream keys the statement's actual line; a
 * mis-alignment silently changes the key).
 *
 * The AST's command statements carry no positions (the parser owns them),
 * so the seam scans each file's raw source. These tests pin the alignment
 * contract for the scan's known edge cases: a `<<once` mention inside
 * dialogue text must never claim the block's line, and each block must get
 * its own line in document order. The residual limit — the scan matches
 * line-initial command statements only, so a hypothetical parse where a
 * `<<once>>` block opener is not line-initial would mis-align — is
 * unreachable under the line-oriented parser (one command per line) and
 * recorded in ticket 10's comments.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource, compile } from "../index.js";

type Capture = { node: string; index: number; file?: string; line?: number };

/** Compile capturing the once-line the seam aligned each block to. */
function onceLinesOf(source: string): Array<Capture["line"]> {
  const captures: Capture[] = [];
  const result = compileSource(source, {
    generateOnceIds: (ctx) => {
      captures.push(ctx);
      return `K${captures.length}`;
    },
  });
  assert.ok(result.program, "compilation failed");
  return captures.map((c) => c.line);
}

test("a <<once mention inside dialogue text never claims the block's line", () => {
  // Line 3 is dialogue whose text contains `<<once` (unterminated — not a
  // line-level modifier); the real block opens on line 4. Upstream keys the
  // statement's line: 4.
  const lines = onceLinesOf(
    `title: Start
---
He said <<once to me.
<<once>>
Only once.
<<endonce>>
===
`,
  );
  assert.deepEqual(lines, [4]);
});

test("a line-level <<once>> modifier consumes its own line; the next block gets its own", () => {
  // Line 3: dialogue with a line-level `<<once>>` modifier (upstream line
  // conditions); line 4: the block. The modifier consumes line 3's match.
  const lines = onceLinesOf(
    `title: Start
---
He said <<once>> aloud.
<<once>>
Only once.
<<endonce>>
===
`,
  );
  assert.deepEqual(lines, [4]);
});

test("sequential blocks align to their own lines in document order", () => {
  const lines = onceLinesOf(
    `title: Start
---
<<once>>
A
<<endonce>>
<<once>>
B
<<endonce>>
===
`,
  );
  assert.deepEqual(lines, [3, 6]);
});

test("blocks nested in <<if>> bodies align inside the body", () => {
  const lines = onceLinesOf(
    `title: Start
---
<<if true>>
<<once>>
A
<<endonce>>
<<endif>>
<<once>>
B
<<endonce>>
===
`,
  );
  assert.deepEqual(lines, [4, 8]);
});

test("the alignment is per-file across a multi-file compile", () => {
  const captures: Capture[] = [];
  const result = compile(
    [
      {
        name: "a.yarn",
        source: "title: Start\n---\n<<once>>\nA\n<<endonce>>\n===\n",
      },
      {
        name: "b.yarn",
        source: "title: Other\n---\n<<once>>\nB\n<<endonce>>\n===\n",
      },
    ],
    {
      generateOnceIds: (ctx) => {
        captures.push(ctx);
        return `K${captures.length}`;
      },
    },
  );
  assert.ok(result.program, "compilation failed");
  assert.deepEqual(
    captures.map((c) => ({ file: c.file, line: c.line })),
    [
      { file: "a.yarn", line: 3 },
      { file: "b.yarn", line: 3 },
    ],
  );
});
