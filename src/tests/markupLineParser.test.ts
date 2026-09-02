/**
 * Ported upstream markup tests (upstream `YarnSpinner.Tests/MarkupTests.cs`
 * at tag 3.2.2), run against the runtime line-parser module directly — the
 * fixture corpus has no markup coverage (ticket 48, spec seam 2).
 *
 * Upstream tests are MIT-licensed (© Secret Lab Pty. Ltd. and Yarn Spinner
 * contributors); assertions mirror the upstream cases with node:test.
 */

import { test } from "node:test";
import { deepEqual, deepStrictEqual, equal, notEqual, ok, match } from "node:assert";

import {
  BuiltInMarkupReplacer,
  languageSubtag,
} from "../markup/builtInReplacer.js";
import {
  LineParser,
  type LexerToken,
  type MarkupTreeNode,
} from "../markup/lineParser.js";
import {
  StringBuilder,
  deleteRange,
  textForAttribute,
  tryGetAttributeWithName,
  type AttributeMarkerProcessor,
  type MarkupAttribute,
  type ReplacementMarkerResult,
} from "../markup/types.js";

// ── Upstream test processors (MarkupTests' IAttributeMarkerProcessor
//    implementations) ─────────────────────────────────────────────────────

/** Wraps children in `<tag>...</tag>`; reports the wrapper lengths as invisible. */
class BBCodeChevronReplacer implements AttributeMarkerProcessor {
  constructor(private readonly tag: string) {}

  processReplacementMarker(
    marker: MarkupAttribute,
    childBuilder: StringBuilder,
    _childAttributes: MarkupAttribute[],
  ): ReplacementMarkerResult {
    if (marker.name !== this.tag) {
      return {
        diagnostics: [
          { message: `Asked to replace ${marker.name} but this only handles ${this.tag} markers.`, column: -1 },
        ],
        invisibleCharacters: 0,
      };
    }
    childBuilder.insert(0, `<${this.tag}>`);
    childBuilder.append(`</${this.tag}>`);
    return { diagnostics: [], invisibleCharacters: 5 + this.tag.length * 2 };
  }
}

/** The MarkupTests inline processor: bold/italics/blocky/wacky/localise/scr. */
class MarkupTestsReplacer implements AttributeMarkerProcessor {
  processReplacementMarker(
    marker: MarkupAttribute,
    childBuilder: StringBuilder,
    childAttributes: MarkupAttribute[],
  ): ReplacementMarkerResult {
    switch (marker.name) {
      case "bold":
        childBuilder.insert(0, "<b>");
        childBuilder.append("</b>");
        return { diagnostics: [], invisibleCharacters: 7 };
      case "italics":
        childBuilder.insert(0, "<i>");
        childBuilder.append("</i>");
        return { diagnostics: [], invisibleCharacters: 7 };
      case "blocky": {
        childBuilder.insert(0, "[");
        childBuilder.append("]");
        for (let i = 0; i < childAttributes.length; i++) {
          childAttributes[i] = shiftAttribute(childAttributes[i], 1);
        }
        return { diagnostics: [], invisibleCharacters: 0 };
      }
      case "wacky": {
        childBuilder.insert(0, "<b>[");
        childBuilder.append("]</b>");
        for (let i = 0; i < childAttributes.length; i++) {
          childAttributes[i] = shiftAttribute(childAttributes[i], 1);
        }
        return { diagnostics: [], invisibleCharacters: 7 };
      }
      case "localise":
        childBuilder.append("cat"); // locale handled by dedicated test below
        return { diagnostics: [], invisibleCharacters: 0 };
      case "scr":
        childBuilder.append("scr");
        return { diagnostics: [], invisibleCharacters: 0 };
      default:
        childBuilder.append("Unrecognised markup name: ");
        childBuilder.append(marker.name);
        return { diagnostics: [], invisibleCharacters: 0 };
    }
  }
}

/** Upstream `MarkupAttribute.Shift`. */
function shiftAttribute(attribute: MarkupAttribute, shift: number): MarkupAttribute {
  return { ...attribute, position: attribute.position + shift };
}

/** An `IAttributeMarkerProcessor` that uppercases its children (upstream `MarkerUppercaseReplacer`). */
class MarkerUppercaseReplacer implements AttributeMarkerProcessor {
  processReplacementMarker(
    marker: MarkupAttribute,
    childBuilder: StringBuilder,
    childAttributes: MarkupAttribute[],
  ): ReplacementMarkerResult {
    const contents = childBuilder.toString();
    childBuilder.clear();
    childBuilder.append(contents.toUpperCase());
    childAttributes.push(marker);
    return { diagnostics: [], invisibleCharacters: 0 };
  }
}

/** A `localise` processor matching the upstream test's en/fr behavior. */
class LocaliseReplacer implements AttributeMarkerProcessor {
  processReplacementMarker(
    _marker: MarkupAttribute,
    childBuilder: StringBuilder,
    _childAttributes: MarkupAttribute[],
    localeCode: string,
  ): ReplacementMarkerResult {
    childBuilder.append(localeCode === "en" ? "cat" : "chat");
    return { diagnostics: [], invisibleCharacters: 0 };
  }
}

// ── Lexer ───────────────────────────────────────────────────────────────

interface LexerCase {
  input: string;
  types: string[];
  texts: string[];
}

