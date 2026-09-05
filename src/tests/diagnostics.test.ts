// SPDX-License-Identifier: CC0-1.0
/**
 * Diagnostics channel tests (coding standards §3).
 *
 * Contract: collect by default — compile continues and diagnostics come back
 * with the result; `strict` throws on the first error. Shape mirrors upstream
 * `Diagnostic`: { code, severity, message, file, range, context }, with
 * 0-based half-open ranges. Codes and severities follow the upstream 3.2.2
 * registry (submodule path
 * test/fixtures/upstream/YarnSpinner/YarnSpinner.Diagnostics/Definitions/).
 *
 * Scope note: only the validations the current front-end supports are
 * asserted here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileSource } from "../compile/compileSource.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";
import type { Diagnostic } from "../compile/diagnostics.js";
import { DIAGNOSTIC_REGISTRY } from "../compile/diagnostics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFINITIONS_DIR = path.resolve(
  here,
  "../../test/fixtures/upstream/YarnSpinner/YarnSpinner.Diagnostics/Definitions",
);

function compile(
  source: string,
  opts?: { file?: string; strict?: boolean },
): Diagnostic[] {
  return compileSource(source, opts).diagnostics;
}

function codesOf(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

test("collect by default: a syntax error comes back as a diagnostic, not a throw", () => {
  const diagnostics = compile(`title: Start
---
{if $x}
Text
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  const d = diagnostics[0];
  assert.equal(d.severity, "error");
  assert.match(d.message, /^Syntax error: /);
});

test("YS0004 MissingDelimiter ranges are 0-based half-open over the offending token", () => {
  // Missing '---' after the title (upstream YS0004 — a node missing its
  // start or end delimiter): the NODE_END token '===' (line 2,
  // col 1, 1-based) is the offending token.
  const diagnostics = compile(`title: Start
===
Body
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0004"]);
  assert.deepEqual(diagnostics[0].range, {
    startLine: 1,
    startCol: 0,
    endLine: 1,
    endCol: 3,
  });
});

test("strict mode throws on the first error diagnostic", () => {
  assert.throws(
    () => compile(`title: Start\n---\n{if $x}\nText\n===\n`, { strict: true }),
    /YS0005/,
  );
});

test("clean source produces zero diagnostics", () => {
  const diagnostics = compile(`title: Start
---
Hello world
===
`);
  assert.deepEqual(diagnostics, []);
});

test("YS0027: a title may not start with a digit (upstream IDENTIFIER_HEAD rule)", () => {
  const result = compileSource(`title: 1abc
---
Body
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0027"]);
  assert.match(result.diagnostics[0]!.message, /Unexpected '1'/);
});

test("YS0027: underscore-leading titles are valid (identifier head), digit-leading subtitles are not", () => {
  const ok = compileSource(`title: _Start
---
Body
===
`);
  assert.deepEqual(codesOf(ok.diagnostics), []);

  const bad = compileSource(`title: Start
subtitle: 9lives
---
Body
===
`);
  assert.deepEqual(codesOf(bad.diagnostics), ["YS0027"]);
});

test("YS0052 NodeHasMoreThanOneTitle (recovers, keeps the first title)", () => {
  const result = compileSource(`title: Start
title: AlsoStart
---
Body
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0052"]);
  assert.ok(result.program!.nodes["Start"]);
  assert.equal(result.program!.nodes["AlsoStart"], undefined);
});

test("YS0011: duplicate titles whose members lack when: clauses (upstream TestDuplicateNonNodeGroups…)", () => {
  const diagnostics = compile(`title: Start
---
One
===
title: Start
---
Two
===
`);
  // Upstream AddErrorsForInvalidNodeNames: a duplicate group with no when:
  // headers at all is a plain duplicate-title duplication — one YS0011 per
  // member, and no YS0031 (that code is reserved for mixed groups).
  const dupes = diagnostics.filter((d) => d.code === "YS0011");
  assert.equal(
    dupes.length,
    2,
    `one YS0011 per member: ${codesOf(diagnostics)}`,
  );
  assert.ok(
    !diagnostics.some((d) => d.code === "YS0031"),
    `memberless duplicates report no YS0031: ${codesOf(diagnostics)}`,
  );
  assert.match(dupes[0]!.message, /Duplicate node title: 'Start'/);
});

test("YS0032: duplicate subtitle within a node group (one per member, upstream)", () => {
  const diagnostics = compile(`title: NodeName
subtitle: SharedSubtitle
when: always
---
One
===
title: NodeName
subtitle: SharedSubtitle
when: always
---
Two
===
`);
  // Upstream emits one YS0032 per member of the group with a duplicated
  // subtitle (it iterates every member of the group).
  const dupes = diagnostics.filter((d) => d.code === "YS0032");
  assert.equal(dupes.length, 2, `one per member: ${codesOf(diagnostics)}`);
  assert.match(dupes[0]!.message, /group NodeName has subtitle SharedSubtitle/);
});

test("YS0033: empty node compiles with a warning (EmptyNode)", () => {
  const diagnostics = compile(`title: Start
---
Real content
===
title: Empty
---
===
`);
  const empty = diagnostics.find((d) => d.code === "YS0033");
  assert.ok(empty, `expected YS0033 in ${codesOf(diagnostics)}`);
  assert.equal(empty.severity, "warning");
  assert.match(empty.message, /Node "Empty" is empty/);
});

test("YS0012: jump to an undefined node is a warning", () => {
  const diagnostics = compile(`title: Start
---
<<jump Nowhere>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0012"]);
  assert.equal(diagnostics[0].severity, "warning");
});

test("YS0012: braced jump targets are runtime-resolved, never flagged", () => {
  // Fixture-shaped braced target (Jumps.yarn uses "literal" and $var
  // targets); the node name is deliberately undefined — the static node
  // check must skip braced targets, which resolve at runtime.
  const diagnostics = compile(`title: Start
---
<<jump {$someNode}>>
===
`);
  assert.deepEqual(diagnostics, []);
});

test("no diagnostics: a valid node group (all when:, unique subtitles) is clean", () => {
  const diagnostics = compile(`title: Group
when: always
subtitle: a
---
One
===
title: Group
when: $flag
subtitle: b
---
Two
===
`);
  assert.deepEqual(diagnostics, []);
});

// --- Syntax removals: fork-era extensions fail compilation with
// --- YS-coded diagnostics, not parser crashes.

// Note: each removal surfaces as YS0005 (SyntaxError) because the fork-era
// constructs are not part of the 3.2.2 grammar; the message carries the
// migration pointer. See docs/migration-notes.md.

test("removed syntax: option-condition [if expr] suffix is a diagnostic, not a crash", () => {
  const diagnostics = compile(`title: Start
---
<<declare $flag = true>>
-> Hidden [if $flag]
    Narrator: Hidden
-> Visible
    Narrator: Visible
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /\[if .*\] has been removed/);
  assert.match(diagnostics[0].message, /<<if .*>>/);
});

test("removed syntax: inline {if}{else}{endif} blocks are a diagnostic, not a crash", () => {
  const diagnostics = compile(`title: Start
---
{if $x}
High
{else}
Low
{endif}
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /\{if\}.*been removed/s);
  assert.match(diagnostics[0].message, /<<if .*>>/);
});

test("removed syntax: &css{} in a line is a diagnostic, not a crash", () => {
  const diagnostics = compile(`title: Start
---
Narrator: Styled line &css{color: red;}
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /&css\{\} has been removed/);
});

test("removed syntax: &css{} in a header is a diagnostic, not a crash", () => {
  const diagnostics = compile(`title: Start
style: &css{backgroundColor: red;}
---
Hello
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /&css\{\} has been removed/);
});

test("removed syntax: &css{} on an option is a diagnostic, not a crash", () => {
  const diagnostics = compile(`title: Start
---
-> Styled &css{color: blue;}
    Narrator: Chosen
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /&css\{\} has been removed/);
});

test("$-prefix strictness: bare variable in <<set>> is a diagnostic", () => {
  const diagnostics = compile(`title: Start
---
<<set score to 7>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /\$ prefix/);
});

test("$-prefix strictness: bare variable in <<declare>> is a diagnostic", () => {
  const diagnostics = compile(`title: Start
---
<<declare score = 7>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /\$ prefix/);
});

test("$-prefix strictness: bare variable in compound assignment is a diagnostic", () => {
  const diagnostics = compile(`title: Start
---
<<declare $score = 0>>
<<set score += 1>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /\$ prefix/);
});

test("3.2 syntax: option-line <<if expr>> condition compiles and filters at runtime", () => {
  const source = `title: StartFalse
---
<<declare $flag = false>>
-> Hidden <<if $flag>>
    Narrator: Hidden
-> Visible
    Narrator: Visible
===

title: StartTrue
---
<<set $flag to true>>
-> Hidden <<if $flag>>
    Narrator: Hidden
-> Visible
    Narrator: Visible
===
`;
  const diagnostics = compile(source);
  assert.deepEqual(diagnostics, []);

  // Runtime behavior through the dialogue seam: the false condition
  // delivers the option with `isAvailable: false` (availability is
  // advisory; the set is not filtered).
  const result = compileSource(source);
  const dialogue = new Dialogue(result.program!, { startAt: "StartFalse" });
  const options = runUntilCompleteEvents(dialogue).find(
    (e): e is Extract<DialogueEvent, { type: "options" }> =>
      e.type === "options",
  );
  if (!options) throw new Error("Failed to reach options");
  assert.equal(options.options.length, 2, "the full set is delivered");
  assert.equal(
    options.options[0].isAvailable,
    false,
    "Hidden option is delivered as unavailable",
  );
  assert.equal(options.options[1].text, "Visible");
  assert.equal(options.options[1].isAvailable, true);
});

test("option-line <<if>> without an expression is a diagnostic (upstream ParseFailures)", () => {
  const diagnostics = compile(`title: Start
---
-> One <<if>>
    Narrator: Chose one
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /requires an expression/);
});

test("an option with two different <<if>> conditions is a diagnostic", () => {
  const diagnostics = compile(`title: Start
---
-> Broken <<if $a >> <<if $b>>
    Narrator: Chose
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.match(diagnostics[0].message, /only one <<if>>\/<<once>> condition/);
});

test("every emitted code exists in the upstream 3.2.2 definitions registry", () => {
  const registry = new Set(
    fs
      .readdirSync(DEFINITIONS_DIR)
      .map((f) => f.match(/^(YS\d+)-/)?.[1])
      .filter(Boolean),
  );
  assert.ok(
    registry.size > 40,
    `expected the full registry, got ${registry.size}`,
  );
  for (const code of Object.keys(DIAGNOSTIC_REGISTRY)) {
    assert.ok(
      registry.has(code),
      `code ${code} has no upstream definition file`,
    );
  }
});
