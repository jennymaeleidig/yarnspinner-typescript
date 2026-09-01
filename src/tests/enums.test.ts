/**
 * Enums end-to-end (spec ticket 41; spec stories 11-13, 30-32).
 *
 * - Enum declarations: uniform raw values, auto-numbering, `.Case` shorthand.
 * - Same-enum ==/!= restriction enforced at compile time (upstream YS0050).
 * - Enum declaration validation (YS0035/YS0037/YS0038/YS0040) per the
 *   upstream 3.2.2 type checker (TypeCheckerListener.ExitEnum_statement).
 * - Host-defined enums registered from TypeScript (the EnumTypeBuilder
 *   equivalent) flow through the external declarations path into compile-time
 *   checking and userDefinedTypes.
 * - At runtime, enum member access evaluates to the case's RAW value (the
 *   upstream contract — string()/number() conversions of enum cases yield the
 *   raw value).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource, EnumTypeBuilder, YarnRunner } from "../index.js";
import type { EnumType } from "../compile/enums.js";
import type { ExternalDeclarations } from "../compile/typeCheck.js";
import type { Diagnostic } from "../compile/diagnostics.js";

function compile(source: string, opts?: Parameters<typeof compileSource>[1]) {
  return compileSource(source, opts);
}

function codesOf(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

const FOOD_SCRIPT = `title: Start
---
<<enum Food>>
    <<case Apple>>
    <<case Orange>>
    <<case Pear>>
<<endenum>>
<<declare $favouriteFood = Food.Apple as Food>>
===
`;

test("auto-numbering: cases without raw values are numbered from 0", () => {
  const result = compile(FOOD_SCRIPT);
  assert.deepEqual(result.diagnostics, []);
  const food = result.userDefinedTypes.find((t) => t.name === "Food") as EnumType;
  assert.ok(food, "Food enum in userDefinedTypes");
  assert.equal(food.rawValueType, "number");
  assert.deepEqual(
    food.cases.map((c) => [c.name, c.rawValue]),
    [
      ["Apple", 0],
      ["Orange", 1],
      ["Pear", 2],
    ],
  );
});

test("explicit raw values: numbers are uniform and exposed in the compile result", () => {
  const result = compile(`title: Start
---
<<enum Planets>>
    <<case Mercury = 1>>
    <<case Venus = 2>>
    <<case Earth = 3>>
<<endenum>>
===
`);
  assert.deepEqual(result.diagnostics, []);
  const planets = result.userDefinedTypes.find((t) => t.name === "Planets") as EnumType;
  assert.deepEqual(
    planets.cases.map((c) => [c.name, c.rawValue]),
    [
      ["Mercury", 1],
      ["Venus", 2],
      ["Earth", 3],
    ],
  );
});

test("string raw values: uniform strings exposed in the compile result", () => {
  const result = compile(`title: Start
---
<<enum QuestObjectives>>
    <<case Objective1 = "DoObjective1">>
    <<case Objective2 = "DoObjective2">>
<<endenum>>
===
`);
  assert.deepEqual(result.diagnostics, []);
  const objectives = result.userDefinedTypes.find((t) => t.name === "QuestObjectives") as EnumType;
  assert.equal(objectives.rawValueType, "string");
  assert.equal(objectives.cases[0].rawValue, "DoObjective1");
});

test("<<declare>> of an enum-typed variable appears in declarations with the enum type", () => {
  const result = compile(FOOD_SCRIPT);
  const decl = result.declarations.find((d) => d.name === "favouriteFood");
  assert.ok(decl, "favouriteFood declared");
  assert.equal(decl.type, "Food");
});

test(".Case shorthand resolves when the enum can be inferred", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple>>
    <<case Orange>>
    <<case Pear>>
<<endenum>>
<<declare $secondFavouriteFood = Food.Orange>>
<<declare $thirdFavouriteFood = .Pear>>
===
`);
  assert.deepEqual(result.diagnostics, []);
  // The shorthand was rewritten to a full member reference at compile time:
  // the compiled initial value evaluates to the case's raw value.
  const runner = new YarnRunner(result.program!, { startAt: "Start" });
  runner.advance(); // run the declare command, then emit its event
  assert.equal(runner.getVariable("thirdFavouriteFood"), 2);
});

test("runtime: enum member access evaluates to the raw value; comparisons work", () => {
  const script = `title: Start
---
<<enum Food>>
    <<case Apple>>
    <<case Orange>>
    <<case Pear>>
<<endenum>>
<<declare $favouriteFood = Food.Apple as Food>>
<<if $favouriteFood == Food.Apple>>
    I like apples!
<<elseif $favouriteFood == Food.Orange>>
    It's an error if you see this!
<<endif>>
<<set $favouriteFood to Food.Orange>>
<<if $favouriteFood == Food.Apple>>
    It's an error if you see this!
<<elseif $favouriteFood != Food.Orange>>
    It's an error if you see this!
<<else>>
    I like oranges now!
<<endif>>
===
`;
  const result = compile(script);
  assert.deepEqual(result.diagnostics, []);
  const runner = new YarnRunner(result.program!, { startAt: "Start" });
  const seen: string[] = [];
  let guard = 20;
  while (guard-- > 0) {
    const r = runner.currentResult;
    if (!r) break;
    if (r.type === "text" && r.text.trim()) seen.push(r.text.trim());
    if (r.isDialogueEnd) break;
    runner.advance();
  }
  assert.deepEqual(seen, ["I like apples!", "I like oranges now!"]);
});

test("runtime: string()/number() of an enum case yield the raw value", () => {
  const script = `title: Start
---
<<enum Planets>>
    <<case Mercury = 1>>
    <<case Earth = 3>>
<<endenum>>
<<enum QuestObjectives>>
    <<case Objective1 = "DoObjective1">>
<<endenum>>
<<if string(QuestObjectives.Objective1) == "DoObjective1">>
    ok 1
<<endif>>
<<if number(Planets.Earth) == 3>>
    ok 2
<<endif>>
===
`;
  const result = compile(script);
  assert.deepEqual(result.diagnostics, []);
  const runner = new YarnRunner(result.program!, { startAt: "Start" });
  const seen: string[] = [];
  let guard = 20;
  while (guard-- > 0) {
    const r = runner.currentResult;
    if (!r) break;
    if (r.type === "text" && r.text.trim()) seen.push(r.text.trim());
    if (r.isDialogueEnd) break;
    runner.advance();
  }
  assert.deepEqual(seen, ["ok 1", "ok 2"]);
});

// --- Compile-time restriction: ==/!= only within the same enum (YS0050)

test("cross-enum equality comparison is a YS0050 compile error", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple>>
<<endenum>>
<<enum DayOfWeek>>
    <<case Monday>>
<<endenum>>
<<if Food.Apple == DayOfWeek.Monday>>
    oh no!
<<endif>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0050"]);
  assert.match(result.diagnostics[0].message, /same type/);
});

test("cross-enum inequality (!=) is also rejected", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple>>
<<endenum>>
<<enum DayOfWeek>>
    <<case Monday>>
<<endenum>>
<<if Food.Apple != DayOfWeek.Monday>>
    oh no!
<<endif>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0050"]);
});

test("same-enum comparisons and comparisons against non-enum values are fine", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple>>
    <<case Orange>>
<<endenum>>
<<declare $f = Food.Apple as Food>>
<<if $f == Food.Apple>>
    fine
<<endif>>
<<if $f != Food.Orange>>
    also fine
<<endif>>
===
`);
  assert.deepEqual(result.diagnostics, []);
});

// --- Enum declaration validation (upstream ExitEnum_statement rules)

test("YS0035: an enum must not be empty", () => {
  const result = compile(`title: Start
---
<<enum MyEnum>>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0035"]);
});

test("YS0035: case names must be unique", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple>>
    <<case Orange>>
    <<case Orange>>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0035"]);
  assert.match(result.diagnostics[0].message, /unique name/);
});

test("YS0035: raw values must be unique", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple = "one">>
    <<case Orange = "one">>
<<endenum>>
===
`);
  // Upstream reports every case in a duplicate group.
  assert.deepEqual(codesOf(result.diagnostics), ["YS0035", "YS0035"]);
  assert.match(result.diagnostics[0].message, /unique raw value/);
});

test("YS0035: raw values must all be of the same type", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple = 1>>
    <<case Orange = "Orange">>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0035"]);
  assert.match(result.diagnostics[0].message, /single type/);
});

test("YS0035: if any case has a raw value, all must (numeric enums too)", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple = "Apple">>
    <<case Orange>>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0035"]);
  assert.match(result.diagnostics[0].message, /must also have a raw value/);
});

test("YS0035: number raw values must be integers", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple = 1>>
    <<case Orange = 1.5>>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0035"]);
  assert.match(result.diagnostics[0].message, /integers/);
});

test("YS0037: raw values must be constant (no function calls)", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Orange = test_function()>>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0037"]);
});

test("YS0037: raw values must be constant (no enum member references)", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple = 1>>
<<endenum>>
<<enum DayOfWeek>>
    <<case Monday = Food.Apple>>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0037"]);
});

test("YS0040: an enum can't be declared twice", () => {
  const result = compile(`title: Start
---
<<enum Fish>>
    <<case Shark>>
<<endenum>>
<<enum Fish>>
    <<case Salmon>>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0040"]);
});

// --- Member access resolution (YS0038 / YS0050 / YS0028)

test("YS0038: an enum member access with an unknown case fails", () => {
  const result = compile(`title: Start
---
<<enum Test>>
    <<case Item>>
<<endenum>>
<<set $x = Test.Failure>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0038"]);
  assert.match(result.diagnostics[0].message, /doesn't have a member named Failure/);
});

test("YS0050: a member access on an unknown type fails", () => {
  const result = compile(`title: Start
---
<<set $x = NotAnEnum.Case>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0050"]);
  assert.match(result.diagnostics[0].message, /No type called NotAnEnum/);
});

test("shorthand .Case with no matching enum fails (YS0050)", () => {
  const result = compile(`title: Start
---
<<enum EnumA>>
    <<case One>>
<<endenum>>
<<set $x = .Four>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0050"]);
});

test("ambiguous shorthand .Case across enums fails (YS0028)", () => {
  const result = compile(`title: Start
---
<<enum EnumA>>
    <<case One>>
<<endenum>>
<<enum EnumB>>
    <<case One>>
<<endenum>>
<<set $a = .One>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0028"]);
});

test("shorthand .Case resolves against the assignment target's declared enum", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple>>
    <<case Orange>>
    <<case Pear>>
<<endenum>>
<<declare $favouriteFood = Food.Apple as Food>>
<<set $favouriteFood to .Pear>>
===
`);
  assert.deepEqual(result.diagnostics, []);
  const runner = new YarnRunner(result.program!, { startAt: "Start" });
  runner.advance();
  assert.equal(runner.getVariable("favouriteFood"), 2);
});

test("set of an enum-typed variable to another enum's case is a YS0050", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple>>
<<endenum>>
<<enum DayOfWeek>>
    <<case Monday>>
<<endenum>>
<<declare $f = Food.Apple as Food>>
<<set $f to DayOfWeek.Monday>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0050"]);
});

test("set of a non-enum variable to an enum case is a YS0050", () => {
  const result = compile(`title: Start
---
<<enum Food>>
    <<case Apple>>
<<endenum>>
<<declare $n = 0 as number>>
<<set $n to Food.Apple>>
===
`);
  assert.deepEqual(codesOf(result.diagnostics), ["YS0050"]);
});

// --- Host-defined enums (the EnumTypeBuilder equivalent)

test("host-defined enums: register from TypeScript, resolve .Case, appear in userDefinedTypes", () => {
  const food = new EnumTypeBuilder("Food").addCase("Apple").addCase("Orange").build();
  const result = compile(
    `title: Start
---
<<declare $favouriteFood = Food.Orange>>
<<if $favouriteFood == Food.Apple>>
    It's an error if you see this!
<<else>>
    Host enum works!
<<endif>>
===
`,
    { declarations: { enums: [food] } },
  );
  assert.deepEqual(result.diagnostics, []);
  const foodType = result.userDefinedTypes.find((t) => t.name === "Food") as EnumType;
  assert.ok(foodType, "host enum in userDefinedTypes");
  assert.deepEqual(foodType.cases.map((c) => c.rawValue), [0, 1]);
  const runner = new YarnRunner(result.program!, { startAt: "Start" });
  assert.equal(runner.getVariable("favouriteFood"), 1);
  const seen: string[] = [];
  let guard = 20;
  while (guard-- > 0) {
    const r = runner.currentResult;
    if (!r) break;
    if (r.type === "text" && r.text.trim()) seen.push(r.text.trim());
    if (r.isDialogueEnd) break;
    runner.advance();
  }
  assert.deepEqual(seen, ["Host enum works!"]);
});

test("host-defined enums: raw string values participate in comparisons", () => {
  const status = new EnumTypeBuilder("QuestStatus")
    .addCase("NotStarted", "NotStarted")
    .addCase("Completed", "Completed")
    .build();
  const result = compile(
    `title: Start
---
<<declare $status = QuestStatus.Completed>>
<<if $status == QuestStatus.Completed>>
    done
<<endif>>
===
`,
    { declarations: { enums: [status] } },
  );
  assert.deepEqual(result.diagnostics, []);
  const runner = new YarnRunner(result.program!, { startAt: "Start" });
  runner.advance();
  assert.equal(runner.getVariable("status"), "Completed");
});

test("host-defined enums: name clash with a script enum is YS0040", () => {
  const food = new EnumTypeBuilder("Food").addCase("Apple").build();
  const result = compile(FOOD_SCRIPT, { declarations: { enums: [food] } });
  assert.deepEqual(codesOf(result.diagnostics), ["YS0040"]);
});

test("EnumTypeBuilder: duplicate case names throw at construction (upstream parity)", () => {
  assert.throws(() => {
    new EnumTypeBuilder("Food").addCase("Apple").addCase("Apple").build();
  }, /already exists/);
});

test("EnumTypeBuilder: duplicate raw values throw at construction (upstream parity)", () => {
  assert.throws(() => {
    new EnumTypeBuilder("Food").addCase("Apple", 1).addCase("Orange", 1).build();
  }, /already exists/);
});

test("EnumTypeBuilder: mixed raw value types throw at construction (upstream parity)", () => {
  assert.throws(() => {
    new EnumTypeBuilder("Food").addCase("Apple", 1).addCase("Orange", "Orange").build();
  }, /raw value type/);
});

// --- Enum cases as function arguments (compile-time signature checking)

const QUEST_SIGNATURES: ExternalDeclarations["functions"] = {
  set_objective_complete: { params: ["string"], returns: "bool" },
  is_objective_active: { params: ["string"], returns: "bool" },
  get_quest_status: { params: ["string"], returns: "string" },
};

test("a string-raw enum case is accepted by a string parameter", () => {
  const result = compile(
    `title: Start
---
<<enum EnumA>>
    <<case One = "A-One">>
<<endenum>>
<<call set_objective_complete(EnumA.One)>>
===
`,
    { declarations: { functions: QUEST_SIGNATURES } },
  );
  assert.deepEqual(result.diagnostics, []);
});

test("a number-raw enum case passed to a string parameter is a YS0050", () => {
  const result = compile(
    `title: Start
---
<<enum EnumB>>
    <<case One = 1>>
<<endenum>>
<<call set_objective_complete(EnumB.One)>>
===
`,
    { declarations: { functions: QUEST_SIGNATURES } },
  );
  assert.deepEqual(codesOf(result.diagnostics), ["YS0050"]);
  assert.match(result.diagnostics[0].message, /not convertible/);
});

test("wrong argument count against a known signature is YS0014", () => {
  const result = compile(
    `title: Start
---
<<call set_objective_complete("a", "b")>>
===
`,
    { declarations: { functions: QUEST_SIGNATURES } },
  );
  assert.deepEqual(codesOf(result.diagnostics), ["YS0014"]);
});