const lexerCases: LexerCase[] = [
  {
    input: "this is a line with [markup]a single markup[/markup] inside of it",
    types: ["text", "openMarker", "identifier", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "]", "a single markup", "[", "/", "markup", "]", " inside of it"],
  },
  {
    input: "this is a line with [markup = 1]a single markup[/markup] inside of it",
    types: ["text", "openMarker", "identifier", "equals", "numberValue", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "=", "1", "]", "a single markup", "[", "/", "markup", "]", " inside of it"],
  },
  {
    input: "this is a line with [markup=12]a single markup[/markup] inside of it",
    types: ["text", "openMarker", "identifier", "equals", "numberValue", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "=", "12", "]", "a single markup", "[", "/", "markup", "]", " inside of it"],
  },
  {
    input: 'this is a line with [markup = "12" ]a single markup[/markup] inside of it',
    types: ["text", "openMarker", "identifier", "equals", "stringValue", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "=", '"12"', "]", "a single markup", "[", "/", "markup", "]", " inside of it"],
  },
  {
    input: "this is a line with [markup=hello]a single markup[/markup] inside of it",
    types: ["text", "openMarker", "identifier", "equals", "stringValue", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "=", "hello", "]", "a single markup", "[", "/", "markup", "]", " inside of it"],
  },
  {
    input: "this is a line with [markup=true]a single markup[/markup] inside of it",
    types: ["text", "openMarker", "identifier", "equals", "booleanValue", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "=", "true", "]", "a single markup", "[", "/", "markup", "]", " inside of it"],
  },
  {
    input: "this is a line with [markup=false var = 12]a single markup[/markup] inside of it",
    types: ["text", "openMarker", "identifier", "equals", "booleanValue", "identifier", "equals", "numberValue", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "=", "false", "var", "=", "12", "]", "a single markup", "[", "/", "markup", "]", " inside of it"],
  },
  {
    input: "this is a line with [markup=false var = 12]two [markup2]markup[/] inside of it",
    types: ["text", "openMarker", "identifier", "equals", "booleanValue", "identifier", "equals", "numberValue", "closeMarker", "text", "openMarker", "identifier", "closeMarker", "text", "openMarker", "closeSlash", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "=", "false", "var", "=", "12", "]", "two ", "[", "markup2", "]", "markup", "[", "/", "]", " inside of it"],
  },
  {
    input: "this is a line with \\[markup=false var = 12]two [markup2]markup[/] inside of it",
    types: ["text", "openMarker", "identifier", "closeMarker", "text", "openMarker", "closeSlash", "closeMarker", "text"],
    texts: ["this is a line with \\[markup=false var = 12]two ", "[", "markup2", "]", "markup", "[", "/", "]", " inside of it"],
  },
  {
    input: "this is a line with [markup markup = 1]a single markup[/markup] inside of it",
    types: ["text", "openMarker", "identifier", "identifier", "equals", "numberValue", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "markup", "markup", "=", "1", "]", "a single markup", "[", "/", "markup", "]", " inside of it"],
  },
  {
    input: "this is a line with [interpolated markup = {$property} /] inside",
    types: ["text", "openMarker", "identifier", "identifier", "equals", "interpolatedValue", "closeSlash", "closeMarker", "text"],
    texts: ["this is a line with ", "[", "interpolated", "markup", "=", "{$property}", "/", "]", " inside"],
  },
  {
    input: "á [a]S[/a]",
    types: ["text", "openMarker", "identifier", "closeMarker", "text", "openMarker", "closeSlash", "identifier", "closeMarker"],
    texts: ["á ", "[", "a", "]", "S", "[", "/", "a", "]"],
  },
  {
    input: "start [markup=-1 /] end",
    types: ["text", "openMarker", "identifier", "equals", "numberValue", "closeSlash", "closeMarker", "text"],
    texts: ["start ", "[", "markup", "=", "-1", "/", "]", " end"],
  },
  {
    input: "start [markup=-1.0 /] end",
    types: ["text", "openMarker", "identifier", "equals", "numberValue", "closeSlash", "closeMarker", "text"],
    texts: ["start ", "[", "markup", "=", "-1.0", "/", "]", " end"],
  },
];

test("lexer generates correct tokens", () => {
  const parser = new LineParser();
  for (const { input, types, texts } of lexerCases) {
    const tokens = parser.lexMarkup(input);
    // Removing the start and end tokens.
    tokens.splice(0, 1);
    tokens.splice(tokens.length - 1, 1);

    equal(tokens.length, types.length, `token count for ${input}`);
    for (let i = 0; i < types.length; i++) {
      equal(tokens[i].type, types[i], `token ${i} type for ${input}`);
    }
    for (let i = 0; i < texts.length; i++) {
      const text = input.slice(tokens[i].start, tokens[i].end + 1);
      equal(text, texts[i], `token ${i} text for ${input}`);
    }
  }
});

test("nomarkup in lexer consumes tokens", () => {
  const line = 'this is a line with [nomarkup]bunch[ /] a = 2 of " [tag /] [anothertag]invalid shit[/anothertag] yes[/nomarkup]';
  const parser = new LineParser();
  const tokens = parser.lexMarkup(line);
  tokens.splice(0, 1);
  tokens.splice(tokens.length - 1, 1);

  const types = [
    "text", "openMarker", "identifier", "closeMarker", "text",
    "openMarker", "closeSlash", "closeMarker", "text",
    "openMarker", "identifier", "closeSlash", "closeMarker", "text",
    "openMarker", "identifier", "closeMarker", "text",
    "openMarker", "closeSlash", "identifier", "closeMarker", "text",
    "openMarker", "closeSlash", "identifier", "closeMarker",
  ];
  equal(tokens.length, types.length);
  for (let i = 0; i < types.length; i++) {
    equal(tokens[i].type, types[i], `token ${i}`);
  }
});

// ── Unsquished trees ────────────────────────────────────────────────────

function descendant(root: MarkupTreeNode, ...children: number[]): MarkupTreeNode {
  let current = root;
  for (const child of children) {
    ok(current.children.length > child, `expected child ${child} to exist`);
    current = current.children[child];
  }
  return current;
}

test("unsquished tree with single child is valid", () => {
  const line = "this is a line with [markup]a single markup[/markup] inside of it";
  const parser = new LineParser();
  const tokens = parser.lexMarkup(line);
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(tokens, line);

  equal(tree.children.length, 3);
  equal(tree.children[1].children.length, 1);
  equal(diagnostics.length, 0);
});

test("unsquished tree with self-close markup is valid", () => {
  const line = "this is a line with [markup /]a single self-closing markup inside of it";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(tree.children.length, 3);
  equal(tree.children[1].children.length, 0);
  equal(diagnostics.length, 0);
});

test("unsquished tree with nested markup is valid", () => {
  const line = "this is a line with [markup]a [inner]nested[/inner] markup[/markup] inside of it";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(tree.children.length, 3);
  equal(tree.children[1].children.length, 3);
  equal(descendant(tree, 1, 1).children.length, 1);
  notEqual(descendant(tree, 1, 1, 0).text, null);
  equal(diagnostics.length, 0);
});

test("unsquished tree with single child and self properties is valid", () => {
  const line = "this is a line with [markup = 1]a single markup[/markup] inside of it";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  equal(tree.children.length, 3);
  equal(tree.children[1].children.length, 1);
  equal(tree.children[1].properties.length, 1);
  equal(tree.children[1].properties[0].value.integerValue, 1);
  equal(tree.children[1].properties[0].name, "markup");
});

test("unsquished tree with single child and non-self property is valid", () => {
  const line = "this is a line with [markup markup = 1]a single markup[/markup] inside of it";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  equal(tree.children.length, 3);
  equal(tree.children[1].properties.length, 1);
  equal(tree.children[1].properties[0].value.integerValue, 1);
  equal(tree.children[1].properties[0].name, "markup");
});

