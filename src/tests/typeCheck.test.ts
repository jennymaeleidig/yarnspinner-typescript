// SPDX-License-Identifier: CC0-1.0
/**
 * The type checker driven directly through its public seam — `typeCheck()`
 * is exported from the package root, and this is its first test traffic
 * (deepening-wave-3 ticket 06; the review's free win). Checker-specific
 * semantics that previously only rode the compile end-to-end get their own
 * surface here: the YS0029 solver, type inference, YS0045 loops, the
 * `.Case` shorthand rewrite, YS0028/YS0050/YS0014/YS0040, and the external
 * declarations path. Coding standards §6: the seam is the public export;
 * no checker-internals poking.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EnumTypeBuilder, parseYarn, typeCheck } from "../index.js";
import type { Diagnostic } from "../index.js";

/** Drive the public checker seam over one source; returns the collected
 * diagnostics (codes + messages), the result, and the (mutated-in-place)
 * document. */
function typeCheckSource(source: string, opts: { declarations?: Parameters<typeof typeCheck>[1]["declarations"] } = {}) {
  const doc = parseYarn(source);
  const diagnostics: Diagnostic[] = [];
  const result = typeCheck(doc, opts, (d) => diagnostics.push(d));
  return { doc, diagnostics, result };
}

const codesOf = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);

// ── The YS0029 solver and type inference ─────────────────────────────────

test("YS0029: an inline use nothing can type is ExpressionTypeUndetermined", () => {
  const { diagnostics } = typeCheckSource(`
title: Start
---
Narrator: value {$mystery}
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0029"]);
  assert.match(diagnostics[0].message, /\$mystery/);
});

test("the solver is global: a later declaration resolves an earlier inline use", () => {
  const { diagnostics } = typeCheckSource(`
title: Start
---
Narrator: value {$n}
<<declare $n = 5 as Number>>
===
`);
  assert.deepEqual(diagnostics, []);
});

test("YS0003: a <<set>> target with no declaration and no external declaration is reported", () => {
  const { diagnostics } = typeCheckSource(`
title: Start
---
<<set $n to 1>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0003"]);
  assert.match(diagnostics[0].message, /\$n/);
});

test("a declared target suppresses YS0003; external declarations flow into the result", () => {
  const { diagnostics, result } = typeCheckSource(
    `
title: Start
---
<<set $gold to 3>>
===
`,
    { declarations: { variables: { gold: { type: "number" } } } },
  );
  assert.deepEqual(diagnostics, []);
  assert.ok(result.declarations.some((d) => d.name === "gold" && d.type === "number"));
});

// ── Smart variables: YS0045 loops ────────────────────────────────────────

test("YS0045: a smart-variable reference loop is reported per member, not thrown", () => {
  const { diagnostics, result } = typeCheckSource(`
title: Start
---
<<declare $a = $b + 1>>
<<declare $b = $a + 1>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0045", "YS0045"]);
  // Both members still declare as smart variables — the loop is a content
  // diagnostic, not a shape failure.
  assert.ok(result.declarations.every((d) => d.isSmartVariable));
});

// ── Enum shorthand: the in-place rewrite and its error modes ─────────────

test(".Case shorthand resolves in place: the AST carries the full form, the declaration the raw value", () => {
  const { doc, diagnostics, result } = typeCheckSource(`
title: Start
---
<<enum Season>>
    <<case Spring>>
<<endenum>>
<<declare $s = .Spring as Season>>
===
`);
  assert.deepEqual(diagnostics, []);
  // The in-place rewrite (ADR 0004): the statement text now names the full
  // member, and the declaration's default value is the case's raw value.
  const commands = doc.nodes[0].body.filter((s) => s.type === "Command");
  assert.ok(commands.some((s) => (s as { content: string }).content.includes("Season.Spring")));
  const [decl] = result.declarations;
  assert.equal(decl.type, "Season");
  assert.equal(decl.defaultValue, 0);
});

test("YS0028: ambiguous shorthand is a compile error, reported once per variable", () => {
  const { diagnostics } = typeCheckSource(`
title: Start
---
<<enum C>>
    <<case Red>>
<<endenum>>
<<enum D>>
    <<case Red>>
<<endenum>>
<<declare $c = .Red as number>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0028"]);
});

test("YS0050: ==/!= between different enums is the same-type violation", () => {
  const { diagnostics } = typeCheckSource(`
title: Start
---
<<enum A>>
    <<case One>>
<<endenum>>
<<enum B>>
    <<case Three>>
<<endenum>>
<<declare $x = A.One as A>>
<<if $x == B.Three>>
    nope
<<endif>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0050"]);
  assert.match(diagnostics[0].message, /not A and B/);
});

test("YS0040: a script enum shadowing an existing type name is a redeclaration error", () => {
  const { diagnostics } = typeCheckSource(`
title: Start
---
<<enum A>>
    <<case One>>
<<endenum>>
<<enum A>>
    <<case Two>>
<<endenum>>
===
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0040"]);
});

// ── The external declarations path (host enums and signatures) ───────────

test("host enums register through declarations.enums and type the declaring statement", () => {
  // Note: the checker's result carries the declarations and the checking
  // verdict; `userDefinedTypes` is assembled by the compile seam
  // (compileSource), not by typeCheck — the direct-drive surface shows the
  // boundary precisely.
  const { diagnostics, result } = typeCheckSource(
    `
title: Start
---
<<declare $f = Food.Apple as Food>>
===
`,
    { declarations: { enums: [new EnumTypeBuilder("Food").addCase("Apple", 1).addCase("Orange", 2)] } },
  );
  assert.deepEqual(diagnostics, []);
  const [decl] = result.declarations;
  assert.equal(decl.type, "Food");
  assert.equal(decl.defaultValue, 1);
});

test("YS0014: host function signatures feed compile-time arity checking", () => {
  const { diagnostics } = typeCheckSource(
    `
title: Start
---
<<declare $v = twoArgs(1) as Number>>
===
`,
    {
      declarations: {
        functions: { twoArgs: { params: ["number", "number"], returns: "number" } },
      },
    },
  );
  assert.deepEqual(codesOf(diagnostics), ["YS0014"]);
  assert.match(diagnostics[0].message, /twoArgs expects 2 parameters, not 1/);
});
