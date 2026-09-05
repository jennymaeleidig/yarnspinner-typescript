// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 04 — line & command parsing fidelity against upstream
 * 3.2.2 (YarnSpinnerLexer.g4 BodyMode/CommandMode/HashtagMode,
 * SyntaxValidationListener, ErrorListener):
 *
 * - a command ends at the FIRST `>>` (CommandMode's COMMAND_END): a
 *   hashtag after a command attaches to it (command_statement's
 *   `hashtag*`), and a second command on the same line parses as its own
 *   command_statement;
 * - trailing dialogue after a command re-enters text mode and warns
 *   YS0019 (upstream SyntaxValidationListener's line-statement-after-
 *   command check; the YS0019 registry example is `<<wait 1>> text`);
 * - stray `<<endif>>`/`<<else>>`/bare `<<if>>` report YS0006
 *   UnclosedCommand ("Unclosed command: missing >>"), per the error
 *   listener's command-keyword mapping;
 * - `<<if someFunction(>><<endif>>` reports YS0006
 *   (ported from upstream `ErrorHandlingTests.TestInvalidFunctionCall`);
 * - `<<declare $x to 1>>` accepts the `to` spelling (upstream
 *   OPERATOR_ASSIGNMENT is `'=' | 'to'`);
 * - header values strip a trailing `//` comment (upstream HeaderMode's
 *   HEADER_COMMENT);
 * - hashtag extraction is lossless (HASHTAG_TEXT is `~[ \t\r\n#$<]+`):
 *   `#cool-tag` keeps its hyphen, digit-start tags extract, line-start
 *   tags extract, and an escaped `\#` is NOT a hashtag (upstream
 *   ProjectTests' escaped-hashtag lines);
 * - `<some command>` (single chevrons) warns YS0048 SingularCommandWrap
 *   (upstream CheckMalformedCommandsInText);
 * - empty `<<>>` reports "Command text expected" as YS0005 (ported from
 *   upstream `ErrorHandlingTests.TestEmptyCommand` — ReportNoViable-
 *   Alternative's `<<`-then-`>>` message, wrapped by the SyntaxError
 *   template at the error listener's default branch).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../compile/compileSource.js";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";
import { parseYarn } from "../parse/parser.js";

const node = (content: string): string =>
  `title: Start\n---\n${content}\n===\n`;

const drain = runUntilCompleteEvents;

test("a command ends at the first >>: a trailing hashtag attaches to the command", () => {
  const doc = parseYarn(node("<<set $x = 1>> #color:red"));
  const [cmd] = doc.nodes[0].body;
  assert.equal(cmd.type, "Command");
  assert.equal((cmd as { content: string }).content, "set $x = 1");
  assert.deepEqual((cmd as { tags?: string[] }).tags, ["color:red"]);
});

test("a command with a trailing hashtag assigns at runtime", () => {
  const dialogue = new Dialogue(compileOk(node("<<set $x = 1>> #color:red")));
  drain(dialogue);
  assert.equal(dialogue.getVariable("x"), 1);
});

test("two <<set>> commands on one line both assign", () => {
  const dialogue = new Dialogue(
    compileOk(node("<<set $x = 1>><<set $y = 2>>")),
  );
  drain(dialogue);
  assert.equal(dialogue.getVariable("x"), 1);
  assert.equal(dialogue.getVariable("y"), 2);
});

test("two <<set>> commands separated by whitespace both assign", () => {
  const dialogue = new Dialogue(
    compileOk(node("<<set $x = 1>> <<set $y = 2>>")),
  );
  drain(dialogue);
  assert.equal(dialogue.getVariable("x"), 1);
  assert.equal(dialogue.getVariable("y"), 2);
});

test("stray <<endif>> is rejected with YS0006 UnclosedCommand", () => {
  const { program, diagnostics } = compileSource(node("<<endif>>"));
  assert.ok(!program, "a stray <<endif>> must not compile");
  const errors = diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 1, JSON.stringify(diagnostics));
  assert.equal(errors[0].code, "YS0006");
  assert.equal(errors[0].message, "Unclosed command: missing >>");
});

test("stray <<else>> is rejected with YS0006 UnclosedCommand", () => {
  const { program, diagnostics } = compileSource(node("<<else>>"));
  assert.ok(!program);
  const errors = diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors[0].code, "YS0006");
});

test("bare <<if>> is rejected with YS0006 UnclosedCommand", () => {
  const { program, diagnostics } = compileSource(node("<<if>>"));
  assert.ok(!program);
  const errors = diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors[0].code, "YS0006");
  assert.equal(errors[0].message, "Unclosed command: missing >>");
});

test("<<if someFunction(>><<endif>> reports YS0006, not YS0007 (upstream TestInvalidFunctionCall)", () => {
  const { diagnostics } = compileSource(node("<<if someFunction(>><<endif>>"));
  const errors = diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 1, JSON.stringify(diagnostics));
  assert.equal(errors[0].code, "YS0006");
  assert.ok(
    errors[0].message.includes("Unclosed command: missing >>"),
    `message drift: ${errors[0].message}`,
  );
});

