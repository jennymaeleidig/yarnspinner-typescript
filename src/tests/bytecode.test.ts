// SPDX-License-Identifier: CC0-1.0
/**
 * Instruction-stream program tests (ADR 0001, ADR 0003).
 *
 * The compiler emits a TS-idiomatic instruction-stream stack-VM program: a
 * versioned JSON artifact (`languageVersion`) in which expressions are
 * compiled to bytecode and jumps are instruction indices whose labels were
 * resolved in a compiler pass. These golden assertions run over the emitted
 * program through the public compile seam (`compileSource().program`).
 *
 * Seam note: these golden assertions pin the EMITTED ARTIFACT — the program
 * format is public contract per ADR 0003 ("the format's schema is part of
 * the public contract once 1.0.0 ships"), and the artifact is observed
 * through the public compile seam (`compileSource().program`). Coding
 * standards §6's "no tests against opcode layout" governs the VM's private
 * execution machinery, not the documented program format.
 *
 * Lowering contract (what each test pins):
 * - lines/commands → `runLine`/`runCommand` (upstream RunLine/RunCommand);
 * - `<<jump>>`/`<<detour>>` → `runNode`/`detour` (node names; `{expr}`
 *   targets stay strings the VM resolves);
 * - `<<if>>`/option conditions/`<<set>>` expressions compile to stack
 *   bytecode; condition codegen failure falls back to `pushBool false`
 *   (the runtime evaluator's catch → false), set codegen failure keeps the
 *   raw `runCommand` so the VM inherits today's error behavior;
 * - `<<declare>>` hoists to compiled `initialValues` (upstream: declares
 *   compile to no instruction); smart variables compile in
 *   `smartVariables`;
 * - option groups lower to `addOption`/`showOptions` with body destinations
 *   as resolved indices (nested groups rely on `showOptions` delivering and
 *   clearing the accumulated set);
 * - `<<once>>` lowers to generated-variable reads/writes (coding standards
 *   §4) — no dedicated block op;
 * - line groups lower to `addSaliencyCandidate`/`selectSaliencyCandidate`/
 *   `popJump` with body destinations as resolved indices;
 * - node groups and headers (`when`, `scene`, `tracking`) carry over
 *   verbatim; the VM's saliency machinery evaluates them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource, programLanguageVersion } from "../index.js";
import type { Instruction, Program } from "../compile/program.js";

function emit(source: string): Program {
  const result = compileSource(source);
  assert.ok(result.program, "the compile seam emits a program");
  return result.program;
}

/** The instruction stream of one (single) node. */
function streamOf(program: Program, title: string): Instruction[] {
  const node = program.nodes[title];
  assert.ok(node && !("nodes" in node), `program has a single node "${title}"`);
  return node.instructions;
}

// ── Format-level assertions ──────────────────────────────────────────────

test("every emitted program carries the languageVersion field", () => {
  const program = emit(`title: Start
---
Hi
===
`);
  assert.equal(program.languageVersion, programLanguageVersion);
  assert.equal(typeof program.languageVersion, "number");
  // The artifact is plain serializable JSON: exactly the five documented
  // top-level fields (ADR 0003).
  assert.deepEqual(Object.keys(program).sort(), [
    "enums",
    "initialValues",
    "languageVersion",
    "nodes",
    "smartVariables",
  ]);
});

test("a failed parse emits no program", () => {
  const result = compileSource("not a node");
  assert.equal(result.program, null);
});

// ── Lowering: lines, state statements, jumps ─────────────────────────────

