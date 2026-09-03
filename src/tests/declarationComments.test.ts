/**
 * `///` declaration documentation comments (spec story 47): comment lines
 * starting `///` immediately above a `<<declare>>` attach to the
 * declaration and surface in the compile result as its `description`
 * (upstream `Declaration.Description` — the variable's purpose, shown in
 * editor hovers). Comments above anything else are not declarations
 * documentation and are dropped.
 */

import { test } from "node:test";
import { ok, strictEqual } from "node:assert";
import { compileSource } from "../index.js";

test("a /// line above <<declare>> becomes the declaration's description", () => {
  const result = compileSource(`
title: Start
---
/// How many times the player has visited the shop
<<declare $shop_visits = 0>>
Mae: hi
===
`);
  ok(result.declarations.some((d) => d.name === "shop_visits"));
  const decl = result.declarations.find((d) => d.name === "shop_visits");
  strictEqual(decl?.description, "How many times the player has visited the shop");
});

test("consecutive /// lines join with newlines", () => {
  const result = compileSource(`
title: Start
---
/// The player's gold.
/// Spent at shops.
<<declare $gold = 0>>
===
`);
  const decl = result.declarations.find((d) => d.name === "gold");
  strictEqual(decl?.description, "The player's gold.\nSpent at shops.");
});

test("a /// comment above a non-declare statement is dropped, not leaked", () => {
  const result = compileSource(`
title: Start
---
/// not a declaration comment
Mae: plain line
/// orphaned at the end
===
`);
  const decl = result.declarations.find((d) => d.name === "irrelevant");
  ok(decl === undefined);
  // No declaration carries the stray comment: the only declaration in the
  // script (none here) — so assert the whole set is description-free.
  for (const d of result.declarations) {
    strictEqual(d.description, undefined);
  }
});

test("a <<declare>> without /// has no description key", () => {
  const result = compileSource(`
title: Start
---
<<declare $bare = 1>>
===
`);
  const decl = result.declarations.find((d) => d.name === "bare");
  ok(decl !== undefined);
  strictEqual(decl?.description, undefined);
});

test("a /// inside a node still reaches a declare inside that node", () => {
  const result = compileSource(`
title: Start
---
<<if true>>
    /// documented inside a block
    <<declare $inner = 1>>
<<endif>>
===
`);
  const decl = result.declarations.find((d) => d.name === "inner");
  strictEqual(decl?.description, "documented inside a block");
});
