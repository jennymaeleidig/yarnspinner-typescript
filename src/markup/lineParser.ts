/**
 * The runtime line-parser module (upstream `Yarn.Markup.LineParser`): the
 * stage that turns a composed line's text into a structured markup parse
 * result.
 *
 * Pipeline (upstream `ParseStringWithDiagnostics`):
 * 1. the implicit `[character name=]` marker replaces a line's character-
 *    name prefix (upstream `implicitCharacterRegex`), so speaker identity
 *    is structured data rather than a stripped string;
 * 2. the text lexes into tokens and builds a markup tree (with the
 *    adoption-agency-style rebalancing for misclosed tags, close-all `[/]`,
 *    property shorthand, and `nomarkup` regions);
 * 3. the tree walks into plain text plus attributes — registered marker
 *    processors rewrite their markers' text (the built-in processor
 *    implements the `[select]`/`[plural]`/`[ordinal]` replacement markers),
 *    self-closing markers trim following whitespace (`trimwhitespace`), and
 *    invisible-character counts backshift later siblings' positions;
 * 4. split attributes are squished back together and the result is sorted
 *    by source position.
 *
 * Styling tags are opaque: an unregistered marker becomes an attribute —
 * data for the consumer, never interpreted here.
 *
 * Problems are data, not throws (coding standards §3): lexing, parsing,
 * and processing problems surface as `MarkupDiagnostic`s, and a failed
 * parse composes as the input text with no attributes.
 *
 * Ported from upstream 3.2.2 `YarnSpinner/YarnSpinner.Markup/LineParser.cs`
 * (MIT © Secret Lab Pty. Ltd. and Yarn Spinner contributors), with the
 * upstream CLDR plural tables replaced by `Intl.PluralRules`.
 */

// Citation: adapted from YarnSpinner v3.2.2 LineParser.cs and
// MarkupParseResult.cs, https://github.com/YarnSpinnerTool/YarnSpinner
// (MIT). The upstream license survives this adaptation.
// Modified by Jenny Mae LEIDIG on 2026-09-04 — markup parity edges:
// duplicate property names now throw like upstream's Dictionary.Add
// (MarkupAttribute ctor); the escaped-quote string lexer falls back to
// .NET's failed-Match Index-0 semantics (LineParser.cs string-value
// branch); the invalid-name diagnostic range excludes the offending
// character (LineParser.cs [ ID ERROR branch).

import {
  StringBuilder,
  type MarkupAttribute,
  type MarkupDiagnostic,
  type MarkupParseResult,
  type MarkupValue,
  type AttributeMarkerProcessor,
  floatMarkupValue,
  integerMarkupValue,
  stringMarkupValue,
  boolMarkupValue,
} from "./types.js";

/** The name of the implicitly-generated `character` attribute (upstream `LineParser.CharacterAttribute`). */
export const characterAttribute = "character";

/** The 'name' property on the implicit `character` attribute (upstream `CharacterAttributeNameProperty`). */
export const characterAttributeNameProperty = "name";

/** The property that marks trailing-whitespace trimming on a marker (upstream `TrimWhitespaceProperty`). */
export const trimWhitespaceProperty = "trimwhitespace";

/** The attribute that disables marker processing inside it (upstream `NoMarkupAttribute`). */
export const noMarkupAttribute = "nomarkup";

/** The property holding replacement markers' text (upstream `ReplacementMarkerContents`). */
export const replacementMarkerContents = "contents";

/** The internal property used to re-merge attributes split by tree rebalancing (upstream `_internalIncrementingProperty`). */
const internalIncrementingProperty = "_internalIncrementingProperty";

// ── Lexer ───────────────────────────────────────────────────────────────

export type LexerTokenType =
  | "text"
  | "openMarker"
  | "closeMarker"
  | "closeSlash"
  | "identifier"
  | "error"
  | "start"
  | "end"
  | "equals"
  | "stringValue"
  | "numberValue"
  | "booleanValue"
  | "interpolatedValue";

export interface LexerToken {
  type: LexerTokenType;
  /** Inclusive start index into the (normalized) input. */
  start: number;
  /** Inclusive end index into the (normalized) input. */
  end: number;
}

const isLetterOrDigit = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);
const isWhitespace = (ch: string): boolean => /\s/u.test(ch);
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

const ALLOWED_IDENTIFIER_PUNCTUATION = new Set(["_", "|"]);

/**
 * Lexes marked-up text into tokens (upstream `LineParser.LexMarkup`). The
 * token list is bracketed by `start`/`end` sentinels; token ranges index
 * into the normalized input.
 */