test("<<declare $x to 1>> accepts the upstream `to` spelling", () => {
  const result = compileSource(node("<<declare $x to 1>>"));
  assert.ok(result.program, JSON.stringify(result.diagnostics));
  assert.equal(
    result.declarations.find((d) => d.name === "x")?.defaultValue,
    1,
  );
  const dialogue = new Dialogue(result.program!);
  drain(dialogue);
  assert.equal(dialogue.getVariable("x"), 1);
});

test("the `to` spelling still works in <<set>> and compound operators are unaffected", () => {
  const dialogue = new Dialogue(
    compileOk(node("<<set $x to 5>>\n<<set $x += 1>>")),
  );
  drain(dialogue);
  assert.equal(dialogue.getVariable("x"), 6);
});

test("header values strip a trailing // comment (upstream HEADER_COMMENT)", () => {
  const doc = parseYarn("title: Start\ncolor: red // noted\n---\n===\n");
  assert.equal(doc.nodes[0].headers["color"], "red");
  assert.equal(doc.nodes[0].title, "Start");
});

test("header comment stripping leaves values without comments untouched", () => {
  const doc = parseYarn("title: Start\ncolor: red\n---\n===\n");
  assert.equal(doc.nodes[0].headers["color"], "red");
});

test("hashtag extraction is lossless: #cool-tag keeps its hyphen", () => {
  const doc = parseYarn(node("text #cool-tag"));
  const [line] = doc.nodes[0].body;
  assert.equal(line.type, "Line");
  assert.equal((line as { text: string }).text, "text");
  assert.deepEqual((line as { tags?: string[] }).tags, ["cool-tag"]);
});

test("digit-start tags extract (#1st)", () => {
  const doc = parseYarn(node("text #1st"));
  const [line] = doc.nodes[0].body;
  assert.deepEqual((line as { tags?: string[] }).tags, ["1st"]);
  assert.equal((line as { text: string }).text, "text");
});

test("a tag with no whitespace before it still extracts (upstream TEXT_FRAG excludes #)", () => {
  const doc = parseYarn(node("text#tag"));
  const [line] = doc.nodes[0].body;
  assert.deepEqual((line as { tags?: string[] }).tags, ["tag"]);
  assert.equal((line as { text: string }).text, "text");
});

test("a tag attached after content extracts (upstream ProjectTests single-symbol lines)", () => {
  const doc = parseYarn(node("Hello#line:abc122"));
  const [line] = doc.nodes[0].body;
  assert.deepEqual((line as { tags?: string[] }).tags, ["line:abc122"]);
  assert.equal((line as { text: string }).text, "Hello");
});

test("an escaped \\# is NOT a hashtag (upstream ProjectTests escaped-hashtag lines)", () => {
  // The main-grammar escape `\#` unescapes to the literal `#` in the
  // composed text (upstream TextEscapedMode yields the bare character);
  // the point is that it never becomes a hashtag.
  const doc = parseYarn(
    node("This is a line with an embedded \\#hashtag in it."),
  );
  const [line] = doc.nodes[0].body;
  assert.equal(
    (line as { text: string }).text,
    "This is a line with an embedded #hashtag in it.",
  );
  assert.equal((line as { tags?: string[] }).tags, undefined);
});

test("multiple hashtags on one line all extract", () => {
  const doc = parseYarn(node("text #a #b-2"));
  const [line] = doc.nodes[0].body;
  assert.deepEqual((line as { tags?: string[] }).tags, ["a", "b-2"]);
});

test("<some command> warns YS0048 SingularCommandWrap", () => {
  const { diagnostics } = compileSource(node("<some command>"));
  const ys48 = diagnostics.filter((d) => d.code === "YS0048");
  assert.equal(ys48.length, 1, JSON.stringify(diagnostics));
  assert.equal(ys48[0].severity, "warning");
  assert.equal(
    ys48[0].message,
    "Line <some command> has single '<' and '>' wrapping it. Did you mean to make this a command?",
  );
});

test("<<wait 1>> followed by dialogue warns YS0019 (upstream YS0019 registry example)", () => {
  const { diagnostics } = compileSource(
    node("<<wait 1>> this is a line following a command"),
  );
  const ys19 = diagnostics.filter((d) => d.code === "YS0019");
  assert.equal(ys19.length, 1, JSON.stringify(diagnostics));
  assert.equal(ys19[0].severity, "warning");
  assert.equal(
    ys19[0].message,
    'Dialogue "this is a line following a command" content found following a command. Commands should be on their own line.',
  );
});

test("a command followed only by hashtags does not warn YS0019", () => {
  const { diagnostics } = compileSource(node("<<wait 1>> #color:red"));
  assert.ok(
    !diagnostics.some((d) => d.code === "YS0019"),
    JSON.stringify(diagnostics),
  );
});

test("empty <<>> reports 'Command text expected' as YS0005 (upstream TestEmptyCommand)", () => {
  const { program, diagnostics } = compileSource(node("<<>>"));
  assert.ok(!program, "an empty command must not compile");
  const errors = diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 1, JSON.stringify(diagnostics));
  assert.equal(errors[0].code, "YS0005");
  assert.ok(
    errors[0].message.includes("Command text expected"),
    errors[0].message,
  );
});
