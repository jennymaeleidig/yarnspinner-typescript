// SPDX-License-Identifier: CC0-1.0
/**
 * Line composition (the runtime line-parser stage): `{expr}`
 * substitutions expanded, then the runtime markup module parses the
 * composed text into a structured markup parse result — attributes with
 * positions, the implicit `character` attribute carrying the speaker, and
 * replacement markers composing their text.
 *
 * Upstream order: substitutions expand FIRST (upstream
 * `ExpandSubstitutions` runs before `ParseString`), then the markup parses.
 * The delivered text keeps the character-name prefix (upstream
 * `MarkupParseResult.Text` does); the runtime slices it at the
 * `character` attribute for the event's `text` field, and derives
 * `speaker` from the attribute's `name` property.
 *
 * Shared by the one execution driver (the instruction-stream VM): lines
 * and commands keep authored text in the program, so composition happens
 * at delivery, through this one implementation. The evaluator function is
 * injected — the VM passes its expression evaluator's
 * `evaluateExpression`.
 *
 * Errors are data, not throws (coding standards §3): an expression that
 * fails to evaluate composes as the empty string.
 */

import { LineParser } from "../markup/lineParser.js";
import {
  characterAttribute,
  characterAttributeNameProperty,
} from "../markup/lineParser.js";
import { BuiltInMarkupReplacer } from "../markup/builtInReplacer.js";
import { tryGetProperty } from "../markup/types.js";
import type { MarkupParseResult } from "../markup/types.js";

/** The result of composing a line: plain text, speaker, and markup. */
export interface ComposedLine {
  /** The composed text, `{expr}` substitutions expanded, markup removed. */
  text: string;
  /** The speaker, derived from the implicit `character` attribute. */
  speaker?: string;
  /**
   * The structured markup parse result for the message text (the line with
   * the character prefix and all markup removed), when the composed text
   * carries any markup.
   */
  markup?: MarkupParseResult;
}

/**
 * The composed-line state: parser instance per Dialogue (marker processor
 * registration lives there), shared across lines.
 */
export class LineComposer {
  private readonly parser = new LineParser();
  private readonly builtInReplacer = new BuiltInMarkupReplacer();

  constructor(
    private readonly evaluateExpression: (expr: string) => unknown,
    /** Host-overridable BCP-47 locale for replacement markers. */
    private localeCode = "en",
  ) {
    // The built-in replacement markers ride the same processor registry as
    // any host-registered processor (upstream Dialogue registers
    // BuiltInMarkupReplacer for select/plural/ordinal).
    this.parser.registerMarkerProcessor("select", this.builtInReplacer);
    this.parser.registerMarkerProcessor("plural", this.builtInReplacer);
    this.parser.registerMarkerProcessor("ordinal", this.builtInReplacer);
  }

  /** The locale replacement markers compose under. */
  getLocale(): string {
    return this.localeCode;
  }

  /** Override the locale replacement markers resolve under (upstream `Dialogue.LocaleCode`). */
  setLocale(localeCode: string): void {
    this.localeCode = localeCode;
  }

  /** The underlying parser, for host marker-processor registration. */
  getParser(): LineParser {
    return this.parser;
  }

  /** Expand substitutions, composing evaluation failures as empty strings
   * (upstream `ExpandSubstitutions` inserts whatever the game supplies; a
   * thrown evaluation has nothing to supply). Shared by all three compose
   * paths. */
  private substitute(text: string): string {
    return expandSubstitutions(text, (expr) => {
      try {
        return stringifyValue(this.evaluateExpression(expr));
      } catch {
        return "";
      }
    });
  }

  /**
   * Expand `{expr}` substitutions only — no markup parsing, no character
   * resolution. Upstream runs commands through `ExpandSubstitutions` alone
   * (they never pass through the markup parser).
   */
  interpolate(text: string): string {
    return this.substitute(text);
  }

  /**
   * Compose one OPTION: expand substitutions and parse markup exactly like
   * a line (implicit `character` attribute enabled — upstream's
   * `GetComposedTextForLine` treats options identically), but deliver the
   * full composed text with the speaker prefix intact; the character
   * attribute marks the prefix region without being sliced off.
   */
  composeOption(text: string): { text: string; markup?: MarkupParseResult } {
    const substituted = this.substitute(text);

    const { markup, diagnostics } = this.parser.parseStringWithDiagnostics(substituted, this.localeCode);
    if (diagnostics.length > 0) {
      return { text: substituted };
    }
    return { text: markup.text, markup: markup.attributes.length > 0 ? markup : undefined };
  }