test("state statements compile to bytecode; declares hoist to initial values", () => {
  const program = emit(`title: Start
---
<<declare $gold = 10>>
<<declare $twice = $gold * 2>>
<<declare $greeting = "hi">>
<<set $gold += 5>>
<<set $greeting to "hi" + " there">>
Done
===
`);
  assert.deepEqual(program, {
    languageVersion: programLanguageVersion,
    enums: {},
    nodes: {
      Start: {
        title: "Start",
        headers: { title: "Start" },
        sourceFile: "input",
        startLine: 1,
        instructions: [
          // <<set $gold += 5>>: compound assignment is read/operate/write.
          { op: "pushVariable", name: "gold" },
          { op: "pushNumber", value: 5 },
          { op: "add" },
          { op: "popVariable", name: "gold" },
          // <<set $greeting to "hi" + " there">>
          { op: "pushString", value: "hi" },
          { op: "pushString", value: " there" },
          { op: "add" },
          { op: "popVariable", name: "greeting" },
          { op: "runLine", text: "Done", tags: ["line:db1929bc"] },
        ],
      },
    },
    initialValues: {
      gold: [{ op: "pushNumber", value: 10 }],
      greeting: [{ op: "pushString", value: "hi" }],
    },
    smartVariables: {
      // Smart variables carry compiled expressions, recomputed per access.
      twice: [
        { op: "pushVariable", name: "gold" },
        { op: "pushNumber", value: 2 },
        { op: "multiply" },
      ],
    },
  });
});

test("jump and detour lower to node-name instructions", () => {
  const program = emit(`title: Start
---
<<jump Next>>
===
title: Side
---
<<return>>
===
title: Third
---
<<stop>>
===
`);
  assert.deepEqual(streamOf(program, "Start"), [
    { op: "runNode", node: "Next" },
  ]);
  assert.deepEqual(streamOf(program, "Side"), [{ op: "return" }]);
  assert.deepEqual(streamOf(program, "Third"), [{ op: "stop" }]);
});

// ── Lowering: conditionals ───────────────────────────────────────────────

test("if/elseif/else lowers to resolved jump indices", () => {
  const program = emit(`title: Start
---
<<if $hp > 0>>
    Alive
<<elseif $hp == 0>>
    Dying
<<else>>
    Dead
<<endif>>
===
`);
  assert.deepEqual(streamOf(program, "Start"), [
    { op: "pushVariable", name: "hp" },
    { op: "pushNumber", value: 0 },
    { op: "greaterThan" },
    { op: "jumpIfFalse", index: 6 }, // → else-if condition
    { op: "runLine", text: "Alive", tags: ["line:db1929bc"] },
    { op: "jumpTo", index: 13 }, // → past the whole chain
    { op: "pushVariable", name: "hp" }, // 6: else-if condition
    { op: "pushNumber", value: 0 },
    { op: "equalTo" },
    { op: "jumpIfFalse", index: 12 }, // → else body
    { op: "runLine", text: "Dying", tags: ["line:4d292ecb"] },
    { op: "jumpTo", index: 13 },
    { op: "runLine", text: "Dead", tags: ["line:f7782752"] }, // 12: else body; 13 = end
  ]);
});

test("expressions compile with sane precedence and upstream word aliases", () => {
  const program = emit(`title: Start
---
<<if visited("Start") or not $open and $n gte 3>>
    Yes
<<endif>>
<<if $s is "abc">>
    Match
<<endif>>
===
`);
  assert.deepEqual(streamOf(program, "Start"), [
    // Upstream's ExpAndOrXor grammar rule: and/or/xor share one
    // left-associative precedence level, so this groups
    // (visited("Start") or (not $open)) and ($n >= 3) — not C's
    // and-binds-tighter-than-or.
    { op: "pushString", value: "Start" },
    { op: "callFunction", name: "visited", argc: 1 },
    { op: "pushVariable", name: "open" },
    { op: "not" },
    { op: "or" },
    { op: "pushVariable", name: "n" },
    { op: "pushNumber", value: 3 },
    { op: "greaterThanOrEqualTo" },
    { op: "and" },
    { op: "jumpIfFalse", index: 11 },
    { op: "runLine", text: "Yes", tags: ["line:db1929bc"] },
    // <<if $s is "abc">> — `is` is an equality alias.
    { op: "pushVariable", name: "s" }, // 11
    { op: "pushString", value: "abc" },
    { op: "equalTo" },
    { op: "jumpIfFalse", index: 16 },
    { op: "runLine", text: "Match", tags: ["line:4d292ecb"] },
  ]);
});

