// SPDX-License-Identifier: CC0-1.0
/**
 * Upstream-fidelity regression tests for ticket 13 (markup parity edges),
 * against the upstream 3.2.2 C# sources (test/fixtures/upstream/
 * YarnSpinner/YarnSpinner/YarnSpinner.Markup/):
 *
 * - duplicate property names in one tag throw during parse (upstream builds
 *   the attribute's property dictionary with Dictionary.Add, which throws
 *   on a repeated key — MarkupParseResult.cs, MarkupAttribute ctor);
 * - a string property whose only later quote is escaped parses: .NET's
 *   failed Regex.Match carries Index 0, so the lexer's fallback IndexOf
 *   lands on the escaped quote and terminates the string there
 *   (LineParser.cs, the string-value branch);
 * - the invalid-name diagnostic's range excludes the offending character
 *   (upstream slices `End - idToken.Start`, not the token Range —
 *   LineParser.cs, the [ ID ERROR branch);
 * - a `MarkupAttribute.Shift` equivalent is exported for marker-processor
 *   hosts (MarkupParseResult.cs, MarkupAttribute.Shift);
 * - plural/ordinal `%` substitution renders the number in the current
 *   culture (upstream `numericValue.ToString(CultureInfo.CurrentCulture)`
 *   in PluralReplace), while `select` stays invariant.
 */

import { test } from "node:test";
import { deepEqual, deepStrictEqual, equal, match, notEqual, ok, throws } from "node:assert";

import { LineParser, lexMarkup } from "../markup/lineParser.js";
import {
  getCurrentCulture,
  setCurrentCulture,
} from "../markup/builtInReplacer.js";
import { BuiltInMarkupReplacer } from "../markup/builtInReplacer.js";
import {
  StringBuilder,
  shiftAttribute,
  textForAttribute,
  type AttributeMarkerProcessor,
  type MarkupAttribute,
  type ReplacementMarkerResult,
} from "../markup/types.js";

// ── Duplicate property names ────────────────────────────────────────────

test("duplicate property names in one tag throw during parse, like upstream", () => {
  const parser = new LineParser();
  // Upstream: the MarkupAttribute constructor feeds the properties into a
  // Dictionary via Add, which throws ArgumentException on the repeat
  // ("An item with the same key has already been added.").
  throws(() => parser.parseString("[a p=1 p=2]text[/a]"), /same key has already been added/);
  throws(() => parser.parseString("[a p=1 p=2]text[/a]"), Error);
});

test("single-property tags are unaffected by the duplicate check", () => {
  const parser = new LineParser();
  const result = parser.parseString("[a p=1]text[/a]");
  equal(result.text, "text");
  equal(result.attributes.length, 1);
  equal(result.attributes[0].properties["p"].integerValue, 1);
});

test("property names compare case-sensitively for the duplicate check", () => {
  // Upstream's Dictionary<string, MarkupValue> uses the default
  // (case-sensitive ordinal) comparer: `p` and `P` coexist.
  const parser = new LineParser();
  const result = parser.parseString("[a p=1 P=2]text[/a]");
  equal(result.attributes.length, 1);
  equal(result.attributes[0].properties["p"].integerValue, 1);
  equal(result.attributes[0].properties["P"].integerValue, 2);
});

test("the duplicate-property failure is a throw, not a diagnostic", () => {
  const parser = new LineParser();
  // Upstream throws OUT of ParseString — no diagnostic is emitted for this.
  throws(() => parser.parseStringWithDiagnostics("[a p=1 p=2]text[/a]"));
});

// ── Escaped-quote string values ─────────────────────────────────────────

test("a string property whose only later quote is escaped parses", () => {
  // Upstream: the regex for the next unescaped quote fails, but .NET's
  // failed Match has Index 0, so the fallback IndexOf finds the ESCAPED
  // quote and terminates the string value there.
  const parser = new LineParser();
  const result = parser.parseStringWithDiagnostics('[p="a\\"]x[/p]');
  deepEqual(result.diagnostics, []);
  equal(result.markup.text, "x");
  equal(result.markup.attributes.length, 1);
  equal(result.markup.attributes[0].name, "p");
  equal(result.markup.attributes[0].properties["p"].stringValue, "a");
});