  /**
   * Compose one line: expand `{expr}` substitutions, then parse markup
   * (including the implicit `character` attribute that replaces the old
   * regex speaker slice). A markup parse failure composes as the raw text
   * with no speaker (the diagnostics ride the parser result, not the
   * event).
   */
  composeLine(text: string): ComposedLine {
    const substituted = this.substitute(text);

    const { markup, diagnostics } = this.parser.parseStringWithDiagnostics(substituted, this.localeCode);
    if (diagnostics.length > 0) {
      // The module composes failed parses as the input text with no
      // attributes; the speaker slice also can't be trusted then.
      return { text: substituted };
    }

    const character = markup.attributes.find((attribute) => attribute.name === characterAttribute);
    if (!character) {
      return { text: markup.text, markup: markup.attributes.length > 0 ? markup : undefined };
    }

    // The character marker covers "Name: " at the head of the composed
    // text; the message is what follows it.
    const messageText = markup.text.slice(character.position + character.length);
    const nameProp = tryGetProperty(character, characterAttributeNameProperty);
    const speaker = nameProp?.stringValue;

    const messageMarkup: MarkupParseResult = {
      text: messageText,
      attributes: markup.attributes
        .filter((attribute) => attribute !== character)
        .map((attribute) => ({
          ...attribute,
          position: attribute.position - character.position - character.length,
        })),
    };

    return {
      text: messageText,
      speaker,
      markup: messageMarkup.attributes.length > 0 ? messageMarkup : undefined,
    };
  }
}

/**
 * The inline-expression span scanner — the one home for "where are the
 * inline `{expr}` spans in this text?". The escape contract is the
 * runtime composer's, stated here once:
 *
 * - `\{` and `\}` are escapes — the brace composes literally and never
 *   opens a span; any other backslash composes literally (there is no
 *   `\\` escape — `\\{expr}` composes a literal backslash, then an
 *   escaped brace);
 * - a span runs from `{` to the *next* `}` (expressions are not
 *   brace-balanced — a `}` inside a string literal closes the span,
 *   exactly as the runtime expansion reads it);
 * - an unclosed `{` composes as a literal character — not a span.
 *
 * Every compile-side classifier (markup validation's blanking, the string
 * table's detection, the type checker's variable collection) previously
 * re-derived these rules by hand and had already drifted from the runtime
 * (blanking skipped two chars after *any* backslash); they now consume
 * these spans, so compile-time classification cannot disagree with
 * delivery.
 */
export interface InlineExpressionSpan {
  /** Index of the opening `{`. */
  start: number;
  /** Index just past the closing `}`. */
  end: number;
  /** The expression source between the braces. */
  source: string;
}

export function inlineExpressionSpans(text: string): InlineExpressionSpan[] {
  const spans: InlineExpressionSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && (text[i + 1] === "{" || text[i + 1] === "}")) {
      i += 2;
      continue;
    }
    if (char === "{") {
      const close = text.indexOf("}", i + 1);
      if (close !== -1) {
        spans.push({ start: i, end: close + 1, source: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

/** The compose-side escape transform (`\\{` → `{`, `\\}` → `}`): the
 * output shape of expansion, applied to the text between spans. Other
 * backslashes compose literally. */
function unescapeBraces(text: string): string {
  return text.replace(/\\([{}])/g, "$1");
}

/**
 * Upstream `LineParser.ExpandSubstitutions`, index-based: replaces each
 * inline span with its evaluated substitution (the runtime's expression
 * evaluation supplies the values). An expression that fails composes as
 * the empty string; escaped braces compose as literal braces. The scan
 * rides the span scanner's contract (above); the compose-side escape
 * transform (via `unescapeBraces`) stays here — it is this function's
 * output shape, not a classification.
 */
export function expandSubstitutions(text: string, evaluate: (expr: string) => string): string {
  let out = "";
  let pos = 0;
  for (const span of inlineExpressionSpans(text)) {
    out += unescapeBraces(text.slice(pos, span.start));
    out += evaluate(span.source);
    pos = span.end;
  }
  return out + unescapeBraces(text.slice(pos));
}

/** Upstream composed text (C# `ToString`): booleans as "True"/"False". */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}
