// SPDX-License-Identifier: CC0-1.0
/**
 * Upstream fidelity ticket 15 — project tooling surface: declaration-file
 * generation (upstream `Utility.GenerateYarnFileWithDeclarations`, pinned by
 * ProjectTests.TestDeclarationFilesAreGenerated) and debug output (upstream
 * `ProjectDebugInfo`/`NodeDebugInfo`, pinned by
 * ProjectTests.TestDebugOutputIsProduced).
 *
 * Every expectation mirrors the upstream test's inputs and assertions; the
 * camelCased surface (`projectDebugInfo`, `getLineInfo`) follows the port's
 * upstream-naming convention (coding standards §5).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource, generateYarnFileWithDeclarations } from "../index.js";
import type { CompileResult } from "../index.js";

/** Upstream TestBase.CreateTestNode: wraps a body in a named node. */
function createTestNode(source: string, name = "Start"): string {
  return `title: ${name}\n---\n${source}\n===`;
}

// ── ProjectTests.TestDeclarationFilesAreGenerated ───────────────────────────

test("port: TestDeclarationFilesAreGenerated — declarations compile back into the original text", () => {
  const originalText = `title: Program
tags: one two
custom: yes
---
/// str desc
<<declare $str = "str">>

/// num desc
<<declare $num = 2>>

/// bool desc
<<declare $bool = true>>
===
`;

  const result = compileSource(originalText, { file: "input" });

  assert.ok(
    !result.diagnostics.some((d) => d.severity === "error"),
    `unexpected errors: ${result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`,
  );

  const generatedOutput = generateYarnFileWithDeclarations(
    result.declarations,
    "Program",
    ["one", "two"],
    { custom: "yes" },
  );

  assert.equal(generatedOutput, originalText);
});

test("generateYarnFileWithDeclarations output round-trips through compile() with the same declarations", () => {
  const originalText = `title: Program
---
/// str desc
<<declare $str = "str">>

/// num desc
<<declare $num = 2>>

/// bool desc
<<declare $bool = true>>
===
`;

  const first = compileSource(originalText);
  const generated = generateYarnFileWithDeclarations(first.declarations);
  assert.ok(
    !generated.startsWith("\n"),
    "generated output must not start with a blank line",
  );

  const second = compileSource(generated);
  assert.ok(
    !second.diagnostics.some((d) => d.severity === "error"),
    `recompiling the generated file errored: ${second.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`,
  );
  assert.deepEqual(
    second.declarations.map((d) => ({
      name: d.name,
      type: d.type,
      defaultValue: d.defaultValue,
    })),
    first.declarations.map((d) => ({
      name: d.name,
      type: d.type,
      defaultValue: d.defaultValue,
    })),
  );
});

// ── ProjectTests.TestDebugOutputIsProduced ──────────────────────────────────

test("port: TestDebugOutputIsProduced — the compile result exposes per-node bytecode positions", () => {
  const input = createTestNode("This is a test node.", "DebugTesting");

  const result: CompileResult = compileSource(input, { file: "input" });

  // We should have a single NodeDebugInfo, because we compiled a single node
  assert.ok(
    result.projectDebugInfo,
    "expected ProjectDebugInfo on the compile result",
  );
  const debugNodes = result.projectDebugInfo.nodes;
  assert.equal(
    debugNodes.filter((n) => n.nodeName === "DebugTesting").length,
    1,
    "expected exactly one debug-info node named DebugTesting",
  );

  // The first instruction of the only node should begin on the third line
  const firstLineInfo = debugNodes[0]!.getLineInfo(0);
  assert.equal(firstLineInfo.fileName, "input");
  assert.equal(firstLineInfo.nodeName, "DebugTesting");
  assert.equal(firstLineInfo.range.start.line, 2);
  assert.equal(firstLineInfo.range.start.character, 0);
});

test("getLineInfo throws for an instruction number with no recorded range (upstream ArgumentOutOfRangeException)", () => {
  const result = compileSource(createTestNode("Hello", "Start"));
  const node = result.projectDebugInfo!.nodes[0];
  assert.throws(() => node.getLineInfo(100_000));
});
