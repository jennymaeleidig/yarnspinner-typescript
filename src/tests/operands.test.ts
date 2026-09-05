// SPDX-License-Identifier: CC0-1.0
/**
 * The operand-semantics table (deepening-wave-2 ticket 04): every operator ×
 * operand-type pair, stated once against `applyBinaryOp`/`applyUnaryOp`.
 * Both drivers execute these same statements — the VM's stack ops dispatch
 * through this module and so do the string evaluator's
 * arithmetic/comparison/logical loops — so this table is the operator
 * contract for both event streams (the lockstep the prose comments used to
 * coordinate, which snapped once: xor missed the string evaluator,
 * ticket 03).
 *
 * Where a rule cites upstream, it cites the same source the VM's op cases
 * and the conformance corpus pin: C# `ToString` rendering, C# numeric
 * conversions, `BooleanType.MethodXor`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBinaryOp,
  applyUnaryOp,
  deepEqualsOperands,
  stringifyOperand,
  toNumberOperand,
} from "../runtime/operands.js";

test("add: string concat with upstream rendering when either side is a string", () => {
  assert.equal(applyBinaryOp("add", "a", "b"), "ab");
  assert.equal(applyBinaryOp("add", "n: ", 42), "n: 42");
  assert.equal(
    applyBinaryOp("add", true, "!"),
    "True!",
    "booleans render as C# ToString",
  );
  assert.equal(applyBinaryOp("add", null, "x"), "x");
  assert.equal(
    applyBinaryOp("add", 1, 2),
    3,
    "both numeric → numeric addition",
  );
  assert.equal(applyBinaryOp("add", 0.5, 0.5), 1);
});

test("subtract/multiply/divide/modulo: numeric via toNumberOperand", () => {
  assert.equal(applyBinaryOp("subtract", 5, 2), 3);
  assert.equal(applyBinaryOp("subtract", "5", 2), 3, "numeric strings coerce");
  assert.equal(applyBinaryOp("multiply", true, 4), 4, "booleans coerce 1/0");
  assert.equal(applyBinaryOp("divide", 7, 2), 3.5);
  assert.equal(applyBinaryOp("modulo", 7, 3), 1);
  assert.equal(
    applyBinaryOp("subtract", null, 1),
    -1,
    "null/empty coerce to 0",
  );
  assert.throws(
    () => applyBinaryOp("subtract", "abc", 1),
    /Cannot convert/,
    "a non-numeric string is an error, not NaN",
  );
});

test("equalTo/notEqualTo: deep equality with implicit defaults for unset", () => {
  assert.equal(applyBinaryOp("equalTo", 1, 1), true);
  assert.equal(
    applyBinaryOp("equalTo", 1, "1"),
    false,
    "different types are not equal",
  );
  assert.equal(
    applyBinaryOp("equalTo", undefined, false),
    true,
    "unset bool variable carries its default",
  );
  assert.equal(applyBinaryOp("equalTo", undefined, 0), true);
  assert.equal(applyBinaryOp("equalTo", undefined, ""), true);
  assert.equal(applyBinaryOp("notEqualTo", undefined, 0), false);
  assert.equal(
    applyBinaryOp("equalTo", { a: 1 }, { a: 1 }),
    true,
    "deep equality",
  );
});

test("relationals: numeric via plain Number(), NaN comparisons yield false", () => {
  assert.equal(applyBinaryOp("lessThan", 1, 2), true);
  assert.equal(applyBinaryOp("greaterThan", "10", 9), true);
  assert.equal(applyBinaryOp("lessThanOrEqualTo", 2, 2), true);
  assert.equal(applyBinaryOp("greaterThanOrEqualTo", 1, 2), false);
  assert.equal(
    applyBinaryOp("lessThan", "abc", 1),
    false,
    "NaN < x is false, never a throw",
  );
});

test("and/or/xor: boolean semantics over the values as given", () => {
  assert.equal(applyBinaryOp("and", true, true), true);
  assert.equal(
    applyBinaryOp("and", true, 0),
    false,
    "non-bool operands coerce",
  );
  assert.equal(applyBinaryOp("or", false, "x"), true);
  assert.equal(applyBinaryOp("or", 0, null), false);
  // Upstream BooleanType.MethodXor: ConvertTo<bool>() ^ ConvertTo<bool>().
  assert.equal(applyBinaryOp("xor", true, false), true);
  assert.equal(applyBinaryOp("xor", true, true), false);
  assert.equal(applyBinaryOp("xor", 1, 0), true, "1 xor 0 → true");
  assert.equal(
    applyBinaryOp("xor", "a", "b"),
    false,
    "two truthy values xor to false",
  );
});

test("unary ops: negate is numeric, not is boolean", () => {
  assert.equal(applyUnaryOp("negate", 5), -5);
  assert.equal(applyUnaryOp("negate", true), -1);
  assert.equal(applyUnaryOp("negate", "3"), -3);
  assert.equal(applyUnaryOp("not", true), false);
  assert.equal(applyUnaryOp("not", "x"), false);
  assert.equal(applyUnaryOp("not", 0), true);
});

test("the primitives keep their standalone contracts", () => {
  assert.equal(stringifyOperand(true), "True");
  assert.equal(stringifyOperand(false), "False");
  assert.equal(stringifyOperand(null), "");
  assert.equal(toNumberOperand("42"), 42);
  assert.throws(() => toNumberOperand("nope"), /Cannot convert/);
  assert.equal(deepEqualsOperands(undefined, 0), true);
});