test("enum member access folds to the case's raw value at compile time", () => {
  const program = emit(`title: Start
---
<<enum Color>>
    <<case Red = 1>>
    <<case Green = 2>>
<<endenum>>
<<declare $c = Color.Red>>
<<if Color.Green == 2>>
    Green
<<endif>>
===
`);
  assert.deepEqual(program.enums, { Color: { Red: 1, Green: 2 } });
  assert.deepEqual(program.initialValues, {
    c: [{ op: "pushNumber", value: 1 }],
  });
  assert.deepEqual(streamOf(program, "Start"), [
    { op: "pushNumber", value: 2 }, // Color.Green folded to its raw value
    { op: "pushNumber", value: 2 },
    { op: "equalTo" },
    { op: "jumpIfFalse", index: 5 },
    { op: "runLine", text: "Green", tags: ["line:db1929bc"] },
  ]);
});

// ── Lowering: options ────────────────────────────────────────────────────

/** Assert a runLine carries no lastline tag (the tag the lowering and
 * string table add for the line before an options block, upstream
 * `#lastline`). */
function assertNoLastline(line: { tags?: string[] }, why: string): void {
  assert.ok(
    (line.tags ?? []).every((t) => t !== "lastline" && t !== "#lastline"),
    `${why}: ${JSON.stringify(line.tags)}`,
  );
}

test("a command between the line and the options suppresses the lowered lastline tag (upstream LastLineBeforeOptionsVisitor adjacency)", () => {
  const program = emit(`title: Start
---
Choose
<<set $x to 1>>
-> Red
===
`);
  const choose = streamOf(program, "Start").find(
    (ins): ins is Extract<Instruction, { op: "runLine" }> =>
      ins.op === "runLine" && ins.text === "Choose",
  );
  assert.ok(choose, "the Choose line lowers to a runLine");
  assertNoLastline(choose, "no lastline tag when a command intervenes");
});

test("a <<once>> block preceding options does not tag its body's line as lowered lastline (upstream's visitor never descends into once blocks)", () => {
  // The once block is the statement BEFORE the options — upstream's
  // LastLineBeforeOptionsVisitor skips past it without descending, so the
  // body's line stays untagged (a regression to the old backward scan, which
  // reached into the once body and tagged it, fails this test).
  const program = emit(`title: Start
---
<<once>>
Inside pick
<<endonce>>
-> Red
===
`);
  const inside = streamOf(program, "Start").find(
    (ins): ins is Extract<Instruction, { op: "runLine" }> =>
      ins.op === "runLine" && ins.text === "Inside pick",
  );
  assert.ok(inside, "the once-block line lowers to a runLine");
  assertNoLastline(
    inside,
    "no lastline tag for a line inside a preceding <<once>> block",
  );
});

test("option groups lower to addOption/showOptions with resolved destinations", () => {
  const program = emit(`title: Start
---
<<declare $likes_red = true>>
Choose
-> Red <<if $likes_red>>
    Red picked
-> Blue
    Blue picked
After
===
`);
  assert.deepEqual(streamOf(program, "Start"), [
    { op: "runLine", text: "Choose", tags: ["line:db1929bc", "lastline"] },
    // One availability push + addOption per option (addOption pops the
    // availability; unconditioned options push true).
    { op: "pushVariable", name: "likes_red" },
    { op: "addOption", text: "Red", tags: ["line:4d292ecb"], destination: 7 }, // 2
    { op: "pushBool", value: true }, // 3
    { op: "addOption", text: "Blue", tags: ["line:61482025"], destination: 9 }, // 4
    { op: "showOptions" }, // 5: delivers and clears the accumulated set
    { op: "jumpTo", index: 11 }, // 6: skip the inline bodies
    { op: "runLine", text: "Red picked", tags: ["line:f7782752"] }, // 7: Red's body
    { op: "jumpTo", index: 11 },
    { op: "runLine", text: "Blue picked", tags: ["line:c2dd44bb"] }, // 9: Blue's body
    { op: "jumpTo", index: 11 },
    { op: "runLine", text: "After", tags: ["line:54ed43cc"] }, // 11: after the block
  ]);
});

