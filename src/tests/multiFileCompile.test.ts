/**
 * Multi-file compile + external declarations + four modes (spec ticket 49,
 * stories 31-33): the public `compile(files)` seam — `{ name, source }`
 * entries, no globs or filesystem I/O in the library (coding standards §2) —
 * exercised against the upstream `Projects/Basic` and `Projects/Space`
 * fixtures (the `.ysls` command definitions included) and ported upstream
 * assertions.
 *
 * String-table ID scheme note: implicit line IDs are the fork's per-compile
 * counter until ticket 50 lands upstream's CRC32(file+node+count); the
 * Duplicates/ lipsum fixtures (implicit-tag collision tagging) are that
 * ticket's fixtures and are not asserted here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  compile,
  compileSource,
  Dialogue,
  Library,
  EnumTypeBuilder,
  hasErrors,
} from "../index.js";
import type { CompileFile, CompilationMode } from "../index.js";
import { UPSTREAM_TESTS_DIR } from "./upstream/fixtures.js";

const spaceFile = (name: string): CompileFile => ({
  name,
  source: readFileSync(join(UPSTREAM_TESTS_DIR, "Projects", "Space", name), "utf8"),
});

const basicSource = readFileSync(join(UPSTREAM_TESTS_DIR, "Projects", "Basic", "Test.yarn"), "utf8");

// ── Upstream multi-file projects ──────────────────────────────────────────

test("Projects/Basic compiles and its nodes run (upstream TestLoadingNodes)", () => {
  const result = compile([{ name: "Test.yarn", source: basicSource }]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  assert.ok(result.program);
  assert.deepEqual(Object.keys(result.program.nodes).sort(), ["AnotherTestNode", "TestNode", "ThirdNode"]);

  const dialogue = new Dialogue(result.program, { startAt: "TestNode" });
  const events = dialogue.continue();
  const line = events.find((e) => e.type === "line");
  assert.ok(line?.type === "line");
  assert.equal(line.text, "This is a test node!");
});

test("Projects/Space compiles Sally.yarn + Ship.yarn together and runs", () => {
  const result = compile([spaceFile("Sally.yarn"), spaceFile("Ship.yarn")]);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  assert.ok(result.program);
  // Nodes from both files share one program.
  for (const title of ["Declarations", "Sally", "Sally_Watch", "Sally_Exit", "Sally_Sorry", "Ship"]) {
    assert.ok(result.program.nodes[title], `node ${title} exists`);
  }

  // String-table entries are attributed to their own file.
  const table = result.stringTable!;
  assert.equal(table["line:794945"].fileName, "Sally.yarn");
  assert.equal(table["line:794945"].nodeName, "Sally");
  assert.equal(table["line:5837f2"].fileName, "Ship.yarn");

  // The cross-file surface runs: Sally opens with the visited() branch.
  const dialogue = new Dialogue(result.program, { startAt: "Sally" });
  const events = dialogue.continue();
  const line = events.find((e) => e.type === "line");
  assert.ok(line?.type === "line");
  assert.equal(line.speaker, "Player");
  assert.equal(line.text, "Hey, Sally.");
});

test("Projects/Space: the .ysls command definitions ride the declarations path", () => {
  // Upstream's Commands.ysls.json declares `test_command(string)` for the
  // language server; a host derives declarations from it and passes them
  // alongside the compile. The files also compile with a compile-time
  // Library present (ticket 49: signature checking without runtime wiring).
  const ysls = JSON.parse(readFileSync(join(UPSTREAM_TESTS_DIR, "Projects", "Space", "Commands.ysls.json"), "utf8"));
  const library = new Library();
  for (const command of ysls.commands) {
    library.registerCommandHandler(command.yarnName, () => {});
  }
  assert.ok(library.hasCommandHandler("test_command"));

  const result = compile([spaceFile("Sally.yarn"), spaceFile("Ship.yarn")], { library });
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  // Explicit declarations override / extend library signatures for checking.
  const result2 = compile([spaceFile("Sally.yarn"), spaceFile("Ship.yarn")], {
    library,
    declarations: { functions: { visited: { params: ["string"], returns: "bool" } } },
  });
  assert.equal(hasErrors(result2.diagnostics), false, result2.diagnostics.map((d) => d.code).join(", "));
});

// ── Four compilation modes ────────────────────────────────────────────────

const MODE_SOURCE = `#project-wide
title: Start
---
<<declare $count = 3>>
Hello. #line:explicit_one
Second. {expr}
===
`;

test("full mode: program, string table, declarations, file tags, implicit-tag flag", () => {
  const result = compile([{ name: "mode.yarn", source: MODE_SOURCE }]);
  assert.ok(result.program);
  assert.ok(result.stringTable);
  assert.ok(result.declarations.some((d) => d.name === "count"));
  assert.deepEqual(result.fileTags, { "mode.yarn": ["project-wide"] });
  assert.equal(result.containsImplicitStringTags, true);
  assert.ok(result.userDefinedTypes.length === 0);
});

test("stringsOnly mode: string table + implicit-tag flag only (upstream StringsOnly)", () => {
  const result = compile([{ name: "mode.yarn", source: MODE_SOURCE }], { mode: "stringsOnly" });
  assert.equal(result.program, null);
  assert.deepEqual(result.declarations, []);
  assert.deepEqual(result.fileTags, {}, "upstream StringsOnly surfaces no file tags");
  assert.ok(result.stringTable, "the string table is present");
  assert.equal(result.stringTable!["line:explicit_one"].text, "Hello.");
  assert.equal(result.containsImplicitStringTags, true);
  // The table agrees with a full compile of the same sources.
  const full = compile([{ name: "mode.yarn", source: MODE_SOURCE }]);
  assert.deepEqual(result.stringTable, full.stringTable);
});

test("typeCheckOnly mode: declarations + string table, no program (upstream TypeCheck)", () => {
  const result = compile([{ name: "mode.yarn", source: MODE_SOURCE }], { mode: "typeCheckOnly" });
  assert.equal(result.program, null);
  assert.ok(result.declarations.some((d) => d.name === "count"));
  assert.deepEqual(result.fileTags, { "mode.yarn": ["project-wide"] });
  assert.ok(result.stringTable, "TypeCheck has carried the string table since upstream 3.2.1");
  // Upstream hardcodes ContainsImplicitStringTags false for TypeCheck.
  assert.equal(result.containsImplicitStringTags, false);
});

test("declarationsOnly mode: the obsolete upstream alias of typeCheckOnly", () => {
  const alias = compile([{ name: "mode.yarn", source: MODE_SOURCE }], { mode: "declarationsOnly" });
  const canonical = compile([{ name: "mode.yarn", source: MODE_SOURCE }], { mode: "typeCheckOnly" });
  assert.deepEqual(alias, canonical);
});

test("every mode observes the same multi-file validation diagnostics", () => {
  const files: CompileFile[] = [
    { name: "a.yarn", source: "title: Dup\n---\nOne\n===\n" },
    { name: "b.yarn", source: "title: Dup\n---\nTwo\n===\n" },
  ];
  for (const mode of ["full", "stringsOnly", "typeCheckOnly", "declarationsOnly"] as const satisfies readonly CompilationMode[]) {
    const result = compile(files, { mode });
    assert.ok(
      result.diagnostics.some((d) => d.code === "YS0011"),
      `${mode}: duplicate titles across files are validated in every mode`,
    );
  }
});

// ── String table shape ────────────────────────────────────────────────────

test("string table entries carry the upstream StringInfo shape", () => {
  const source = `title: Node
---
Plain line.
Tagged. #line:my_id #colour
Shadowed. #shadow:my_id
===
`;
  const result = compile([{ name: "shape.yarn", source }]);
  const table = result.stringTable!;
  assert.deepEqual(table["line:my_id"], {
    text: "Tagged.",
    nodeName: "Node",
    lineNumber: 4,
    fileName: "shape.yarn",
    isImplicitTag: false,
    // Upstream metadata is the line's hashtag texts verbatim (including an
    // authored #line: tag) plus the auto-added lastline marker.
    metadata: ["line:my_id", "colour"],
    shadowLineID: null,
  });
  const shadowEntry = Object.values(table).find((e) => e.shadowLineID === "line:my_id");
  assert.ok(shadowEntry, "the shadow line is registered with its source line's ID");
  assert.equal(shadowEntry!.isImplicitTag, true, "shadow lines carry implicit IDs of their own");
  assert.equal(shadowEntry!.nodeName, "Node");
  assert.equal(shadowEntry!.text, null, "shadow lines do not carry their text (upstream strips it)");
  const implicit = Object.values(table).find((e) => e.text === "Plain line.");
  assert.ok(implicit);
  assert.equal(implicit!.isImplicitTag, true);
  assert.equal(implicit!.lineNumber, 3);
});

test("no explicit tags → containsImplicitStringTags; all explicit → false", () => {
  const implicit = compile([{ name: "a.yarn", source: "title: A\n---\nHello.\n===\n" }], {
    mode: "stringsOnly",
  });
  assert.equal(implicit.containsImplicitStringTags, true);
  const explicit = compile(
    [{ name: "a.yarn", source: "title: A\n---\nHello. #line:one\n===\n" }],
    { mode: "stringsOnly" },
  );
  assert.equal(explicit.containsImplicitStringTags, false);
});

test("duplicate explicit line IDs across files produce YS0018 on both occurrences (upstream DuplicateLineTags)", () => {
  const files: CompileFile[] = [
    { name: "a.yarn", source: "title: A\n---\nFirst. #line:dupe\n===\n" },
    { name: "b.yarn", source: "title: B\n---\nSecond. #line:dupe\n===\n" },
  ];
  const result = compile(files, { mode: "stringsOnly" });
  const dupes = result.diagnostics.filter((d) => d.code === "YS0018");
  assert.equal(dupes.length, 2, "upstream reports both occurrences");
  assert.deepEqual(dupes.map((d) => d.file).sort(), ["a.yarn", "b.yarn"]);
  assert.equal(hasErrors(result.diagnostics), true);
  // The first entry stands: the duplicate did not overwrite it.
  assert.equal(result.stringTable!["line:dupe"].text, "First.");
});

// ── External declarations: variables (story 32) ──────────────────────────

test("external variables are known to the type checker and surface in declarations", () => {
  const result = compile([{ name: "ext.yarn", source: "title: A\n---\n<<set $gold to 5>>\n===\n" }], {
    declarations: { variables: { gold: { type: "number", defaultValue: 0 } } },
  });
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  assert.ok(result.declarations.some((d) => d.name === "gold" && d.type === "number"));
});

test("an in-script <<declare>> conflicting with an external variable is YS0039", () => {
  const result = compile(
    [{ name: "ext.yarn", source: "title: A\n---\n<<declare $gold = 1>>\n===\n" }],
    { declarations: { variables: { gold: { type: "number" } } } },
  );
  const redecls = result.diagnostics.filter((d) => d.code === "YS0039");
  assert.equal(redecls.length, 1, "upstream RedeclarationOfExistingVariable");
  assert.equal(redecls[0].file, "ext.yarn");
});

test("duplicate in-script <<declare>>s (across files too) are YS0039 — both occurrences", () => {
  const single = compileSource(`title: A
---
<<declare $x = 1>>
===
title: B
---
<<declare $x = 2>>
===
`);
  const redecls = single.diagnostics.filter((d) => d.code === "YS0039");
  assert.equal(redecls.length, 2, "upstream reports both occurrences");

  const files: CompileFile[] = [
    { name: "a.yarn", source: "title: A\n---\n<<declare $x = 1>>\n===\n" },
    { name: "b.yarn", source: "title: B\n---\n<<declare $x = 2>>\n===\n" },
  ];
  const multi = compile(files);
  const multiRedecls = multi.diagnostics.filter((d) => d.code === "YS0039");
  assert.equal(multiRedecls.length, 2, "upstream reports both occurrences across files");
  assert.deepEqual(
    [...new Set(multiRedecls.map((d) => d.file))].sort(),
    ["a.yarn", "b.yarn"],
  );
});

test("a duplicate <<enum>> redeclaration across files is YS0040", () => {
  const files: CompileFile[] = [
    { name: "a.yarn", source: "title: A\n---\n<<enum Fish>>\n<<case Shark>>\n<<endenum>>\n===\n" },
    { name: "b.yarn", source: "title: B\n---\n<<enum Fish>>\n<<case Tuna>>\n<<endenum>>\n===\n" },
  ];
  const result = compile(files, { mode: "typeCheckOnly" });
  const redecls = result.diagnostics.filter((d) => d.code === "YS0040");
  assert.ok(redecls.length >= 1, "upstream RedeclarationOfExistingType fires across files");
});

test("enum-typed external variables feed assignment checking (YS0050)", () => {
  const fish = new EnumTypeBuilder("Fish")
    .addCase("Shark", 1)
    .addCase("Tuna", 2)
    .build();
  const result = compile(
    [{ name: "e.yarn", source: "title: A\n---\n<<set $pet to Fish.Shark>>\n<<set $pet to 3>>\n===\n" }],
    { declarations: { enums: [fish], variables: { pet: { type: "Fish" } } } },
  );
  assert.ok(
    result.diagnostics.some((d) => d.code === "YS0050"),
    "assigning a number to an enum-typed variable is a type error",
  );
});

// ── Compile-time Library signature checking (ticket 49) ──────────────────

test("a compile-time Library's signatures drive arity checking (YS0014)", () => {
  const library = new Library();
  library.registerFunction("add_two", () => 0, {
    params: ["number", "number"],
    returns: "number",
  });
  const bad = compile([{ name: "lib.yarn", source: "title: A\n---\n<<set $x to add_two(1)>>\n===\n" }], {
    library,
  });
  assert.ok(bad.diagnostics.some((d) => d.code === "YS0014"), "wrong arity is flagged via the Library");

  const good = compile(
    [{ name: "lib.yarn", source: "title: A\n---\n<<set $x to add_two(1, 2)>>\n===\n" }],
    { library },
  );
  assert.equal(hasErrors(good.diagnostics), false, good.diagnostics.map((d) => d.code).join(", "));
});

test("variadic library signatures are accepted (upstream VariadicParameterType)", () => {
  const library = new Library();
  library.registerFunction("sum_all", (..._nums: unknown[]) => 0, {
    params: ["number"],
    variadic: true,
    returns: "number",
  });
  const result = compile(
    [{ name: "lib.yarn", source: "title: A\n---\n<<set $x to sum_all(1, 2, 3)>>\n===\n" }],
    { library },
  );
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
});

test("explicit declarations.functions take precedence over library signatures", () => {
  const library = new Library();
  // The library says pick/1; the host's explicit declaration says pick/0.
  library.registerFunction("pick", () => 0, { params: ["number"], returns: "number" });
  const result = compile(
    [{ name: "lib.yarn", source: "title: A\n---\n<<set $x to pick()>>\n===\n" }],
    {
      library,
      declarations: { functions: { pick: { params: [], returns: "string" } } },
    },
  );
  // The override won: the zero-arg call is legal (the library's arity
  // requirement would have flagged it with YS0014).
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
});

// ── File tags ─────────────────────────────────────────────────────────────

test("file-level hashtags (#tag lines before the first node) surface per file", () => {
  const files: CompileFile[] = [
    { name: "a.yarn", source: "#one #two\ntitle: A\n---\nLine.\n===\n" },
    { name: "b.yarn", source: "title: B\n---\nLine.\n===\n" },
  ];
  const result = compile(files);
  assert.equal(hasErrors(result.diagnostics), false, result.diagnostics.map((d) => d.code).join(", "));
  assert.deepEqual(result.fileTags, { "a.yarn": ["one", "two"], "b.yarn": [] });
});

// ── Divergence guardrails ─────────────────────────────────────────────────

test("parse failure in one file does not sink the others (collect-don't-throw)", () => {
  const files: CompileFile[] = [
    { name: "bad.yarn", source: "no title here at all\n" },
    { name: "good.yarn", source: "title: B\n---\nLine.\n===\n" },
  ];
  const result = compile(files);
  assert.ok(result.diagnostics.some((d) => d.code === "YS0005" && d.file === "bad.yarn"));
  assert.ok(result.program?.nodes["B"], "the healthy file still compiles");
});

test("strict mode throws on the first error across files", () => {
  const files: CompileFile[] = [
    { name: "good.yarn", source: "title: B\n---\nLine.\n===\n" },
    { name: "bad.yarn", source: "not a node\n" },
  ];
  assert.throws(() => compile(files, { strict: true }), /YS0005/);
});