test("unsquished tree with multiple non-self properties is valid", () => {
  const line = "this is a line with [markup markup = 1 markup = 2]a single markup[/markup] inside of it";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  equal(tree.children[1].properties.length, 2);
  equal(tree.children[1].properties[0].value.integerValue, 1);
  equal(tree.children[1].properties[1].value.integerValue, 2);
});

test("unsquished tree with multiple non-self properties of multiple types is valid", () => {
  const line = 'this is a line with [markup markup = 1 markup = markup markup = true markup = 1.1 markup = "markup"]a single markup[/markup] inside of it';
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  const properties = tree.children[1].properties;
  equal(properties.length, 5);
  equal(properties[0].name, "markup");
  equal(properties[0].value.integerValue, 1);
  equal(properties[1].name, "markup");
  equal(properties[1].value.stringValue, "markup");
  equal(properties[2].name, "markup");
  equal(properties[2].value.boolValue, true);
  equal(properties[3].name, "markup");
  equal(properties[3].value.floatValue, 1.1);
  equal(properties[4].name, "markup");
  equal(properties[4].value.stringValue, "markup");
});

test("unsquished tree with self-closing and self property is valid", () => {
  const line = "this is a line with [markup = 1 /]a single self-closing markup inside of it";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  equal(tree.children[1].children.length, 0);
  equal(tree.children[1].properties.length, 2);
  equal(tree.children[1].properties[0].name, "markup");
  equal(tree.children[1].properties[0].value.integerValue, 1);
});

test("unsquished tree with self-closing and non-self property is valid", () => {
  const line = "this is a line with [markup markup = 1 /]a single self-closing markup inside of it";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  equal(tree.children[1].properties.length, 2);
  equal(tree.children[1].properties[0].value.integerValue, 1);
});

test("unsquished tree with nomarkup allows invalid characters", () => {
  const line = 'this is a line with [nomarkup]bunch[ /] a = 2 of " [tag /] [anothertag]invalid shit[/anothertag] yes[/nomarkup]';
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  equal(tree.children.length, 2);
  equal(tree.children[1].children.length, 1);
  equal(
    descendant(tree, 1, 0).text,
    'bunch[ /] a = 2 of " [tag /] [anothertag]invalid shit[/anothertag] yes',
  );
});

test("unsquished nested markup is valid", () => {
  const line = "This is [outer][inner]some [inmost /]nested[/inner][/outer] markup";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  equal(tree.children.length, 3);
});

test("unsquished imbalanced markup is valid when imbalance occurs at end of line", () => {
  const line = "start[a]ab[b]bc[c]cb[/b][/c][/a]";
  const parser = new LineParser();
  const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);

  equal(diagnostics.length, 0);
  equal(tree.children.length, 2);
  equal(descendant(tree, 1).children.length, 2);
  equal(descendant(tree, 1, 0).text, "ab");
  equal(descendant(tree, 1, 1).children.length, 2);
  equal(descendant(tree, 1, 1, 0).text, "bc");
  equal(descendant(tree, 1, 1, 1).children.length, 1);
  equal(descendant(tree, 1, 1, 1, 0).text, "cb");
});

test("unsquished imbalanced markup with excess close is invalid", () => {
  const line = "start[a]ab[b]bc[c]cb[/b][/c][/a][/d]";
  const parser = new LineParser();
  const { diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);
  equal(diagnostics.length, 1);
});

test("unsquished imbalanced markup with excess close and open is invalid", () => {
  const line = "start[a]ab[b]bc[c]cb[/b][/c][/d]";
  const parser = new LineParser();
  const { diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);
  equal(diagnostics.length, 1);
});

test("unclosed markup is invalid", () => {
  const line = "start[a]end";
  const parser = new LineParser();
  const { diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);
  equal(diagnostics.length, 1);
});

test("unopened markup is invalid", () => {
  const line = "end[/a]";
  const parser = new LineParser();
  const { diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);
  equal(diagnostics.length, 1);
});

// ── Tree shapes (the rebalancing cases) ─────────────────────────────────

interface TreeComparison {
  text?: string;
  name?: string;
  children: TreeComparison[];
}

function node(name: string | null, ...children: TreeComparison[]): TreeComparison {
  return { name: name ?? undefined, children };
}
function text(value: string): TreeComparison {
  return { text: value, children: [] };
}

function compareWalk(left: MarkupTreeNode, right: TreeComparison): void {
  const leftIsText = left.text !== null;
  const rightIsText = right.text !== undefined;
  equal(leftIsText, rightIsText);
  if (leftIsText && rightIsText) {
    equal(left.text, right.text);
    return;
  }
  equal(left.name, right.name);
  equal(left.children.length, right.children.length);
  for (let i = 0; i < left.children.length; i++) {
    compareWalk(left.children[i], right.children[i]);
  }
}

const treeShapes: Array<[string, TreeComparison]> = [
  [
    "This [a] is [b] some [c] nested [/a] markup [/c] with [/b] invalid structure.",
    node(null, text("This "),
      node("a", text(" is "), node("b", text(" some "), node("c", text(" nested ")))),
      node("b", node("c", text(" markup ")), text(" with ")),
      text(" invalid structure.")),
  ],
  [
    "This [outer] is [inner] some [/outer] invalid [/inner] markup",
    node(null, text("This "),
      node("outer", text(" is "), node("inner", text(" some "))),
      node("inner", text(" invalid ")),
      text(" markup")),
  ],
  [
    "This [outer] is [inner] some [/outer][/inner] markup",
    node(null, text("This "),
      node("outer", text(" is "), node("inner", text(" some "))),
      text(" markup")),
  ],
  [
    "[z] this [a] is [b] some [c] markup [d] with [e] both [/c][/e][/d][/z][/a] misclosed tags and double unclosable tags[/b]",
    node(null,
      node("z", text(" this "),
        node("a", text(" is "),
          node("b", text(" some "),
            node("c", text(" markup "),
              node("d", text(" with "), node("e", text(" both "))))))),
      node("b", text(" misclosed tags and double unclosable tags"))),
  ],
  [
    "[a]This is [b]some [c]markup[/b] with[/c] closing tag issues inside a valid tag[/a]",
    node(null,
      node("a",
        text("This is "),
        node("b", text("some "), node("c", text("markup"))),
        node("c", text(" with")),
        text(" closing tag issues inside a valid tag"))),
  ],
  [
    "[a][b]1 [c][X]2[/b] [d]3[/X][/c] 4[/d] [e]5[/e][/a]",
    node(null,
      node("a",
        node("b", text("1 "), node("c", node("X", text("2")))),
        node("c", node("X", text(" "), node("d", text("3")))),
        node("d", text(" 4")),
        text(" "),
        node("e", text("5")))),
  ],
];