test("nested option groups each get their own addOption/showOptions cycle", () => {
  const program = emit(`title: Start
---
-> Outer
    -> Inner
        Deep
    -> Inner2
        Deep2
    Back
-> Outer2
    Other
===
`);
  assert.deepEqual(streamOf(program, "Start"), [
    // One availability push + addOption per option; addOption pops the flag.
    { op: "pushBool", value: true }, // 0: Outer's availability
    { op: "addOption", text: "Outer", tags: ["line:db1929bc"], destination: 6 }, // 1
    { op: "pushBool", value: true }, // 2: Outer2's availability
    {
      op: "addOption",
      text: "Outer2",
      tags: ["line:eebc4a55"],
      destination: 18,
    }, // 3
    { op: "showOptions" }, // 4: delivers and clears the outer set
    { op: "jumpTo", index: 20 }, // 5
    // Outer's body: an inner option group (the inner showOptions delivers
    // and clears only the inner set).
    { op: "pushBool", value: true }, // 6: Inner's availability
    {
      op: "addOption",
      text: "Inner",
      tags: ["line:4d292ecb"],
      destination: 12,
    }, // 7
    { op: "pushBool", value: true }, // 8: Inner2's availability
    {
      op: "addOption",
      text: "Inner2",
      tags: ["line:61482025"],
      destination: 14,
    }, // 9
    { op: "showOptions" }, // 10: delivers and clears the inner set
    { op: "jumpTo", index: 16 }, // 11
    { op: "runLine", text: "Deep", tags: ["line:f7782752"] }, // 12: Inner's body
    { op: "jumpTo", index: 16 }, // 13
    { op: "runLine", text: "Deep2", tags: ["line:c2dd44bb"] }, // 14: Inner2's body
    { op: "jumpTo", index: 16 }, // 15
    { op: "runLine", text: "Back", tags: ["line:54ed43cc"] }, // 16: after the inner group
    { op: "jumpTo", index: 20 }, // 17
    { op: "runLine", text: "Other", tags: ["line:788c4d22"] }, // 18: Outer2's body
    { op: "jumpTo", index: 20 }, // 19
  ]);
});

// ── Lowering: once ───────────────────────────────────────────────────────

test("once lowers to generated-variable reads and writes", () => {
  const program = emit(`title: Start
---
<<once>>
    Once line
<<endonce>>
<<detour Side>>
    After detour
<<stop>>
===
title: Side
---
Side line
<<return>>
===
`);
  // Upstream's once-statement key: the CRC32 of the statement's location
  // description — here file "input", node Start, line 3 (the `<<once>>`
  // line) — under the once-state namespace.
  const onceKey = "$Yarn.Internal.Once.bc028f9b";
  assert.deepEqual(streamOf(program, "Start"), [
    { op: "pushVariable", name: onceKey },
    { op: "jumpIfTrue", index: 5 }, // already seen → skip the block
    { op: "pushBool", value: true },
    { op: "popVariable", name: onceKey },
    { op: "runLine", text: "Once line", tags: ["line:db1929bc"] },
    { op: "detour", node: "Side" },
    { op: "runLine", text: "After detour", tags: ["line:4d292ecb"] },
    { op: "stop" },
  ]);
  assert.deepEqual(streamOf(program, "Side"), [
    { op: "runLine", text: "Side line", tags: ["line:3d9c747e"] },
    { op: "return" },
  ]);
});

