/**
 * Diagnostics channel tests (spec ticket 23; coding standards §3).
 *
 * Contract: collect by default — compile continues and diagnostics come back
 * with the result; `strict` throws on the first error. Shape mirrors upstream
 * `Diagnostic`: { code, severity, message, file, range, context }, with
 * 0-based half-open ranges. Codes and severities follow the vendored 3.2.2
 * registry (test/fixtures/upstream/YarnSpinner/Diagnostics/Definitions/).
 *
 * Scope note: only the validations the current front-end supports are
 * asserted here. Exact-code emission for set/declare values, enums, smart
 * variables and shadow lines lands with tickets 40–42.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileSource } from "../compile/compileSource.js";
import type { Diagnostic } from "../compile/diagnostics.js";
import { DIAGNOSTIC_REGISTRY } from "../compile/diagnostics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFINITIONS_DIR = path.resolve(
  here,
  "../../test/fixtures/upstream/YarnSpinner/Diagnostics/Definitions",
);

function compile(source: string, opts?: { file?: string; strict?: boolean }): Diagnostic[] {
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

test("YS0005 ranges are 0-based half-open over the offending token", () => {
  // Missing '---' after the title: the NODE_END token '===' (line 2, col 1,
  // 1-based) is the offending token.
  const diagnostics = compile(`title: Start
===
Body
`);
  assert.deepEqual(codesOf(diagnostics), ["YS0005"]);
  assert.deepEqual(diagnostics[0].range, { startLine: 1, startCol: 0, endLine: 1, endCol: 3 });
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

test("YS0011 + YS0031: duplicate titles whose members lack when: clauses", () => {
  const diagnostics = compile(`title: Start
---
One
===
title: Start
---
Two
===
`);
  const codes = codesOf(diagnostics);
  assert.ok(codes.includes("YS0011"), `expected YS0011 in ${codes}`);
  assert.ok(codes.includes("YS0031"), `expected YS0031 in ${codes}`);
  assert.match(diagnostics.find((d) => d.code === "YS0011")!.message, /Duplicate node title: 'Start'/);
});

test("YS0032: duplicate subtitle within a node group", () => {
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
  assert.deepEqual(codesOf(diagnostics), ["YS0032"]);
  assert.match(diagnostics[0].message, /group NodeName has subtitle SharedSubtitle/);
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
  const diagnostics = compile(`title: Start
---
<<jump {SomeVariable}>>
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

test("every emitted code exists in the vendored 3.2.2 definitions registry", () => {
  const vendored = new Set(
    fs.readdirSync(DEFINITIONS_DIR).map((f) => f.match(/^(YS\d+)-/)?.[1]).filter(Boolean),
  );
  assert.ok(vendored.size > 40, `expected the full registry vendored, got ${vendored.size}`);
  for (const code of Object.keys(DIAGNOSTIC_REGISTRY)) {
    assert.ok(vendored.has(code), `code ${code} has no vendored definition file`);
  }
});