for (const [line, comparison] of treeShapes) {
  test(`unsquished tree conforms to expected shape: ${line.slice(0, 40)}`, () => {
    const parser = new LineParser();
    const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(parser.lexMarkup(line), line);
    equal(diagnostics.length, 0);
    compareWalk(tree, comparison);
  });
}

// ── Walked strings with rewriters ───────────────────────────────────────

const unsquishedRewriterCases: Array<[string, string]> = [
  ["this is line without markup", "this is line without markup"],
  ["[a]this is line with basic markup[/a]", "this is line with basic markup"],
  ["[a]this is line with [b]nested basic[/b] markup[/a]", "this is line with nested basic markup"],
  ["this is a[nomarkup] line with [b]nomarkup hiding[/b] markup[/nomarkup] elements", "this is a line with [b]nomarkup hiding[/b] markup elements"],
  ["This is a [bold]line testing basic[/bold] replacement markers", "This is a <b>line testing basic</b> replacement markers"],
  ["[a]This is [b]some [c]markup[/b] with[/c] closing tag issues inside a valid tag[/a]", "This is some markup with closing tag issues inside a valid tag"],
];

test("unsquished markup strings with rewriters are valid", () => {
  for (const [line, comparison] of unsquishedRewriterCases) {
    const parser = new LineParser();
    parser.registerMarkerProcessor("bold", new MarkupTestsReplacer());
    const tokens = parser.lexMarkup(line);
    const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(tokens, line);
    equal(diagnostics.length, 0);

    const builder = new StringBuilder();
    const attributes: MarkupAttribute[] = [];
    const diagnostics2: import("../markup/types.js").MarkupDiagnostic[] = [];
    parser.walkAndProcessTree(tree, builder, attributes, "en", diagnostics2);

    equal(diagnostics2.length, 0);
    equal(builder.toString(), comparison);
  }
});

const squishedRewriterCases: Array<[string, string, number]> = [
  ["this is line without markup", "this is line without markup", 0],
  ["[a]this is line with basic markup[/a]", "this is line with basic markup", 1],
  ["[a]this is line with [b]nested basic[/b] markup[/a]", "this is line with nested basic markup", 2],
  ["this is a[nomarkup] line with [b]nomarkup hiding[/b] markup[/nomarkup] elements", "this is a line with [b]nomarkup hiding[/b] markup elements", 1],
  ["This is a [bold]line testing basic[/bold] replacement markers", "This is a <b>line testing basic</b> replacement markers", 0],
  ["[a]This is [b]some [c]markup[/b] with[/c] closing tag issues inside a valid tag[/a]", "This is some markup with closing tag issues inside a valid tag", 3],
];

test("squished markup strings with rewriters are valid", () => {
  for (const [line, comparison, attributeCount] of squishedRewriterCases) {
    const parser = new LineParser();
    parser.registerMarkerProcessor("bold", new MarkupTestsReplacer());
    const tokens = parser.lexMarkup(line);
    const { tree, diagnostics } = parser.buildMarkupTreeFromTokens(tokens, line);
    equal(diagnostics.length, 0);

    const builder = new StringBuilder();
    const attributes: MarkupAttribute[] = [];
    const diagnostics2: import("../markup/types.js").MarkupDiagnostic[] = [];
    parser.walkAndProcessTree(tree, builder, attributes, "en", diagnostics2);

    equal(diagnostics2.length, 0);
    equal(builder.toString(), comparison);
    LineParser.squishSplitAttributes(attributes);
    equal(attributes.length, attributeCount, `attribute count for ${line}`);
  }
});

// ── Invisible characters ────────────────────────────────────────────────

const invisibleCharacterCases: Array<[string, string, string[], number[]]> = [
  ["this is a line with non-replacement[a/]  markup", "this is a line with non-replacement markup", ["a"], [35]],
  ["this is a line [bold]with some replacement[/bold] markup and a non-replacement[a/]  markup", "this is a line <b>with some replacement</b> markup and a non-replacement markup", ["a"], [65]],
  ["this is a [bold]line with some [italics]nested[a trimwhitespace=false /] tags[/italics][b trimwhitespace=false /][/bold] in[c trimwhitespace=false /] it", "this is a <b>line with some <i>nested tags</i></b> in it", ["a", "b", "c"], [31, 36, 39]],
  ["this is a line with [blocky]markup[/blocky] that actually has[a trimwhitespace=false /] visible characters", "this is a line with [markup] that actually has visible characters", ["a"], [46]],
  ["this is a line with [wacky]markup[/wacky] that actually has[a trimwhitespace=false /] both", "this is a line with <b>[markup]</b> that actually has both", ["a"], [46]],
  ["this is a line with [wacky]internal[a trimwhitespace=false /] both[/wacky] markup", "this is a line with <b>[internal both]</b> markup", ["a"], [29]],
  ["this is a [wacky]line with some [blocky]nested[a trimwhitespace=false /] tags[/blocky][b trimwhitespace=false /][/wacky] in[c trimwhitespace=false /] it", "this is a <b>[line with some [nested tags]]</b> in it", ["a", "b", "c"], [33, 39, 43]],
];

test("squished markup strings with invisible characters are valid", () => {
  for (const [line, comparison, markerNames, positions] of invisibleCharacterCases) {
    const parser = new LineParser();
    for (const name of ["bold", "italics", "blocky", "wacky"]) {
      parser.registerMarkerProcessor(name, new MarkupTestsReplacer());
    }

    const { markup, diagnostics } = parser.parseStringWithDiagnostics(line, "en");

    equal(diagnostics.length, 0);
    equal(markup.text, comparison);
    equal(markup.attributes.length, markerNames.length, `attribute count for ${line}`);

    for (let i = 0; i < markerNames.length; i++) {
      const attribute = tryGetAttributeWithName(markup, markerNames[i]);
      ok(attribute, `expected attribute ${markerNames[i]} in ${line}`);
      equal(attribute.position, positions[i], `position of ${markerNames[i]} in ${line}`);
    }
  }
});

// ── Localised replacement ───────────────────────────────────────────────

test("localised string replacement", () => {
  const line = "This is my pet [localise = cat /], [b]Pumpkin![/b]";
  const parser = new LineParser();
  parser.registerMarkerProcessor("localise", new LocaliseReplacer());

  const en = parser.parseStringWithDiagnostics(line, "en");
  equal(en.diagnostics.length, 0);
  equal(en.markup.text, "This is my pet cat, Pumpkin!");
  LineParser.squishSplitAttributes(en.markup.attributes);
  equal(en.markup.attributes.length, 1);

  const fr = parser.parseStringWithDiagnostics(line, "fr");
  equal(fr.diagnostics.length, 0);
  equal(fr.markup.text, "This is my pet chat, Pumpkin!");
  LineParser.squishSplitAttributes(fr.markup.attributes);
  equal(fr.markup.attributes.length, 1);
});