// ── Lowering: node groups and headers ────────────────────────────────────

test("node groups and headers carry over verbatim", () => {
  const program = emit(`title: Start
when: always
scene: Kitchen
tracking: never
---
A
===
title: Start
when: $x > 0
---
B
===
`);
  // Node-group members adopt upstream's unique names (crc32 of
  // file+title+startLine — title headers on lines 1 and 6) and carry all
  // raw headers; each member is also registered in `nodes` under its
  // unique name (jump-addressable), alongside the group under the source
  // title (the port's hub).
  assert.deepEqual(program.nodes.Start, {
    title: "Start",
    nodes: [
      {
        title: "Start.4d292ecb",
        headers: {
          title: "Start.4d292ecb",
          when: "always",
          scene: "Kitchen",
          tracking: "never",
        },
        sourceFile: "input",
        startLine: 1,
        instructions: [{ op: "runLine", text: "A", tags: ["line:db1929bc"] }],
        when: ["always"],
        scene: "Kitchen",
        tracking: "never",
      },
      {
        title: "Start.e991f2b2",
        headers: { title: "Start.e991f2b2", when: "$x > 0" },
        sourceFile: "input",
        startLine: 8,
        instructions: [{ op: "runLine", text: "B", tags: ["line:4d292ecb"] }],
        when: ["$x > 0"],
      },
    ],
  });
  // Members are individually jump-addressable by their unique names.
  assert.ok(program.nodes["Start.4d292ecb"] && program.nodes["Start.e991f2b2"]);
});

// ── Codegen failure fallbacks ────────────────────────────────────────────

test("uncompilable conditions fall back to pushBool false; sets keep the raw command", () => {
  const program = emit(`title: Start
---
<<if $a + >>
    Never
<<endif>>
<<set $x to + >>
===
`);
  assert.deepEqual(streamOf(program, "Start"), [
    // `$a +` cannot compile; the runtime evaluator's catch → false is the
    // observable contract, so the fallback reproduces it exactly.
    { op: "pushBool", value: false },
    { op: "jumpIfFalse", index: 3 },
    { op: "runLine", text: "Never", tags: ["line:db1929bc"] },
    // A set whose expression cannot compile keeps the raw command so the
    // VM inherits today's runtime error handling.
    { op: "runCommand", content: "set $x to +" },
  ]);
});

test("unresolvable member accesses compile to null like the evaluator's undefined", () => {
  const program = emit(`title: Start
---
<<if Foo.Bar == 1>>
    Never
<<endif>>
===
`);
  assert.deepEqual(streamOf(program, "Start"), [
    { op: "pushNull" },
    { op: "pushNumber", value: 1 },
    { op: "equalTo" },
    { op: "jumpIfFalse", index: 5 },
    { op: "runLine", text: "Never", tags: ["line:db1929bc"] },
  ]);
});

// ── Whole-artifact invariants ────────────────────────────────────────────

/**
 * Golden shape audit: every instruction carries exactly its documented
 * fields — in particular, no label fields survive resolution, and every
 * jump index/option destination is an in-range instruction index within
 * its own node.
 */
