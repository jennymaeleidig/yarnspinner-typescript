// SPDX-License-Identifier: CC0-1.0
/**
 * Comments outside node bodies: upstream's ANTLR lexer routes `//` lines to
 * the hidden COMMENTS channel in global mode (YarnSpinnerLexer.g4
 * `COMMENT: '//' ~('\r'|'\n')* -> channel(COMMENTS)`), so the `dialogue:
 * (file_hashtag*) node+` parse never sees them — comments before the first
 * node, between nodes, and after the last node are silently ignored.
 * Concretely: the official Try Yarn Spinner sample (Calibrations.yarn,
 * served at try.yarnspinner.dev/samples/Calibrations.yarn) documents its
 * node groups with `//` blocks between nodes.
 *
 * `///` lines between nodes are dropped the same way (they never attach to
 * the next node's declarations — documentation comments are a BodyMode
 * feature, see declarationComments.test.ts).
 */

import { test } from "node:test";
import { deepStrictEqual, ok } from "node:assert";
import { compileSource } from "../index.js";

test("a comment before the first node is ignored", () => {
  const result = compileSource(`// A file-top note
// spanning two lines
title: Start
---
Narrator: hi
===
`);
  deepStrictEqual(result.diagnostics, []);
  ok(result.program?.nodes["Start"]);
});

test("comments between nodes are ignored", () => {
  const result = compileSource(`title: Start
---
Narrator: hi
===
// Node group — the saliency system picks which one to run.
// "when: once" nodes only run once, then are retired.
title: MessHall
when: once
---
Mess Hall
===
`);
  deepStrictEqual(result.diagnostics, []);
  ok(result.program?.nodes["Start"]);
  ok(result.program?.nodes["MessHall"]);
});

test("comments after the last node are ignored", () => {
  const result = compileSource(`title: Start
---
Narrator: hi
===
// Continue your story here!
`);
  deepStrictEqual(result.diagnostics, []);
  ok(result.program?.nodes["Start"]);
});

test("/// lines between nodes are dropped, not attached to the next node's declarations", () => {
  const result = compileSource(`title: Variables
---
===
/// Not node documentation — dropped, upstream COMMENTS-channel behavior
title: Start
---
<<declare $x = 0>>
===
`);
  deepStrictEqual(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  const decl = result.declarations.find((d) => d.name === "x");
  ok(decl);
  ok(!decl.description);
});