// ── Ranges ──────────────────────────────────────────────────────────────

const rangeComparisons: Array<{ line: string; comparison: string; expectedAttributes: number; ranges: Record<string, [number, number]> }> = [
  {
    line: "[a]this is line with basic markup[/a]",
    comparison: "this is line with basic markup",
    expectedAttributes: 1,
    ranges: { a: [0, 30] },
  },
  {
    line: "[a]this is line with [b]nested basic[/b] markup[/a]",
    comparison: "this is line with nested basic markup",
    expectedAttributes: 2,
    ranges: { a: [0, 37], b: [18, 12] },
  },
  {
    line: "[a]This is [b]some [c]markup[/b] with[/c] closing tag issues inside a valid tag[/a]",
    comparison: "This is some markup with closing tag issues inside a valid tag",
    expectedAttributes: 3,
    ranges: { a: [0, 62], b: [8, 11], c: [13, 11] },
  },
  {
    line: "this[z] here[a] is[b] some[c] markup[d] with[e] both[/c][/e][/d][/a][/z] misclosed tags and double unclosable tags[/b]",
    comparison: "this here is some markup with both misclosed tags and double unclosable tags",
    expectedAttributes: 6,
    ranges: { z: [4, 30], a: [9, 25], c: [17, 17], d: [24, 10], e: [29, 5], b: [12, 64] },
  },
  {
    line: "[a][b]1 [c][X]2[/b] [d]3[/X][/c] 4[/d] [e]5[/e][/a]",
    comparison: "1 2 3 4 5",
    expectedAttributes: 6,
    ranges: { a: [0, 9], b: [0, 3], c: [2, 3], X: [2, 3], d: [4, 3], e: [8, 1] },
  },
];

test("squished ranges are valid", () => {
  for (const { line, comparison, expectedAttributes, ranges } of rangeComparisons) {
    const parser = new LineParser();
    parser.registerMarkerProcessor("bold", new MarkupTestsReplacer());
    const { markup, diagnostics } = parser.parseStringWithDiagnostics(line, "en", { addImplicitCharacterAttribute: false });

    equal(diagnostics.length, 0);
    equal(markup.text, comparison);
    equal(markup.attributes.length, expectedAttributes, `attribute count for ${line}`);

    for (const attribute of markup.attributes) {
      const comparisonRange = ranges[attribute.name];
      ok(comparisonRange, `expected a range for ${attribute.name}`);
      equal(attribute.length, comparisonRange[1], `length of ${attribute.name} in ${line}`);
      equal(attribute.position, comparisonRange[0], `position of ${attribute.name} in ${line}`);
    }
  }
});

// ── Parse result behaviors ──────────────────────────────────────────────

test("overlapping attributes", () => {
  const line = "[a][b][c]X[/b][/a]X[/c]";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  equal(markup.attributes.length, 3);
  equal(markup.attributes[0].name, "a");
  equal(markup.attributes[1].name, "b");
  equal(markup.attributes[2].name, "c");
});

test("text extraction", () => {
  const line = "A [b]B [c]C[/c][/b]";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  equal(textForAttribute(markup, markup.attributes[0]), "B C");
  equal(textForAttribute(markup, markup.attributes[1]), "C");
});

test("attribute removal", () => {
  const line = "[a][b]A [c][X]x[/b] [d]x[/X][/c] B[/d] [e]C[/e][/a]";
  const parser = new LineParser();
  const originalMarkup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  const xAttribute = tryGetAttributeWithName(originalMarkup, "X");
  ok(xAttribute);
  const trimmedMarkup = deleteRange(originalMarkup, xAttribute);

  equal(originalMarkup.text, "A x x B C");
  equal(originalMarkup.attributes.length, 6);

  equal(trimmedMarkup.text, "A  B C");
  equal(trimmedMarkup.attributes.length, 4);

  equal(trimmedMarkup.attributes[0].name, "a");
  equal(trimmedMarkup.attributes[0].position, 0);
  equal(trimmedMarkup.attributes[0].length, 6);

  equal(trimmedMarkup.attributes[1].name, "b");
  equal(trimmedMarkup.attributes[1].position, 0);
  equal(trimmedMarkup.attributes[1].length, 2);

  // "c" was removed along with "X": it had a length of >0 before deletion
  // and was reduced to zero characters.

  equal(trimmedMarkup.attributes[2].name, "d");
  equal(trimmedMarkup.attributes[2].position, 2);
  equal(trimmedMarkup.attributes[2].length, 2);

  equal(trimmedMarkup.attributes[3].name, "e");
  equal(trimmedMarkup.attributes[3].position, 5);
  equal(trimmedMarkup.attributes[3].length, 1);
});

test("finding attributes", () => {
  const line = "A [b]B[/b] [b]C[/b]";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  const attribute = tryGetAttributeWithName(markup, "b");
  ok(attribute);
  deepEqual(markup.attributes[0], attribute);
  notEqual(markup.attributes[1], attribute);

  equal(tryGetAttributeWithName(markup, "c"), undefined);
});

const multibyteCases = [
  "á [á]S[/á]",
  "á [a]á[/a]",
  "á [a]S[/a]",
  "S [á]S[/á]",
  "S [a]á[/a]",
  "S [a]S[/a]",
];

test("multibyte character parsing", () => {
  for (const input of multibyteCases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en", { addImplicitCharacterAttribute: false });

    equal(markup.attributes.length, 1, `one attribute for ${input}`);
    equal(markup.attributes[0].position, 2, `position for ${input}`);
    equal(markup.attributes[0].length, 1, `length for ${input}`);
  }
});

test("multibyte character parsing with implicit character attributes", () => {
  const cases = ["á: [á]S[/á]", "á: [a]á[/a]", "á: [a]S[/a]", "S: [á]S[/á]", "S: [a]á[/a]", "S: [a]S[/a]"];
  for (const input of cases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en");

    equal(markup.attributes.length, 2, `two attributes for ${input}`);
    equal(markup.attributes[0].position, 0, `character position for ${input}`);
    equal(markup.attributes[0].length, 3, `character length for ${input}`);
    equal(markup.attributes[1].position, 3, `attribute position for ${input}`);
    equal(markup.attributes[1].length, 1, `attribute length for ${input}`);
  }
});

test("unexpected close marker errors", () => {
  for (const input of ["[a][/a][/b]", "[/b]", "[a][/][/b]"]) {
    const parser = new LineParser();
    const { diagnostics } = parser.parseStringWithDiagnostics(input, "en");
    ok(diagnostics.length > 0, `expected diagnostics for ${input}`);
  }
});