const OP_KEYS: Record<string, { required: string[]; optional: string[] }> = {
  jumpTo: { required: ["op", "index"], optional: [] },
  jumpIfFalse: { required: ["op", "index"], optional: [] },
  jumpIfTrue: { required: ["op", "index"], optional: [] },
  runNode: { required: ["op", "node"], optional: [] },
  detour: { required: ["op", "node"], optional: [] },
  return: { required: ["op"], optional: [] },
  stop: { required: ["op"], optional: [] },
  runLine: { required: ["op", "text"], optional: ["speaker", "tags"] },
  runCommand: { required: ["op", "content"], optional: [] },
  addOption: { required: ["op", "text", "destination"], optional: ["tags"] },
  showOptions: { required: ["op"], optional: [] },
  pushString: { required: ["op", "value"], optional: [] },
  pushNumber: { required: ["op", "value"], optional: [] },
  pushBool: { required: ["op", "value"], optional: [] },
  pushNull: { required: ["op"], optional: [] },
  pushVariable: { required: ["op", "name"], optional: [] },
  popVariable: { required: ["op", "name"], optional: [] },
  callFunction: { required: ["op", "name", "argc"], optional: [] },
  add: { required: ["op"], optional: [] },
  subtract: { required: ["op"], optional: [] },
  multiply: { required: ["op"], optional: [] },
  divide: { required: ["op"], optional: [] },
  modulo: { required: ["op"], optional: [] },
  negate: { required: ["op"], optional: [] },
  equalTo: { required: ["op"], optional: [] },
  notEqualTo: { required: ["op"], optional: [] },
  lessThan: { required: ["op"], optional: [] },
  greaterThan: { required: ["op"], optional: [] },
  lessThanOrEqualTo: { required: ["op"], optional: [] },
  greaterThanOrEqualTo: { required: ["op"], optional: [] },
  and: { required: ["op"], optional: [] },
  or: { required: ["op"], optional: [] },
  not: { required: ["op"], optional: [] },
};

function auditInstructions(instructions: Instruction[], where: string): void {
  for (const [index, ins] of instructions.entries()) {
    const shape = OP_KEYS[ins.op];
    assert.ok(shape, `${where}[${index}]: unknown op "${ins.op}"`);
    const keys = Object.keys(ins).sort();
    const allowed = [...shape.required, ...shape.optional].sort();
    for (const key of shape.required) {
      assert.ok(
        keys.includes(key),
        `${where}[${index}]: ${ins.op} is missing "${key}"`,
      );
    }
    assert.ok(
      keys.every((k) => allowed.includes(k)),
      `${where}[${index}]: ${ins.op} has unexpected keys ${keys} (allowed: ${allowed})`,
    );
    for (const key of ["index", "destination"] as const) {
      if (keys.includes(key)) {
        const value = (ins as unknown as Record<string, number>)[key];
        assert.ok(
          Number.isInteger(value) && value >= 0 && value < instructions.length,
          `${where}[${index}]: ${ins.op}.${key} = ${value} is not an in-range instruction index`,
        );
      }
    }
  }
}

function auditProgram(program: Program): void {
  for (const [title, nodeOrGroup] of Object.entries(program.nodes)) {
    if ("nodes" in nodeOrGroup) {
      for (const [i, member] of nodeOrGroup.nodes.entries()) {
        auditInstructions(member.instructions, `${title}[${i}]`);
      }
    } else {
      auditInstructions(nodeOrGroup.instructions, title);
    }
  }
  for (const instructions of Object.values(program.initialValues)) {
    auditInstructions(instructions, "initialValues");
  }
  for (const instructions of Object.values(program.smartVariables)) {
    auditInstructions(instructions, "smartVariables");
  }
}

test("a kitchen-sink program audits clean: only documented fields, all indices resolved", () => {
  const program = emit(`title: Start
---
<<declare $gold = 10>>
<<declare $twice = $gold * 2>>
<<enum Color>>
    <<case Red = 1>>
<<endenum>>
<<if $gold > 5 and visited("Side")>>
    Rich and visited
<<elseif Color.Red == 1>>
    Red
<<else>>
    Poor
<<endif>>
<<once>>
    Once line
<<endonce>>
Choose
-> Red <<if $likes_red>>
    <<jump Side>>
-> Blue
    Blue picked
<<detour Side>>
After
===
title: Side
---
Side line
<<return>>
===
`);
  auditProgram(program);
  // Every node's stream ends cleanly (no dangling trailing jumps needed).
  assert.ok(Object.keys(program.nodes).includes("Start"));
});