test("an escaped quote inside a properly closed string property composes", () => {
  const parser = new LineParser();
  const result = parser.parseStringWithDiagnostics('[p="a\\"b"]x[/p]');
  deepEqual(result.diagnostics, []);
  equal(result.markup.attributes[0].properties["p"].stringValue, 'a"b');
});

test("the lexer emits a string value, not an error, for an escaped-quote-terminated value", () => {
  // Upstream lexes `[p="a\"b]` with the string value spanning the escaped
  // quote (token at 3..6); the stray `b` is what trips the parser — not
  // the string value. (The checklist's "parses to a\"b" for this exact
  // input was a misread: the C# string terminates at the escaped quote,
  // so `p` composes as "a" and the bare `b` identifier raises
  // "Expected to find a property and it's value". The C# source is
  // authoritative — coding standards §1.)
  const tokens = lexMarkup('[p="a\\"b]');
  const valueTokens = tokens.filter((t) => t.type === "stringValue" || t.type === "error");
  equal(valueTokens.length, 1);
  equal(valueTokens[0].type, "stringValue");
  equal(valueTokens[0].start, 3);
  equal(valueTokens[0].end, 6);

  // And the parse fails on the stray identifier, exactly like upstream.
  const parser = new LineParser();
  const { markup, diagnostics } = parser.parseStringWithDiagnostics('[p="a\\"b]');
  ok(diagnostics.length > 0);
  match(diagnostics[0].message, /Expected to find a property and it's value/);
  equal(markup.text, '[p="a\\"b]');
});

// ── Invalid-name diagnostic range ───────────────────────────────────────

test("invalid-name diagnostic excludes the offending character", () => {
  // Upstream: `OG.Substring(idToken.Start, stream.LookAhead(2).End -
  // idToken.Start)` — the range stops BEFORE the error token's character,
  // unlike the token Range used elsewhere.
  const parser = new LineParser();
  const { diagnostics } = parser.parseStringWithDiagnostics("[invalid.name]normal text[/invalid.name]");
  const diag = diagnostics.filter((d) => d.message.startsWith("Error parsing markup, invalid name:"));
  equal(diag.length, 1);
  equal(diag[0].message, 'Error parsing markup, invalid name: "invalid"');
  equal(diag[0].column, 1);
});

// ── MarkupAttribute shift equivalent ────────────────────────────────────

test("shiftAttribute shifts the position and copies the attribute", () => {
  const attribute: MarkupAttribute = {
    position: 4,
    sourcePosition: 9,
    length: 3,
    name: "em",
    properties: { pause: { type: "integer", integerValue: 500, floatValue: 0, stringValue: "", boolValue: false } },
  };
  const shifted = shiftAttribute(attribute, 6);
  equal(shifted.position, 10);
  equal(shifted.sourcePosition, 9);
  equal(shifted.length, 3);
  equal(shifted.name, "em");
  deepStrictEqual(shifted.properties, attribute.properties);
  notEqual(shifted.properties, attribute.properties);
  // The original is untouched.
  equal(attribute.position, 4);
});

test("a marker processor can shift its child attributes after inserting text", () => {
  // Upstream's processor contract: "it is up to you to fix any attributes
  // if you modify them" — Shift is the tool. A processor that inserts a
  // prefix must shift its children's positions or they point into the
  // prefix.
  class PrefixingReplacer implements AttributeMarkerProcessor {
    processReplacementMarker(
      _marker: MarkupAttribute,
      childBuilder: StringBuilder,
      childAttributes: MarkupAttribute[],
    ): ReplacementMarkerResult {
      const prefix = "<wrap>";
      childBuilder.insert(0, prefix);
      for (const child of childAttributes) {
        Object.assign(child, shiftAttribute(child, prefix.length));
      }
      return { diagnostics: [], invisibleCharacters: 0 };
    }
  }

  const parser = new LineParser();
  parser.registerMarkerProcessor("wrap", new PrefixingReplacer());
  const result = parser.parseString("[wrap]say [loud]hey[/loud] now[/wrap]");
  equal(result.text, "<wrap>say hey now");

  const loud = result.attributes.find((a) => a.name === "loud");
  ok(loud);
  equal(loud.position, 10);
  equal(textForAttribute(result, loud), "hey");
});

// ── `%` substitution culture ────────────────────────────────────────────

test("plural % substitution renders in the current culture, comma-decimal", () => {
  // Upstream: `numericValue.ToString(CultureInfo.CurrentCulture)` — a
  // comma-decimal current culture composes "2,5", regardless of the line's
  // locale code.
  const parser = new LineParser();
  parser.registerMarkerProcessor("plural", new BuiltInMarkupReplacer());
  const previous = getCurrentCulture();
  setCurrentCulture("de-DE");
  try {
    const markup = parser.parseString('[plural value=2.5 other="% cats"/]', "en", {
      addImplicitCharacterAttribute: false,
    });
    equal(markup.text, "2,5 cats");
  } finally {
    setCurrentCulture(previous);
  }
});

test("ordinal % substitution also renders in the current culture", () => {
  const parser = new LineParser();
  parser.registerMarkerProcessor("ordinal", new BuiltInMarkupReplacer());
  const previous = getCurrentCulture();
  setCurrentCulture("de-DE");
  try {
    // Upstream formats the % number with CurrentCulture in PluralReplace,
    // which ordinal shares — so a comma-decimal current culture composes
    // "2,5th" for 2.5 (and integers render identically in every culture,
    // which is why the integer ordinal cases upstream tests never show
    // the difference). Quirky, but that is the upstream behavior —
    // parity, not improvement.
    const markup = parser.parseString('[ordinal value=2.5 one="%st" two="%nd" other="%th"/]', "en", {
      addImplicitCharacterAttribute: false,
    });
    equal(markup.text, "2,5th");
  } finally {
    setCurrentCulture(previous);
  }
});

test("select stays culture-invariant", () => {
  // Upstream SelectReplace stringifies the replacement value with
  // CultureInfo.InvariantCulture and substitutes it for `%` — a
  // comma-decimal current culture must not leak in.
  const parser = new LineParser();
  parser.registerMarkerProcessor("select", new BuiltInMarkupReplacer());
  const previous = getCurrentCulture();
  setCurrentCulture("de-DE");
  try {
    const markup = parser.parseString('[select value="de" de="%."/]', "en", {
      addImplicitCharacterAttribute: false,
    });
    equal(markup.text, "de.");
  } finally {
    setCurrentCulture(previous);
  }
});

test("the default current culture is the host environment's locale", () => {
  // With no host override the current culture is `undefined` — the JS
  // runtime default, the analogue of .NET's process CurrentCulture.
  const previous = getCurrentCulture();
  setCurrentCulture(undefined);
  try {
    equal(getCurrentCulture(), undefined);
    const parser = new LineParser();
    parser.registerMarkerProcessor("plural", new BuiltInMarkupReplacer());
    const markup = parser.parseString('[plural value=2.5 other="% cats"/]', "en", {
      addImplicitCharacterAttribute: false,
    });
    // Under the suite's (dot-decimal) host locale this is dot-decimal; the
    // point is the rendering went through the culture-sensitive path.
    ok(markup.text.endsWith(" cats"));
    match(markup.text, /^2[.,]5 cats$/);
  } finally {
    setCurrentCulture(previous);
  }
});

test("StringBuilder insert and append stay available to processors", () => {
  const builder = new StringBuilder();
  builder.append("abc");
  builder.insert(0, "x");
  builder.append("d");
  equal(builder.toString(), "xabcd");
});
