// SPDX-License-Identifier: CC0-1.0
/**
 * The state-statement grammar table (deepening-wave-2 ticket 05): every
 * spelling of `<<set>>`/`<<declare>>` pinned against the one parser
 * (src/parse/stateStatement.ts) that the type checker, the compiler's
 * lowering, the runtime's fallback executor, and the smart-variable
 * classifier all consume. The grammar previously lived in four hand-rolled
 * parsers that disagreed in the margins; these pins are the spellings no
 * single module could be attached to before.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compoundOperatorToStackOp,
  parseStateStatement,
} from "../parse/stateStatement.js";

test("plain set: to and = spellings, spaced", () => {
  assert.deepEqual(parseStateStatement("set $gold to 5"), {
    kind: "set",
    name: "gold",
    expression: "5",
    assignment: "to",
  });
  assert.deepEqual(parseStateStatement("set $gold = 5"), {
    kind: "set",
    name: "gold",
    expression: "5",
    assignment: "=",
  });
  assert.deepEqual(
    parseStateStatement("set  $gold   to   $gold + 1"),
    {
      kind: "set",
      name: "gold",
      expression: "$gold + 1",
      assignment: "to",
    },
    "whitespace between the operator and the expression collapses",
  );
});

test("compound set: every operator, spaced and attached", () => {
  for (const op of ["+=", "-=", "*=", "/=", "%="] as const) {
    const spaced = parseStateStatement(`set $n ${op} 1`);
    assert.deepEqual(
      spaced,
      {
        kind: "set",
        name: "n",
        expression: "1",
        compoundOp: op,
      },
      `spaced ${op}`,
    );
    const attached = parseStateStatement(`set $n${op}1`);
    assert.deepEqual(
      attached,
      {
        kind: "set",
        name: "n",
        expression: "1",
        compoundOp: op,
      },
      `attached ${op} — upstream lexes the operator as one token`,
    );
  }
});

test("declare: with and without the as-TYPE postfix", () => {
  assert.deepEqual(parseStateStatement("declare $x = 0 as number"), {
    kind: "declare",
    name: "x",
    expression: "0",
    assignment: "=",
    declaredType: "number",
  });
  assert.deepEqual(parseStateStatement("declare $x = 0"), {
    kind: "declare",
    name: "x",
    expression: "0",
    assignment: "=",
  });
  assert.deepEqual(
    parseStateStatement("declare $x=$y"),
    {
      kind: "declare",
      name: "x",
      expression: "$y",
      assignment: "=",
    },
    "the declare `=` may be attached",
  );
  assert.deepEqual(parseStateStatement('declare $s = "hello" as string'), {
    kind: "declare",
    name: "s",
    expression: '"hello"',
    assignment: "=",
    declaredType: "string",
  });
});

test("an `as` phrase inside a quoted string is not the type postfix", () => {
  const parsed = parseStateStatement(`declare $s = "two as words"`);
  assert.ok(parsed);
  assert.equal(parsed.expression, '"two as words"');
  assert.equal(parsed.declaredType, undefined);
});

test("identifiers follow the upstream rule (the old \\w+ looseness is gone)", () => {
  assert.equal(
    parseStateStatement("set $1abc to 1"),
    null,
    "`$1abc` was accepted by the type checker's $(\\w+) but never by upstream's lexer",
  );
  assert.ok(parseStateStatement("set $_x to 1"));
  assert.ok(parseStateStatement("set $aB9 to 1"));
});

test("non-statements parse to null", () => {
  assert.equal(parseStateStatement("walk 3"), null);
  assert.equal(
    parseStateStatement("set $x"),
    null,
    "operator/expression missing",
  );
  assert.equal(
    parseStateStatement("set x to 1"),
    null,
    "the variable reference carries $",
  );
  assert.equal(
    parseStateStatement("set $x ="),
    null,
    "an operator with no expression",
  );
  assert.equal(parseStateStatement("declare $x"), null);
});

test("compoundOperatorToStackOp maps each operator to its stack op", () => {
  assert.equal(compoundOperatorToStackOp("+="), "add");
  assert.equal(compoundOperatorToStackOp("-="), "subtract");
  assert.equal(compoundOperatorToStackOp("*="), "multiply");
  assert.equal(compoundOperatorToStackOp("/="), "divide");
  assert.equal(compoundOperatorToStackOp("%="), "modulo");
});
