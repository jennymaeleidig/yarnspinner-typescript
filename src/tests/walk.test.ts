// SPDX-License-Identifier: CC0-1.0
/**
 * The statement walker's pins (deepening-wave-2 ticket 06): the traversal
 * subtleties nine hand-rolled walks each re-derived — document order, the
 * option's own line visiting before its body, line-group items, the
 * `<<once>>`-exclusion variant, and the callback node/context shape.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Line, Statement } from "../model/ast.js";
import { walkStatements } from "../model/walk.js";

function line(text: string): Line {
  return { type: "Line", text };
}
function command(content: string): Statement {
  return { type: "Command", content };
}

const tree: Statement[] = [
  line("a"),
  command("<<set $x to 1>>"),
  {
    type: "If",
    branches: [
      { condition: "true", body: [line("branch1")] },
      { condition: null, body: [line("branch2")] },
    ],
  },
  {
    type: "OptionGroup",
    options: [
      { type: "Option", text: "opt1", body: [line("opt1body")] },
      { type: "Option", text: "opt2", body: [{ type: "Jump", target: "b" }] },
    ],
  },
  {
    type: "LineGroup",
    items: [line("lg1"), line("lg2")],
  },
  {
    type: "Once",
    body: [line("onceBody")],
    elseBody: [line("elseBody")],
  },
  { type: "Jump", target: "elsewhere" },
];

test("document order: option text before its body, lines then structure", () => {
  const seen: string[] = [];
  walkStatements(tree, {
    onLine: (l) => seen.push(`line:${l.text}`),
    onOption: (o) => seen.push(`option:${o.text}`),
    onStatement: (s) => seen.push(`stmt:${s.type}`),
  });
  assert.deepEqual(seen, [
    "line:a",
    "stmt:Command",
    "stmt:If", // container fires before its children
    "line:branch1",
    "line:branch2",
    "stmt:OptionGroup",
    "option:opt1", // the option's own text before its body
    "line:opt1body",
    "option:opt2",
    "stmt:Jump",
    "line:lg1",
    "line:lg2",
    "stmt:Once",
    "line:onceBody",
    "line:elseBody",
    "stmt:Jump",
  ]);
});

test("includeOnce: false skips the whole <<once>> block (upstream LastLineBeforeOptionsVisitor shape)", () => {
  const seen: string[] = [];
  walkStatements(tree, {
    onLine: (l) => seen.push(l.text),
    onOption: (o) => seen.push(o.text),
    onStatement: (s) => seen.push(s.type),
  }, { includeOnce: false });
  assert.ok(!seen.includes("onceBody"));
  assert.ok(!seen.includes("elseBody"), "the else body rides the once block");
  assert.ok(seen.includes("a"), "everything else still walks");
});

test("contexts point at the node's own list and position", () => {
  const contexts: Array<[string, number]> = [];
  walkStatements([line("first"), line("second")], {
    onLine: (_l, at) => contexts.push([at.list === undefined ? "" : "list", at.index]),
  });
  assert.deepEqual(contexts, [["list", 0], ["list", 1]]);

  const optionContexts: number[] = [];
  const group: Statement[] = [{
    type: "OptionGroup",
    options: [
      { type: "Option", text: "a", body: [] },
      { type: "Option", text: "b", body: [] },
    ],
  }];
  walkStatements(group, {
    onOption: (_o, at) => optionContexts.push(at.index),
  });
  assert.deepEqual(optionContexts, [0, 1]);
});

test("a callback-free walker is a no-op (pure traversal)", () => {
  walkStatements(tree, {});
});