test("markup shortcut property parsing", () => {
  const line = "[a=1]s[/a]";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  const attribute = markup.attributes[0];
  equal(attribute.name, "a");
  equal(attribute.position, 0);
  equal(attribute.length, 1);

  const value = attribute.properties["a"];
  equal(value.type, "integer");
  equal(value.integerValue, 1);
});

test("markup multiple property parsing", () => {
  const line = "[a p1=1 p2=2]s[/a]";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  equal(markup.attributes[0].name, "a");
  equal(markup.attributes[0].properties && Object.keys(markup.attributes[0].properties).length, 2);

  const p1 = markup.attributes[0].properties["p1"];
  equal(p1.type, "integer");
  equal(p1.integerValue, 1);

  const p2 = markup.attributes[0].properties["p2"];
  equal(p2.type, "integer");
  equal(p2.integerValue, 2);
});

test("markup property parsing uses invariant number parsing", () => {
  // `[p=1,1 /]` is not a valid invariant number in any culture.
  for (const input of ["[p=1,1 /]", "[p=-1,1 /]"]) {
    const parser = new LineParser();
    const { diagnostics } = parser.parseStringWithDiagnostics(input, "en");
    equal(diagnostics.length, 1, `expected a diagnostic for ${input}`);
  }
});

test("markup property parsing uses invariant number", () => {
  for (const [input, propertyValue] of [["[p=1.1 /]", 1.1], ["[p=-1.1 /]", -1.1]] as const) {
    const parser = new LineParser();
    const { markup, diagnostics } = parser.parseStringWithDiagnostics(input, "en");
    equal(diagnostics.length, 0);
    equal(markup.attributes[0].properties["p"].floatValue, propertyValue);
  }
});

const propertyParsingCases: Array<[string, string, string]> = [
  ['[a p="string"]s[/a]', "string", "string"],
  ['[a p="str\\"ing"]s[/a]', "string", 'str"ing'],
  ["[a p=string]s[/a]", "string", "string"],
  ["[a p=42]s[/a]", "integer", "42"],
  ["[a p=13.37]s[/a]", "float", "13.37"],
  ["[a p=true]s[/a]", "bool", "True"],
  ["[a p=false]s[/a]", "bool", "False"],
  ["[a p={$someValue}]s[/a]", "string", "$someValue"],
  ["[p=-1 /]", "integer", "-1"],
  ["[p=-1.1 /]", "float", "-1.1"],
  ["[p={$someValue}]s[/p]", "string", "$someValue"],
  ["[p=True]s[/p]", "bool", "True"],
  ["[p=true]s[/p]", "bool", "True"],
  ["[p=False]s[/p]", "bool", "False"],
  ['[p="string"]s[/p]', "string", "string"],
  ["[p=string]s[/p]", "string", "string"],
  ['[p="str\\"ing"]s[/p]', "string", 'str"ing'],
];

test("markup property parsing", () => {
  for (const [input, expectedType, expectedValueAsString] of propertyParsingCases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en", { addImplicitCharacterAttribute: false });

    equal(markup.attributes.length, 1, `one attribute for ${input}`);

    const attribute = markup.attributes[0];
    const propertyValue = attribute.properties["p"];

    equal(propertyValue.type, expectedType, `property type for ${input}`);
    equal(stringifyMarkupValue(propertyValue), expectedValueAsString, `property value for ${input}`);
  }
});

function stringifyMarkupValue(value: { type: string; integerValue: number; floatValue: number; stringValue: string; boolValue: boolean }): string {
  switch (value.type) {
    case "integer": return String(value.integerValue);
    case "float": return String(value.floatValue);
    case "string": return value.stringValue;
    case "bool": return value.boolValue ? "True" : "False";
    default: return "";
  }
}

const multipleAttributeCases = [
  "A [b]B [c]C[/c][/b] D", // attributes can be closed
  "A [b]B [c]C[/b][/c] D", // attributes can be closed out of order
  "A [b]B [c]C[/] D", // "[/]" closes all open attributes
];

test("multiple attributes", () => {
  for (const input of multipleAttributeCases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en", { addImplicitCharacterAttribute: false });

    equal(markup.text, "A B C D", `text for ${input}`);

    equal(markup.attributes.length, 2, `attribute count for ${input}`);

    equal(markup.attributes[0].name, "b");
    equal(markup.attributes[0].position, 2);
    equal(markup.attributes[0].sourcePosition, 2);
    equal(markup.attributes[0].length, 3);

    equal(markup.attributes[1].name, "c");
    equal(markup.attributes[1].position, 4);
    equal(markup.attributes[1].sourcePosition, 7);
    equal(markup.attributes[1].length, 1);
  }
});

test("self-closing attributes", () => {
  const line = "A [a/] B";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  equal(markup.text, "A B");
  equal(markup.attributes.length, 1);
  equal(markup.attributes[0].name, "a");
  // One property: the implicit trimwhitespace on self-closing markup.
  equal(Object.keys(markup.attributes[0].properties).length, 1);
  equal(markup.attributes[0].position, 2);
  equal(markup.attributes[0].length, 0);
});

const trimWhitespaceCases: Array<[string, string]> = [
  ["A [a/] B", "A B"],
  ["A [a trimwhitespace=true/] B", "A B"],
  ["A [a trimwhitespace=false/] B", "A  B"],
  ["A [nomarkup trimwhitespace=false/] B", "A  B"],
  ["A [nomarkup trimwhitespace=true/] B", "A B"],
];

test("attributes may trim trailing whitespace", () => {
  for (const [input, expectedText] of trimWhitespaceCases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en", { addImplicitCharacterAttribute: false });
    equal(markup.text, expectedText, `text for ${input}`);
  }
});

const implicitCharacterCases = [
  "Mae: Wow!", // character attribute can be implicit
  '[character name="Mae"]Mae: [/character]Wow!', // or explicit
];

test("implicit character attribute parsing", () => {
  for (const input of implicitCharacterCases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en");

    equal(markup.text, "Mae: Wow!", `text for ${input}`);
    equal(markup.attributes.length, 1, `attribute count for ${input}`);

    equal(markup.attributes[0].name, "character");
    equal(markup.attributes[0].position, 0);
    equal(markup.attributes[0].length, 5);

    equal(Object.keys(markup.attributes[0].properties).length, 1);
    equal(markup.attributes[0].properties["name"].stringValue, "Mae");
  }
});

const escapedCharacterCases: Array<[string, string]> = [
  ["Mae\\: Wow!: Wow!", "Mae: Wow!"],
  ["Mae\\: Wow!: \\:Wow!", "Mae: Wow!"],
  ["Mae\\: Wow!: :Wow!", "Mae: Wow!"],
];