export function lexMarkup(input: string): LexerToken[] {
  const tokens: LexerToken[] = [];
  if (input === "") {
    tokens.push({ type: "start", start: 0, end: 0 });
    tokens.push({ type: "end", start: 0, end: 0 });
    return tokens;
  }

  let mode: "text" | "tag" | "value" = "text";
  let last: LexerToken = { type: "start", start: 0, end: 0 };
  tokens.push(last);
  let currentPosition = 0;
  let pos = 0; // the reader cursor (next character to read)

  const peekChar = (): string | null =>
    pos < input.length ? input[pos] : null;
  const readChar = (): string | null =>
    pos < input.length ? input[pos++] : null;

  while (pos < input.length) {
    const c = readChar()!;
    // Mirrors the C# main loop: the cursor advanced one position for the
    // character just read; the tag/value branches consume further
    // characters themselves and advance `currentPosition` to match.
    if (mode === "text") {
      if (c === "[") {
        // An open marker — unless the preceding text ends with a backslash
        // (the escape), in which case the `[` is ordinary text (upstream's
        // `goto default`).
        if (last.type === "text" && input[last.end] === "\\") {
          last.end = currentPosition;
        } else {
          last = {
            type: "openMarker",
            start: currentPosition,
            end: currentPosition,
          };
          tokens.push(last);
          mode = "tag";
        }
      } else {
        if (last.type === "text") {
          last.end = currentPosition;
        } else {
          last = { type: "text", start: currentPosition, end: currentPosition };
          tokens.push(last);
        }
      }
    } else if (mode === "tag") {
      if (c === "]") {
        last = {
          type: "closeMarker",
          start: currentPosition,
          end: currentPosition,
        };
        tokens.push(last);
        mode = "text";
      } else if (c === "/") {
        last = {
          type: "closeSlash",
          start: currentPosition,
          end: currentPosition,
        };
        tokens.push(last);
      } else if (c === "=") {
        last = { type: "equals", start: currentPosition, end: currentPosition };
        tokens.push(last);
        mode = "value";
      } else if (isLetterOrDigit(c)) {
        const start = currentPosition;
        // Eat until the NEXT character is not an identifier character.
        let next = peekChar();
        while (
          next !== null &&
          (isLetterOrDigit(next) || ALLOWED_IDENTIFIER_PUNCTUATION.has(next))
        ) {
          readChar();
          currentPosition += 1;
          next = peekChar();
        }
        last = { type: "identifier", start, end: currentPosition };
        tokens.push(last);
      } else if (!isWhitespace(c)) {
        last = { type: "error", start: currentPosition, end: currentPosition };
        tokens.push(last);
        mode = "text";
      }
      // whitespace: just spacing between identifiers — keep lexing
    } else if (mode === "value") {
      if (!isWhitespace(c)) {
        if (isDigit(c) || c === "-") {
          const token: LexerToken = {
            type: "numberValue",
            start: currentPosition,
            end: currentPosition,
          };
          let next = peekChar();
          if (next !== null && (isDigit(next) || next === ".")) {
            while (true) {
              const read = readChar();
              if (read === null) {
                // Fell off the end without closing the number (or the tag).
                token.type = "error";
                break;
              }
              currentPosition += 1;
              const after = peekChar();
              if (after === null) {
                token.type = "error";
                break;
              }
              if (!(isDigit(after) || after === ".")) {
                break;
              }
            }
          }
          if (
            isValidFloat(
              input.slice(
                token.start,
                token.start + (currentPosition + 1 - token.start),
              ),
            )
          ) {
            token.end = currentPosition;
            tokens.push(token);
            last = token;
          } else {
            token.end = currentPosition;
            token.type = "error";
            tokens.push(token);
            last = token;
          }
          mode = "tag";
        } else if (c === '"') {
          const token: LexerToken = {
            type: "stringValue",
            start: currentPosition,
            end: currentPosition,
          };
          if (peekChar() !== null) {
            // The next quote that isn't preceded by a backslash. When no
            // unescaped quote exists, upstream still searches — .NET's
            // failed Regex.Match carries Index 0, so the fallback IndexOf
            // starts right after the opening quote and lands on the
            // ESCAPED quote, terminating the string there (LineParser.cs
            // string-value branch).
            const rest = input.slice(currentPosition + 1);
            const match = /(?<!\\)"/.exec(rest);
            const nextQuote = input.indexOf(
              '"',
              currentPosition + 1 + (match ? match.index : 0),
            );
            if (nextQuote === -1) {
              token.type = "error";
            } else {
              const length = nextQuote - currentPosition;
              for (let i = 0; i < length; i++) readChar();
              currentPosition += length;
            }
          } else {
            // The `"` is the last character: an unclosed string.
            token.type = "error";
          }
          token.end = currentPosition;
          last = token;
          tokens.push(token);
          mode = "tag";
        } else if (c === "{") {
          // An interpolated value — grabbed up to the next `}` for
          // diagnostics; the real parse happens in the Yarn expression
          // parser, so the interior is opaque here.
          const token: LexerToken = {
            type: "interpolatedValue",
            start: currentPosition,
            end: currentPosition,
          };
          let exited = false;
          while (peekChar() !== null) {
            currentPosition += 1;
            if (readChar() === "}") {
              exited = true;
              break;
            }
          }
          if (!exited) {
            token.type = "error";
          }
          token.end = currentPosition;
          tokens.push(token);
          last = token;
          mode = "tag";
        } else {
          // true / false / an undelimited alphanumeric string.
          const token: LexerToken = {
            type: "stringValue",
            start: currentPosition,
            end: currentPosition,
          };
          const next = peekChar();
          if (next !== null && isLetterOrDigit(next)) {
            while (true) {
              const read = readChar();
              if (read === null) break;
              currentPosition += 1;
              const after = peekChar();
              if (after === null || !isLetterOrDigit(after)) break;
            }
          }
          const value = input.slice(
            token.start,
            token.start + (currentPosition + 1 - token.start),
          );
          if (
            value === "true" ||
            value === "True" ||
            value === "false" ||
            value === "False"
          ) {
            token.type = "booleanValue";
          }
          token.end = currentPosition;
          tokens.push(token);
          last = token;
          mode = "tag";
        }
      }
    }
    currentPosition += 1;
  }

  tokens.push({ type: "end", start: currentPosition, end: input.length - 1 });
  return tokens;
}

