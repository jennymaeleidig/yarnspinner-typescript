// SPDX-License-Identifier: CC0-1.0
/**
 * Ticket 11: the `Dialogue` query API (upstream `Dialogue.cs`:
 * `NodeNames` @939, `GetStringIDForNode` @1014-1060, `NodeExists` @1113).
 *
 * Ports upstream `DialogueTests.TestNodeExists` and the `SaliencyTests`
 * node-group query patterns (`TestNodeGroups`, `TestNodeGroupWithSparseSubtitles`)
 * — every expectation mirrors the upstream test's (coding standards §1).
 * Divergences are recorded, never adjusted away:
 * - Upstream's `UnloadAll` step of `TestNodeExists` has no counterpart: this
 *   port's `Dialogue` receives its program at construction and has no
 *   `SetProgram(null)` (ADR 0002's pull API), so the "after unload" leg is
 *   covered by a fresh empty-program query instead.
 * - Upstream `GetSaliencyOptionsForNodeGroup` throws `ArgumentException` for
 *   an unknown name; this port reports a runtime diagnostic and returns no
 *   options (the recorded divergence in `runtime/vm.ts`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../index.js";
import { Dialogue } from "../runtime/dialogue.js";

function compile(source: string) {
  const { program, diagnostics } = compileSource(source);
  assert.ok(program, `compilation failed: ${diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`);
  return program;
}

// ── DialogueTests.TestNodeExists (DialogueTests.cs:20) ──────────────────────

const SALLY_SOURCE = `title: Sally
---
Player: Hey, Sally. #line:794945
Sally: Oh! Hi. #line:2dc39b
===
`;

test("port: TestNodeExists — a compiled node exists, an unknown name does not", () => {
  const result = compileSource(SALLY_SOURCE);
  assert.ok(result.program);
  const dialogue = new Dialogue(result.program);

  assert.equal(dialogue.nodeExists("Sally"), true);
  assert.equal(dialogue.nodeExists("Nobody"), false);

  // Upstream then UnloadAll()s and re-queries: NodeExists("Sally") is false.
  // This port's Dialogue is constructed with its program (no SetProgram(null)
  // counterpart — ADR 0002), so the unload leg pins the empty-program query
  // instead: no nodes, nothing exists.
  const empty = new Dialogue({
    languageVersion: 2,
    enums: {},
    nodes: {},
    initialValues: {},
    smartVariables: {},
  });
  assert.equal(empty.nodeExists("Sally"), false);
});

// ── SaliencyTests.TestNodeGroups (SaliencyTests.cs:~300) ────────────────────

const GROUP_SOURCE = `title: Start
when: once
---
This content is only seen once.
===
title: Start
when: $a == 2
---
This content is only seen when a is 2.
===
title: NotAGroup
---
This node is not part of a node group.
===
`;

test("port: TestNodeGroups — NodeExists and IsNodeGroup over a group and a plain node", () => {
  const dialogue = new Dialogue(compile(GROUP_SOURCE));

  assert.equal(dialogue.nodeExists("DoesntExist"), false);
  assert.equal(dialogue.nodeExists("Start"), true);
  assert.equal(dialogue.isNodeGroup("Start"), true);
  assert.equal(dialogue.nodeExists("NotAGroup"), true);
  assert.equal(dialogue.isNodeGroup("NotAGroup"), false);

  // We can always ask for saliency options given a valid node name, even if
  // it's not a node group.
  assert.equal(dialogue.getSaliencyOptionsForNodeGroup("Start").length, 2);
  assert.equal(dialogue.getSaliencyOptionsForNodeGroup("NotAGroup").length, 1);

  // Upstream throws ArgumentException for an invalid node name; this port
  // logs a diagnostic and returns no options (recorded divergence).
  const errors: string[] = [];
  const probing = new Dialogue(compile(GROUP_SOURCE), { logError: (m) => errors.push(m) });
  assert.equal(probing.getSaliencyOptionsForNodeGroup("DoesntExist").length, 0);
  assert.ok(errors.some((m) => m.includes("not a valid node name")));
});

// ── SaliencyTests.TestNodeGroupWithSparseSubtitles (SaliencyTests.cs:~340) ──

const SPARSE_SOURCE = `title: Start
subtitle: Special
when: always
---
This is a special start node which should get a subtitle name.
===
title: Start
when: always
---
This is a random start node which should get a UUID name.
===
title: Start
when: always
---
This is a random start node which should get a UUID name.
===
`;

test("port: TestNodeGroupWithSparseSubtitles — members are jump-addressable by unique name", () => {
  const dialogue = new Dialogue(compile(SPARSE_SOURCE));

  assert.equal(dialogue.isNodeGroup("Start"), true);
  assert.equal(dialogue.nodeExists("Start.Special"), true);

  // the program should now contain nodes named
  // ["Start.Special", "Start.<UUID>", "Start.<a different UUID"]
  const program = compile(SPARSE_SOURCE);
  const memberNames = Object.keys(program.nodes).filter((n) => n.startsWith("Start."));
  assert.equal(memberNames.length, 3);

  // Every unique member name is queryable through the Dialogue too.
  for (const name of memberNames) {
    assert.equal(dialogue.nodeExists(name), true);
  }
});

// ── NodeNames / GetStringIDForNode (Dialogue.cs:939, 1014-1060) ─────────────

test("nodeNames lists the program's node names (upstream Dialogue.NodeNames)", () => {
  const dialogue = new Dialogue(compile(GROUP_SOURCE));
  // Insertion order of the program's node table, upstream Compiler.cs:
  // source nodes first (node-group members under their unique names), then
  // the appended hub nodes carrying the source title.
  const names = dialogue.nodeNames();
  assert.deepEqual(
    names.map((n) => n.replace(/Start\.[0-9a-f]{8}/, "Start.<crc32>")),
    ["Start.<crc32>", "Start.<crc32>", "NotAGroup", "Start"],
  );
  assert.ok(names[0] !== names[1], "the two crc32 member names are distinct");
});

test("nodeNames on a program with no nodes is empty (upstream: empty collection)", () => {
  const empty = new Dialogue({
    languageVersion: 2,
    enums: {},
    nodes: {},
    initialValues: {},
    smartVariables: {},
  });
  assert.deepEqual(empty.nodeNames(), []);
});

test("getStringIDForNode returns the line:-prefixed ID for present nodes, null otherwise", () => {
  const errors: string[] = [];
  const dialogue = new Dialogue(compile(GROUP_SOURCE), { logError: (m) => errors.push(m) });

  // A node's source text is only in the string table when its tags header
  // contains rawText — the method itself does not check (upstream remark).
  assert.equal(dialogue.getStringIDForNode("NotAGroup"), "line:NotAGroup");
  assert.equal(dialogue.getStringIDForNode("DoesntExist"), null);
  assert.deepEqual(errors, ["No node named DoesntExist"]);
});

test("getStringIDForNode on a program with no nodes logs and returns null", () => {
  const errors: string[] = [];
  const empty = new Dialogue(
    { languageVersion: 2, enums: {}, nodes: {}, initialValues: {}, smartVariables: {} },
    { logError: (m) => errors.push(m) },
  );
  // Construction itself logs the default start node being absent (this
  // port enters the start node at construction; upstream does not auto-start).
  assert.equal(empty.getStringIDForNode("NotAGroup"), null);
  assert.ok(errors.includes("No nodes are loaded!"), `expected the no-nodes diagnostic, got ${JSON.stringify(errors)}`);
});