test("implicit character attribute parsing can be escaped", () => {
  for (const [input, character] of escapedCharacterCases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en");

    equal(markup.attributes.length, 1, `attribute count for ${input}`);
    equal(markup.attributes[0].name, "character");
    equal(markup.attributes[0].position, 0);
    equal(Object.keys(markup.attributes[0].properties).length, 1);
    equal(markup.attributes[0].properties["name"].stringValue, character);
  }
});

const escapedCharacterlessCases: Array<[string, string]> = [
  ["Mae\\: Wow!", "Mae: Wow!"],
  ["\\:Mae\\: Wow!", ":Mae: Wow!"],
  ["\\:", ":"],
];

test("escaped characterless lines are allowed", () => {
  for (const [input, output] of escapedCharacterlessCases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en");

    equal(markup.attributes.length, 0, `no attributes for ${input}`);
    equal(markup.text, output, `text for ${input}`);
  }
});

const leftmostColonCases = [
  "Mae: Incredible: Wow!",
  '[character name="Mae"]Mae: [/character]Incredible: Wow!',
];

test("implicit character attribute parsing with the leftmost colon", () => {
  for (const input of leftmostColonCases) {
    const parser = new LineParser();
    const markup = parser.parseString(input, "en");

    equal(markup.text, "Mae: Incredible: Wow!", `text for ${input}`);
    equal(markup.attributes.length, 1, `attribute count for ${input}`);

    equal(markup.attributes[0].name, "character");
    equal(markup.attributes[0].position, 0);
    equal(markup.attributes[0].length, 5);
    equal(markup.attributes[0].properties["name"].stringValue, "Mae");
  }
});

test("nomarkup mode parsing", () => {
  const line = "S [a]S[/a] [nomarkup][a]S;][/a][/nomarkup]";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  equal(markup.text, "S S [a]S;][/a]");
  equal(markup.attributes.length, 2);
  equal(markup.attributes[0].name, "a");
  equal(markup.attributes[0].position, 2);
  equal(markup.attributes[0].length, 1);
  equal(markup.attributes[1].name, "nomarkup");
  equal(markup.attributes[1].position, 4);
  equal(markup.attributes[1].length, 10);
});

test("markup escaping", () => {
  const line = "[a]hello \\[b\\]hello\\[/b\\][/a]";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  equal(markup.text, "hello [b]hello[/b]");
  equal(markup.attributes.length, 1);
  equal(markup.attributes[0].name, "a");
  equal(markup.attributes[0].position, 0);
  equal(markup.attributes[0].length, 18);
});

// ── Replacement markers ─────────────────────────────────────────────────

test("numeric selection", () => {
  const line = "[select value=1 1=one 2=two 3=three /]";
  const parser = new LineParser();
  const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });

  equal(markup.attributes.length, 1);
  equal(markup.attributes[0].name, "select");
  equal(Object.keys(markup.attributes[0].properties).length, 5);
  equal(markup.attributes[0].properties["value"].integerValue, 1);
  equal(markup.attributes[0].properties["1"].stringValue, "one");
  equal(markup.attributes[0].properties["2"].stringValue, "two");
  equal(markup.attributes[0].properties["3"].stringValue, "three");
  equal(markup.attributes[0].properties["trimwhitespace"].boolValue, true);

  // Now with the rewriter enabled, the select composes as its replacement.
  parser.registerMarkerProcessor("select", new BuiltInMarkupReplacer());
  const replaced = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });
  equal(replaced.text, "one");
});

test("number pluralisation", () => {
  const cases: Array<[number, string, string]> = [
    [1, "en", "a single cat"],
    [2, "en", "2 cats"],
    [3, "en", "3 cats"],
    [1, "en-AU", "a single cat"],
    [2, "en-AU", "2 cats"],
    [3, "en-AU", "3 cats"],
  ];
  for (const [value, locale, expected] of cases) {
    const line = `[plural value=${value} one="a single cat" other="% cats"/]`;
    const parser = new LineParser();
    parser.registerMarkerProcessor("plural", new BuiltInMarkupReplacer());
    const markup = parser.parseString(line, locale, { addImplicitCharacterAttribute: false });
    equal(markup.text, expected, `${value} in locale ${locale} should have the correct plural case`);
  }
});

test("ordinal selection", () => {
  const cases: Array<[number, string]> = [
    [1, "1st place"],
    [2, "2nd place"],
    [3, "3rd place"],
    [4, "4th place"],
    [11, "11th place"],
    [112, "112th place"],
    [113, "113th place"],
  ];
  for (const [value, expected] of cases) {
    const line = `[ordinal value=${value} one="%st place" two="%nd place" few="%rd place" other="%th place"/]`;
    const parser = new LineParser();
    parser.registerMarkerProcessor("ordinal", new BuiltInMarkupReplacer());
    const markup = parser.parseString(line, "en", { addImplicitCharacterAttribute: false });
    equal(markup.text, expected, `ordinal for ${value}`);
  }
});

test("replacement markers fail with a diagnostic when their value type cannot pluralise", () => {
  const line = '[plural value="cats" one="a cat" other="% cats"/]';
  const parser = new LineParser();
  parser.registerMarkerProcessor("plural", new BuiltInMarkupReplacer());
  const { markup, diagnostics } = parser.parseStringWithDiagnostics(line, "en", { addImplicitCharacterAttribute: false });
  equal(diagnostics.length, 1);
  match(diagnostics[0].message, /does not support pluralisation/);
  equal(markup.text, line, "a failed composition returns the input text");
});

test("select with no matching replacement produces a diagnostic", () => {
  const line = "[select value=4 1=one /]";
  const parser = new LineParser();
  parser.registerMarkerProcessor("select", new BuiltInMarkupReplacer());
  const { diagnostics } = parser.parseStringWithDiagnostics(line, "en", { addImplicitCharacterAttribute: false });
  equal(diagnostics.length, 1);
  match(diagnostics[0].message, /no replacement value for 4 was found/);
});