function isValidFloat(text: string): boolean {
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return false;
  return Number.isFinite(Number(text));
}

// ── Token stream ────────────────────────────────────────────────────────

/** A cursor over the token list (upstream `LineParser.TokenStream`). */
class TokenStream {
  private readonly tokens: LexerToken[];
  private iterator = 0;

  constructor(tokens: LexerToken[]) {
    this.tokens = tokens;
  }

  get current(): LexerToken {
    if (this.iterator < 0) {
      this.iterator = 0;
      return { type: "start", start: 0, end: 0 };
    }
    if (this.iterator > this.tokens.length - 1) {
      this.iterator = this.tokens.length - 1;
      return { type: "end", start: 0, end: 0 };
    }
    return this.tokens[this.iterator];
  }

  next(): LexerToken {
    this.iterator += 1;
    return this.current;
  }

  peek(): LexerToken {
    this.iterator += 1;
    const next = this.current;
    this.iterator -= 1;
    return next;
  }

  lookAhead(number: number): LexerToken {
    this.iterator += number;
    const ahead = this.current;
    this.iterator -= number;
    return ahead;
  }

  consume(number: number): void {
    this.iterator += number;
  }

  comparePattern(pattern: LexerTokenType[]): boolean {
    let matches = true;
    const current = this.iterator;
    for (const type of pattern) {
      if (this.current.type === type) {
        this.iterator += 1;
        continue;
      }
      matches = false;
      break;
    }
    this.iterator = current;
    return matches;
  }
}

// ── Markup tree ─────────────────────────────────────────────────────────

/**
 * A node of the markup tree (upstream `MarkupTreeNode`/`MarkupTextNode`):
 * a named element with children and properties, or — when `text` is
 * non-null — a text run.
 */
export interface MarkupTreeNode {
  name: string | null;
  firstToken: LexerToken | null;
  children: MarkupTreeNode[];
  properties: MarkupProperty[];
  text: string | null;
}

export interface MarkupProperty {
  name: string;
  value: MarkupValue;
}

function textNode(
  text: string,
  firstToken: LexerToken | null = null,
): MarkupTreeNode {
  return { name: null, firstToken, children: [], properties: [], text };
}

function elementNode(
  name: string | null,
  firstToken: LexerToken | null = null,
): MarkupTreeNode {
  return { name, firstToken, children: [], properties: [], text: null };
}

// ── LineParser ──────────────────────────────────────────────────────────

/**
 * Parses text and produces markup information (upstream `LineParser`):
 * the runtime line-parser module. Each `Dialogue` owns one; replacement
 * marker processors (the built-in `[select]`/`[plural]`/`[ordinal]`
 * processor and any host-registered processors) are registered per
 * instance.
 */
export class LineParser {
  private readonly markerProcessors = new Map<
    string,
    AttributeMarkerProcessor
  >();
  private internalIncrementingAttribute = 1;

  /**
   * Registers a marker processor for a marker name (upstream
   * `RegisterMarkerProcessor`): when a marker with this name is
   * encountered, the processor supplies replacement text. Registering a
   * duplicate name is a host programming error and throws, as upstream.
   */
  registerMarkerProcessor(
    attributeName: string,
    markerProcessor: AttributeMarkerProcessor,
  ): void {
    if (this.markerProcessors.has(attributeName)) {
      throw new Error(
        `A marker processor for ${attributeName} has already been registered.`,
      );
    }
    this.markerProcessors.set(attributeName, markerProcessor);
  }

  /** Removes any marker processor associated with a marker name. */
  deregisterMarkerProcessor(attributeName: string): void {
    this.markerProcessors.delete(attributeName);
  }

  /**
   * Parses a string of text and produces a markup parse result (upstream
   * `ParseString(string, string, bool, bool, bool)`), discarding
   * diagnostics: a failed parse composes as the input text with no
   * attributes.
   *
   * @param input the text to parse
   * @param localeCode the BCP-47 locale used when processing replacement
   *   markers
   * @param options `addImplicitCharacterAttribute` (default true) detects a
   *   character name prefix and adds the `character` attribute; `squish`
   *   re-merges attributes split by tree rebalancing; `sort` orders the
   *   result by source position.
   */
  parseString(
    input: string,
    localeCode = "en",
    options: {
      addImplicitCharacterAttribute?: boolean;
      squish?: boolean;
      sort?: boolean;
    } = {},
  ): MarkupParseResult {
    return this.parseStringWithDiagnostics(input, localeCode, options).markup;
  }