const olderSiblingCases: Array<[string, string]> = [
  ["Yes... which I would have shown [emotion=\"frown\" /] had [b]you[/b] not interrupted me.", "Yes... which I would have shown had <b>you</b> not interrupted me."],
  ["Yes... which I would have shown [emotion=\"frown\" trimwhitespace=false /] had [b]you[/b] not interrupted me.", "Yes... which I would have shown  had <b>you</b> not interrupted me."],
  ["Yes... which I would have shown [emotion/] had [b]you[/b] not interrupted me.", "Yes... which I would have shown had <b>you</b> not interrupted me."],
  ["Yes... which I would have shown [emotion/] had [b]you [emotion=\"frown\" /] not[/b] interrupted me.", "Yes... which I would have shown had <b>you not</b> interrupted me."],
  ["Yes... which I would have [b]shown [emotion=\"frown\" /] [/b]had you not interrupted me.", "Yes... which I would have <b>shown </b>had you not interrupted me."],
  ["Yes... which I would have [b]shown [emotion=\"frown\" /][/b]had you not interrupted me.", "Yes... which I would have <b>shown </b>had you not interrupted me."],
];

test("older sibling near replacement markers correctly respects whitespace consumption", () => {
  for (const [line, expected] of olderSiblingCases) {
    const parser = new LineParser();
    parser.registerMarkerProcessor("b", new BBCodeChevronReplacer("b"));

    const { markup, diagnostics } = parser.parseStringWithDiagnostics(line, "en-AU", {
      addImplicitCharacterAttribute: false,
      squish: false,
      sort: false,
    });
    equal(diagnostics.length, 0);
    equal(markup.text, expected, `text for ${line}`);
  }
});

const selfClosingReplacementCases: Array<[string, string]> = [
  ["a line with a self-closing[scr /] replacement tag", "a line with a self-closingscr replacement tag"],
  ["a line with a self-closing[scnr /] -non-replacement tag", "a line with a self-closing-non-replacement tag"],
  ["a line with a self-closing[scnr trimwhitespace=false /] non-replacement tag", "a line with a self-closing non-replacement tag"],
];

test("self-closing replacement markers do not consume whitespace", () => {
  for (const [line, expected] of selfClosingReplacementCases) {
    const parser = new LineParser();
    parser.registerMarkerProcessor("scr", new MarkupTestsReplacer());

    const { markup, diagnostics } = parser.parseStringWithDiagnostics(line, "en-AU");
    equal(diagnostics.length, 0);
    equal(markup.text, expected, `text for ${line}`);
  }
});

test("marker processors can process character names", () => {
  const parser = new LineParser();
  parser.registerMarkerProcessor("character", new MarkerUppercaseReplacer());

  const markup = parser.parseString("Mae: I'm talkin' here", "en-AU");
  equal(markup.text, "MAE: I'm talkin' here", "the character marker should be processed");
  const character = tryGetAttributeWithName(markup, "character");
  ok(character, "the marker should be left in place");
  equal(character.properties["name"].stringValue, "Mae", "the marker's properties should be unmodified");
});

test("underscores can be identifiers", () => {
  const parser = new LineParser();

  // Self-closing tags can have underscores in their name.
  let markup = parser.parseString("Narrator: Self-closing tag [under_tag /]with an underscore.", "en-AU");
  equal(markup.text, "Narrator: Self-closing tag with an underscore.");
  equal(markup.attributes.length, 2);
  ok(markup.attributes.some((m) => m.name === "under_tag"));
  const character = tryGetAttributeWithName(markup, "character");
  ok(character);
  equal(character.properties["name"].stringValue, "Narrator");

  // Regular markup can have underscores in their name.
  markup = parser.parseString("Narrator: This is a [under_tag]regular markup[/under_tag] with underscores", "en-AU");
  equal(markup.text, "Narrator: This is a regular markup with underscores");
  equal(markup.attributes.length, 2);
  ok(markup.attributes.some((m) => m.name === "under_tag"));
  ok(tryGetAttributeWithName(markup, "character"));

  // Markup can have properties with underscores.
  markup = parser.parseString('Line with a regular [under_tag under_property="hello"]underscored tag with an underscored property also[/under_tag] in it.', "en-AU");
  equal(markup.text, "Line with a regular underscored tag with an underscored property also in it.");
  equal(markup.attributes.length, 1);
  const underTag = tryGetAttributeWithName(markup, "under_tag");
  ok(underTag);
  equal(underTag.properties["under_property"].stringValue, "hello");
});

// ── Diagnostics ─────────────────────────────────────────────────────────

test("unclosed markup with an invalid property generates a diagnostic", () => {
  const parser = new LineParser();
  const { diagnostics } = parser.parseStringWithDiagnostics("[attribute property", "en-AU");
  ok(diagnostics.length > 0);
  ok(diagnostics[0].message.startsWith('Expected to find a property and it\'s value, but instead found "property'));
});

test("half-formed markup generates diagnostics", () => {
  for (const input of ["[attribute", "[.", "[attribute text [/attribute]"]) {
    const parser = new LineParser();
    const { diagnostics } = parser.parseStringWithDiagnostics(input, "en-AU");
    ok(diagnostics.length > 0, `expected diagnostics for ${input}`);
  }
});

test("isolated close marker generates a diagnostic", () => {
  const parser = new LineParser();
  const { diagnostics } = parser.parseStringWithDiagnostics("normal line [/close]", "en-AU");
  ok(diagnostics.length > 0);
});

test("isolated open marker generates a diagnostic", () => {
  const parser = new LineParser();
  const { diagnostics } = parser.parseStringWithDiagnostics("[open]normal line", "en-AU");
  ok(diagnostics.length > 0);
});

test("diagnostic position is valid", () => {
  const parser = new LineParser();
  const first = parser.parseStringWithDiagnostics("normal line [/a]", "en-AU");
  ok(first.diagnostics.length > 0);
  const diag = first.diagnostics.filter((d) => d.message.startsWith('Asked to close "a"'));
  equal(diag.length, 1);
  equal(diag[0].column, 14);

  const second = new LineParser().parseStringWithDiagnostics("[invalid.name]normal text[/invalid.name]", "en-AU");
  const diag2 = second.diagnostics.filter((d) => d.message.startsWith("Error parsing markup, invalid name:"));
  equal(diag2.length, 1);
  equal(diag2[0].column, 1);
});

test("invalid period markup does not throw", () => {
  const parser = new LineParser();
  equal(parser.parseStringWithDiagnostics("Normal line with invalid markup at the [end.]", "en-AU").diagnostics.length, 1);
  equal(parser.parseStringWithDiagnostics("[end.] invalid markup at start.", "en-AU").diagnostics.length, 1);
  equal(parser.parseStringWithDiagnostics("invalid markup in the [end.] middle of the line.", "en-AU").diagnostics.length, 1);
});

// ── Locale helpers ──────────────────────────────────────────────────────

test("languageSubtag narrows specific locales to their language", () => {
  equal(languageSubtag("en-AU"), "en");
  equal(languageSubtag("en"), "en");
  equal(languageSubtag("zh-Hans-CN"), "zh");
  equal(languageSubtag("not a locale!"), "not a locale!");
});