  /**
   * Parses a string and produces the markup parse result plus the
   * diagnostics encountered while parsing (upstream
   * `ParseStringAndIncludeMarkupDiagnostics` / the internal
   * `ParseStringWithDiagnostics`).
   */
  parseStringWithDiagnostics(
    input: string,
    localeCode = "en",
    options: {
      addImplicitCharacterAttribute?: boolean;
      squish?: boolean;
      sort?: boolean;
    } = {},
  ): { markup: MarkupParseResult; diagnostics: MarkupDiagnostic[] } {
    const addImplicitCharacterAttribute =
      options.addImplicitCharacterAttribute ?? true;
    const squish = options.squish ?? true;
    const sort = options.sort ?? true;

    let text = input.normalize();

    if (
      addImplicitCharacterAttribute &&
      /^\s*\[character/.test(text) === false
    ) {
      // The line does not already contain a `[character]` marker at the
      // start; attempt to find a character name prefix and replace it with
      // markup that indicates the character name.
      text = text.replace(
        /^((?:[^:\\]|\\.)*):\s*/,
        (match, name) => `[character name="${name}"]${match}[/character]`,
      );
    }

    // An escaped colon composes as a literal colon (upstream unescapes
    // `\:` after character detection).
    text = text.replaceAll("\\:", ":");

    const tokens = lexMarkup(text);
    const parseResult = this.buildMarkupTreeFromTokens(tokens, text);

    // With lexing/parsing errors it makes no sense to continue: the text
    // composes as the input and no attributes.
    if (parseResult.diagnostics.length > 0) {
      return {
        markup: { text: input, attributes: [] },
        diagnostics: parseResult.diagnostics,
      };
    }

    const builder = new StringBuilder();
    const attributes: MarkupAttribute[] = [];
    const diagnostics: MarkupDiagnostic[] = [];

    this.walkAndProcessTree(
      parseResult.tree,
      builder,
      attributes,
      localeCode,
      diagnostics,
    );

    if (squish) {
      LineParser.squishSplitAttributes(attributes);
    }

    let finalText = builder.toString();

    if (sort) {
      // Sorted by their position in the source text (stable).
      attributes.sort((a, b) => a.sourcePosition - b.sourcePosition);
    }

    // One last check for errors introduced by the rewriters: again compose
    // the input string.
    if (diagnostics.length > 0) {
      finalText = input;
      attributes.length = 0;
    }

    return { markup: { text: finalText, attributes }, diagnostics };
  }

  /**
   * Lexes marked-up text into tokens (upstream `LineParser.LexMarkup`),
   * exposed for the ported upstream lexer tests.
   */
  lexMarkup(input: string): LexerToken[] {
    return lexMarkup(input);
  }

  /**
   * Builds a markup tree from tokens (upstream
   * `LineParser.BuildMarkupTreeFromTokens`), exposed for the ported
   * upstream tree tests.
   */
  buildMarkupTreeFromTokens(
    tokens: LexerToken[],
    original: string,
  ): { tree: MarkupTreeNode; diagnostics: MarkupDiagnostic[] } {
    return buildMarkupTreeFromTokens(tokens, original, {
      cleanUpUnmatchedCloses: this.cleanUpUnmatchedCloses.bind(this),
    });
  }

  /**
   * Walks a markup tree into plain text and attributes, running registered
   * marker processors (upstream `LineParser.WalkAndProcessTree`), exposed
   * for the ported upstream walk tests.
   */
  walkAndProcessTree(
    root: MarkupTreeNode,
    builder: StringBuilder,
    attributes: MarkupAttribute[],
    localeCode: string,
    diagnostics: MarkupDiagnostic[],
    offset = 0,
  ): void {
    this.sibling = null;
    this.invisibleCharacters = 0;
    this.walkTree(root, builder, attributes, localeCode, diagnostics, offset);
  }

  // The last seen older sibling during tree walking (upstream `sibling`).
  private sibling: MarkupTreeNode | null = null;
  // Accumulated invisible characters added by replacement markup, used to
  // backshift sibling attribute positions after a replacement (upstream
  // `invisibleCharacters`).
  private invisibleCharacters = 0;

  private internalIDproperty(): MarkupProperty {
    const property: MarkupProperty = {
      name: internalIncrementingProperty,
      value: integerMarkupValue(this.internalIncrementingAttribute),
    };
    this.internalIncrementingAttribute += 1;
    return property;
  }

  private walkTree(
    root: MarkupTreeNode,
    builder: StringBuilder,
    attributes: MarkupAttribute[],
    localeCode: string,
    diagnostics: MarkupDiagnostic[],
    offset = 0,
  ): void {
    // A text node: trim a leading whitespace character when the older
    // sibling asked for it (self-closing markers add `trimwhitespace`),
    // unescape escaped brackets, and append.
    if (root.text !== null) {
      let line = root.text;
      if (this.sibling !== null) {
        for (const property of this.sibling.properties) {
          if (property.name === trimWhitespaceProperty) {
            if (property.value.boolValue === true) {
              if (line.length > 0 && isWhitespace(line[0])) {
                line = line.slice(1);
              }
            }
            break;
          }
        }
      }
      line = line.replaceAll("\\[", "[").replaceAll("\\]", "]");
      builder.append(line);
      this.sibling = root;
      return;
    }

    // An element: walk the children first.
    const childBuilder = new StringBuilder();
    const childAttributes: MarkupAttribute[] = [];
    for (const child of root.children) {
      this.walkTree(
        child,
        childBuilder,
        childAttributes,
        localeCode,
        diagnostics,
        builder.length + offset,
      );
    }

    // The root node has no name: just add the children and be done.
    if (root.name === null || root.name === "") {
      builder.append(childBuilder.toString());
      attributes.push(...childAttributes);
      return;
    }

    // Run our own rewriter, if a marker processor is registered for us.
    const rewriter = this.markerProcessors.get(root.name);
    if (rewriter) {
      const attribute: MarkupAttribute = {
        position: builder.length + offset,
        sourcePosition: root.firstToken?.start ?? -1,
        length: childBuilder.length,
        name: root.name,
        properties: propertiesToRecord(root.properties),
      };
      const result = rewriter.processReplacementMarker(
        attribute,
        childBuilder,
        childAttributes,
        localeCode,
      );
      diagnostics.push(...result.diagnostics);
      this.invisibleCharacters += result.invisibleCharacters;
    } else {
      // Not a replacement marker: add ourselves as a tag. The position
      // accounts for any invisible characters earlier replacements added,
      // so sibling attributes after a replacement don't drift.
      attributes.push({
        position: builder.length - this.invisibleCharacters + offset,
        sourcePosition: root.firstToken?.start ?? -1,
        length: childBuilder.length,
        name: root.name,
        properties: propertiesToRecord(root.properties),
      });
      // Only non-replacement markup becomes the older sibling (replacement
      // markers have already done any text modification they need).
      this.sibling = root;
    }

    builder.append(childBuilder.toString());
    attributes.push(...childAttributes);
  }

  /**
   * Merges attributes that were split as part of tree rebalancing (upstream
   * `LineParser.SquishSplitAttributes`): every attribute carrying the
   * internal tracking property merges with the first attribute sharing its
   * value, and the internal property is removed.
   */
  static squishSplitAttributes(attributes: MarkupAttribute[]): void {
    const removals: number[] = [];
    const merged = new Map<number, MarkupAttribute>();
    for (let i = 0; i < attributes.length; i++) {
      const attribute = attributes[i];
      const internalValue = attribute.properties[internalIncrementingProperty];
      if (internalValue) {
        const existing = merged.get(internalValue.integerValue);
        if (existing) {
          if (existing.position > attribute.position) {
            existing.position = attribute.position;
          }
          existing.length += attribute.length;
        } else {
          merged.set(internalValue.integerValue, attribute);
        }
        removals.push(i);
      }
    }
    for (let i = removals.length - 1; i > -1; i--) {
      attributes.splice(removals[i], 1);
    }
    for (const pair of merged.values()) {
      attributes.push(pair);
    }
  }

  private cleanUpUnmatchedCloses(
    openNodes: MarkupTreeNode[],
    unmatchedCloseNames: string[],
    errors: MarkupDiagnostic[],
  ): void {
    const orphans: MarkupTreeNode[] = [];
    // While we still have unbalanced closes and haven't hit the tree root.
    while (unmatchedCloseNames.length > 0 && openNodes.length > 1) {
      const top = openNodes.pop()!;

      // Only tag a node with the tracking ID once (an element may be split
      // multiple times).
      const found = top.properties.some(
        (p) => p.name === internalIncrementingProperty,
      );
      if (!found) {
        top.properties.push(this.internalIDproperty());
      }

      if (top.name !== null) {
        const index = unmatchedCloseNames.indexOf(top.name);
        if (index === -1) {
          orphans.push(top);
        } else {
          unmatchedCloseNames.splice(index, 1);
        }
      }
    }

    // Popped all the way to the root and still didn't find the close: the
    // close marker is a typo.
    if (unmatchedCloseNames.length > 0) {
      for (const unmatched of unmatchedCloseNames) {
        errors.push({
          message: `asked to close "${unmatched}" markup but there is no corresponding opening. Is [/${unmatched}] a typo?`,
          column: -1,
        });
      }
      unmatchedCloseNames.length = 0;
      return;
    }

    // The top of the stack is now the common ancestor of the orphans:
    // reparent them back as cousin clones of their original selves. Upstream
    // enumerates its orphans Stack LIFO (last-popped first), so a clone's
    // parent is the previously-reparented cousin — the nesting order the
    // squish step relies on.
    for (let i = orphans.length - 1; i >= 0; i--) {
      const template = orphans[i];
      const clone = elementNode(template.name, template.firstToken);
      clone.properties = template.properties;
      openNodes[openNodes.length - 1].children.push(clone);
      openNodes.push(clone);
    }
  }
}

function propertiesToRecord(
  properties: MarkupProperty[],
): Record<string, MarkupValue> {
  const record: Record<string, MarkupValue> = {};
  const seen = new Set<string>();
  for (const property of properties) {
    // Upstream builds the attribute's property dictionary with
    // Dictionary.Add (MarkupAttribute ctor, MarkupParseResult.cs), which
    // throws on a repeated name: duplicate property names in one tag are
    // an authoring error that surfaces as a throw, not last-wins.
    if (seen.has(property.name)) {
      throw new Error(
        `An item with the same key has already been added. [Key: ${property.name}]`,
      );
    }
    seen.add(property.name);
    record[property.name] = property.value;
  }
  return record;
}

// ── Tree builder ────────────────────────────────────────────────────────

function buildMarkupTreeFromTokens(
  tokens: LexerToken[],
  original: string,
  helpers: {
    cleanUpUnmatchedCloses: (
      openNodes: MarkupTreeNode[],
      unmatchedCloseNames: string[],
      errors: MarkupDiagnostic[],
    ) => void;
  },
): { tree: MarkupTreeNode; diagnostics: MarkupDiagnostic[] } {
  const { cleanUpUnmatchedCloses } = helpers;
  const tree = elementNode(null);
  const diagnostics: MarkupDiagnostic[] = [];

  const og = original.normalize();

  if (tokens.length < 2) {
    diagnostics.push({
      message: "There are not enough tokens to form a valid tree.",
      column: -1,
    });
    return { tree, diagnostics };
  }
  if (og === "") {
    diagnostics.push({
      message: "There is a valid list of tokens but no original string.",
      column: -1,
    });
    return { tree, diagnostics };
  }
  if (tokens[0].type !== "start" && tokens[tokens.length - 1].type !== "end") {
    diagnostics.push({
      message: "Token list doesn't start and end with the correct tokens.",
      column: -1,
    });
    return { tree, diagnostics };
  }

  const tryIntFromToken = (token: LexerToken): number | null => {
    const valueString = og.slice(token.start, token.end + 1);
    if (/^[-+]?\d+$/.test(valueString)) {
      return Number(valueString);
    }
    return null;
  };
  const tryFloatFromToken = (token: LexerToken): number | null => {
    const valueString = og.slice(token.start, token.end + 1);
    if (
      /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(valueString) &&
      Number.isFinite(Number(valueString))
    ) {
      return Number(valueString);
    }
    return null;
  };
  const tryBoolFromToken = (token: LexerToken): boolean | null => {
    // The lexer has already determined this is a true or false value.
    const valueString = og.slice(token.start, token.end + 1);
    if (valueString.toLowerCase() === "true") return true;
    if (valueString.toLowerCase() === "false") return false;
    return null;
  };
  const valueFromToken = (token: LexerToken): string => {
    let valueString = og.slice(token.start, token.end + 1);
    if (valueString.startsWith('"') && valueString.endsWith('"')) {
      // Inside delimiters, escaped characters are removed.
      valueString = valueString
        .replaceAll("\\", "")
        .replace(/^"+/g, "")
        .replace(/"+$/g, "");
    }
    return valueString;
  };
  const valueFromInterpolatedToken = (token: LexerToken): string => {
    // Removing the { } from the interpolated value.
    return og
      .slice(token.start, token.end + 1)
      .replace(/^{+/g, "")
      .replace(/}+$/g, "");
  };

  // [ / ]
  const closeAllPattern: LexerTokenType[] = [
    "openMarker",
    "closeSlash",
    "closeMarker",
  ];
  // [ / ID ]
  const closeOpenAttributePattern: LexerTokenType[] = [
    "openMarker",
    "closeSlash",
    "identifier",
    "closeMarker",
  ];
  // [ / ~( ID | ] )
  const closeErrorPattern: LexerTokenType[] = ["openMarker", "closeSlash"];
  // [ ID ]
  const openAttributePropertyLessPattern: LexerTokenType[] = [
    "openMarker",
    "identifier",
    "closeMarker",
  ];
  // ID = VALUE
  const numberPropertyPattern: LexerTokenType[] = [
    "identifier",
    "equals",
    "numberValue",
  ];
  const booleanPropertyPattern: LexerTokenType[] = [
    "identifier",
    "equals",
    "booleanValue",
  ];
  const stringPropertyPattern: LexerTokenType[] = [
    "identifier",
    "equals",
    "stringValue",
  ];
  const interpolatedPropertyPattern: LexerTokenType[] = [
    "identifier",
    "equals",
    "interpolatedValue",
  ];
  // / ]
  const selfClosingAttributeEndPattern: LexerTokenType[] = [
    "closeSlash",
    "closeMarker",
  ];

  const stream = new TokenStream(tokens);

  const openNodes: MarkupTreeNode[] = [tree];
  const unmatchedCloses: string[] = [];

  while (stream.current.type !== ("end" as LexerTokenType)) {
    const type: LexerTokenType = stream.current.type;

    switch (type) {
      case "start":
        break;

      case "end":
        // At the end: clean up any remaining unmatched closes.
        cleanUpUnmatchedCloses(openNodes, unmatchedCloses, diagnostics);
        break;

      case "text": {
        // Adding text to the tree, but first close any leftover closes.
        if (unmatchedCloses.length > 0) {
          cleanUpUnmatchedCloses(openNodes, unmatchedCloses, diagnostics);
        }
        const text = og.slice(stream.current.start, stream.current.end + 1);
        openNodes[openNodes.length - 1].children.push(
          textNode(text, stream.current),
        );
        break;
      }

      case "openMarker": {
        // An open marker — first check whether it is a close marker.
        if (stream.comparePattern(closeAllPattern)) {
          // The close-all marker: pop everything until the tree root.
          stream.consume(2);
          while (openNodes.length > 1) {
            const node = openNodes.pop()!;
            if (node.name !== null) {
              const index = unmatchedCloses.indexOf(node.name);
              if (index !== -1) unmatchedCloses.splice(index, 1);
            }
          }
          for (const remaining of unmatchedCloses) {
            diagnostics.push({
              message: `asked to close "${remaining}" markup but there is no corresponding opening. Is [/${remaining}] a typo?`,
              column: stream.current.start,
            });
          }
          unmatchedCloses.length = 0;
          break;
        }

        if (stream.comparePattern(closeOpenAttributePattern)) {
          // A close of an open attribute marker.
          const closeIDToken = stream.lookAhead(2);
          const closeID = og.slice(closeIDToken.start, closeIDToken.end + 1);
          stream.consume(3);

          if (openNodes.length === 1) {
            // Can't close something when only the root node remains.
            diagnostics.push({
              message: `Asked to close "${closeID}", but we don't have an open marker for it.`,
              column: closeIDToken.start,
            });
          } else if (closeID === openNodes[openNodes.length - 1].name) {
            openNodes.pop();
          } else {
            unmatchedCloses.push(closeID);
          }
          break;
        }

        if (stream.comparePattern(closeErrorPattern)) {
          // A malformed close tag.
          diagnostics.push({
            message: `Error parsing markup, detected invalid token ${stream.lookAhead(2).type}, following a close.`,
            column: stream.current.start,
          });
          break;
        }

        // A regular open marker variant: [ ID, [ ID =, [ nomarkup — or an
        // error of: [ *. If the next token isn't an identifier, error.
        if (stream.peek().type !== "identifier") {
          diagnostics.push({
            message: `Error parsing markup, detected invalid token ${stream.peek().type}, following an open marker.`,
            column: stream.peek().start,
          });
          break;
        }

        // Before continuing, close off the tree correctly.
        if (unmatchedCloses.length > 0) {
          cleanUpUnmatchedCloses(openNodes, unmatchedCloses, diagnostics);
        }

        const idToken = stream.peek();
        const id = og.slice(idToken.start, idToken.end + 1);

        // The nomarkup attribute changes the flow of the tool completely.
        if (stream.comparePattern(openAttributePropertyLessPattern)) {
          if (id === noMarkupAttribute) {
            // [ nomarkup ] ... [/ nomarkup ]: the first token after is 3
            // tokens away; eat tokens until the matching close.
            const tokenStart = stream.current;
            const firstTokenAfterNoMarkup = stream.lookAhead(3);
            let nm: MarkupTreeNode | null = null;
            while ((stream.current.type as LexerTokenType) !== "end") {
              if (stream.comparePattern(closeOpenAttributePattern)) {
                const nmIDToken = stream.lookAhead(2);
                if (
                  og.slice(nmIDToken.start, nmIDToken.end + 1) ===
                  noMarkupAttribute
                ) {
                  const text = textNode(
                    og.slice(
                      firstTokenAfterNoMarkup.start,
                      stream.current.start,
                    ),
                  );
                  nm = elementNode(noMarkupAttribute, tokenStart);
                  nm.children.push(text);
                  stream.consume(3);
                  break;
                }
              }
              stream.next();
            }
            if (nm === null) {
              diagnostics.push({
                message:
                  "we entered nomarkup mode but didn't find an exit token",
                column: tokenStart.start,
              });
            } else {
              openNodes[openNodes.length - 1].children.push(nm);
            }
            break;
          } else {
            // A marker with no properties, [ ID ].
            const completeMarker = elementNode(id, stream.current);
            openNodes[openNodes.length - 1].children.push(completeMarker);
            openNodes.push(completeMarker);
            // Consume the id and ] tokens.
            stream.consume(2);
            break;
          }
        }

        // Either [ ID (ID = Value)+ ], [ (ID = Value)+ ], or the [ ID ERROR
        // edge case.
        if (stream.lookAhead(2).type === "error") {
          // Upstream's range stops BEFORE the offending character:
          // `OG.Substring(idToken.Start, stream.LookAhead(2).End -
          // idToken.Start)` — not the token Range used elsewhere, so the
          // offending character is excluded from the message.
          const invalidName = og.slice(idToken.start, stream.lookAhead(2).end);
          diagnostics.push({
            message: `Error parsing markup, invalid name: "${invalidName}"`,
            column: idToken.start,
          });
          // Consume the ID and ERROR tokens.
          stream.consume(2);
          break;
        }

        const marker = elementNode(id, stream.current);
        openNodes[openNodes.length - 1].children.push(marker);
        openNodes.push(marker);

        if (stream.lookAhead(2).type !== "equals") {
          // Part of a normal [ID id = value] group: consume the [ and ID so
          // the next token is clean to handle id = value triples (and the
          // [ ID = variant doesn't realise it wasn't part of that group).
          stream.consume(1);
        }
        break;
      }

      case "identifier": {
        // A property of the form ID = VALUE.
        const id = og.slice(stream.current.start, stream.current.end + 1);

        if (stream.comparePattern(numberPropertyPattern)) {
          const valueToken = stream.lookAhead(2);
          const intValue = tryIntFromToken(valueToken);
          if (intValue !== null) {
            openNodes[openNodes.length - 1].properties.push({
              name: id,
              value: integerMarkupValue(intValue),
            });
          } else {
            const floatValue = tryFloatFromToken(valueToken);
            if (floatValue !== null) {
              openNodes[openNodes.length - 1].properties.push({
                name: id,
                value: floatMarkupValue(floatValue),
              });
            } else {
              diagnostics.push({
                message: `failed to convert the value ${og.slice(valueToken.start, valueToken.end + 1)} into a valid property`,
                column: valueToken.start,
              });
            }
          }
        } else if (stream.comparePattern(booleanPropertyPattern)) {
          const valueToken = stream.lookAhead(2);
          const boolValue = tryBoolFromToken(valueToken);
          if (boolValue !== null) {
            openNodes[openNodes.length - 1].properties.push({
              name: id,
              value: boolMarkupValue(boolValue),
            });
          } else {
            diagnostics.push({
              message: `failed to convert the value ${og.slice(valueToken.start, valueToken.end + 1)} into a valid property`,
              column: valueToken.start,
            });
          }
        } else if (stream.comparePattern(stringPropertyPattern)) {
          const valueToken = stream.lookAhead(2);
          openNodes[openNodes.length - 1].properties.push({
            name: id,
            value: stringMarkupValue(valueFromToken(valueToken)),
          });
        } else if (stream.comparePattern(interpolatedPropertyPattern)) {
          // The interpolated value's type is unknown here — it only needs
          // to exist for diagnostics, so it is suggested to be a string.
          const valueToken = stream.lookAhead(2);
          openNodes[openNodes.length - 1].properties.push({
            name: id,
            value: stringMarkupValue(valueFromInterpolatedToken(valueToken)),
          });
        } else {
          const peeked = stream.peek();
          diagnostics.push({
            message: `Expected to find a property and it's value, but instead found "${id} ${og.slice(peeked.start, peeked.end + 1)} ${og.slice(stream.lookAhead(2).start, stream.lookAhead(2).end + 1)}".`,
            column: peeked.start,
          });
        }

        stream.consume(2);
        break;
      }

      case "closeSlash":
        // Only reached for a self-closing marker
        // [ ID (= VALUE)? (ID = VALUE)* / ]: close the current open marker,
        // which can't have children.
        if (stream.comparePattern(selfClosingAttributeEndPattern)) {
          const top = openNodes.pop()!;
          const found = top.properties.some(
            (p) => p.name === trimWhitespaceProperty,
          );
          if (!found) {
            top.properties.push({
              name: trimWhitespaceProperty,
              value: boolMarkupValue(true),
            });
          }
          stream.consume(1);
        } else {
          // A `/` that isn't part of a self-closing marker is an error.
          diagnostics.push({
            message: "Encountered an unexpected closing slash",
            column: stream.current.start,
          });
        }
        break;
    }

    stream.next();
  }

  // Ran off the end of the line: close off any unmatched closes now, since
  // at this stage ordering doesn't matter.
  if (unmatchedCloses.length > 1) {
    cleanUpUnmatchedCloses(openNodes, unmatchedCloses, diagnostics);
  }

  // Check there is only one element left on the stack of open nodes.
  if (openNodes.length > 1) {
    const nodeNames: string[] = [];
    for (const node of openNodes) {
      if (node.name === null || node.name === "") continue;
      nodeNames.push("[" + node.name + "]");
    }
    diagnostics.push({
      message:
        "parsing finished with unclosed attributes still on the stack: " +
        nodeNames.join(", "),
      column: -1,
    });
  }
  if (unmatchedCloses.length > 1) {
    let line = "parsing finished with unmatched closes still remaining: ";
    for (const unmatched of unmatchedCloses) {
      line += " [/" + unmatched + "]";
    }
    diagnostics.push({ message: line, column: -1 });
  }

  return { tree, diagnostics };
}
