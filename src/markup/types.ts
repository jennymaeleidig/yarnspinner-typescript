/**
 * Markup data model (upstream `Yarn.Markup` types, camelCased): the
 * structured result of the runtime line-parser stage — plain text plus the
 * attributes that annotate ranges of it.
 *
 * A markup parse result's `text` is the line with all markup markers
 * removed; each attribute names a range (`position` + `length`) of that
 * text, carries typed `properties`, and remembers where it started in the
 * original source (`sourcePosition`, upstream `MarkupAttribute.SourcePosition`).
 */

/** A type of {@link MarkupValue} (upstream `MarkupValueType`). */
export type MarkupValueType = "integer" | "float" | "string" | "bool";

/**
 * A value associated with a markup attribute property (upstream
 * `MarkupValue`): a typed struct where the field matching `type` is
 * defined.
 */
export interface MarkupValue {
  type: MarkupValueType;
  integerValue: number;
  floatValue: number;
  stringValue: string;
  boolValue: boolean;
}

export function integerMarkupValue(value: number): MarkupValue {
  return { type: "integer", integerValue: value, floatValue: 0, stringValue: "", boolValue: false };
}

export function floatMarkupValue(value: number): MarkupValue {
  return { type: "float", integerValue: 0, floatValue: value, stringValue: "", boolValue: false };
}

export function stringMarkupValue(value: string): MarkupValue {
  return { type: "string", integerValue: 0, floatValue: 0, stringValue: value, boolValue: false };
}

export function boolMarkupValue(value: boolean): MarkupValue {
  return { type: "bool", integerValue: 0, floatValue: 0, stringValue: "", boolValue: value };
}

/** Renders a markup value the way upstream `MarkupValue.ToString` does. */
export function markupValueToString(value: MarkupValue): string {
  switch (value.type) {
    case "integer":
      return String(value.integerValue);
    case "float":
      return String(value.floatValue);
    case "string":
      return value.stringValue;
    case "bool":
      return value.boolValue ? "True" : "False";
  }
}

/**
 * Represents a range of text in a marked-up string (upstream
 * `MarkupAttribute`): created by the line parser, not by consumers.
 */
export interface MarkupAttribute {
  /** The position in the plain text where this attribute begins. */
  position: number;
  /** The position in the original source text where this attribute begins. */
  sourcePosition: number;
  /** The number of text elements in the plain text this attribute covers. */
  length: number;
  /** The name of the attribute. */
  name: string;
  /** The properties associated with this attribute. */
  properties: Record<string, MarkupValue>;
}

/**
 * A diagnostic message produced during markup parsing (upstream
 * `LineParser.MarkupDiagnostic`): collected, never thrown (coding
 * standards §3).
 */
export interface MarkupDiagnostic {
  message: string;
  /** The zero-based column index of the start of the diagnostic's range. */
  column: number;
}

/**
 * The result of parsing a line of marked-up text (upstream
 * `MarkupParseResult`): the original text with all parsed markers removed,
 * plus the list of attributes.
 */
export interface MarkupParseResult {
  text: string;
  attributes: MarkupAttribute[];
}

/**
 * Gets the first attribute with the specified name, if present (upstream
 * `MarkupParseResult.TryGetAttributeWithName`).
 */
export function tryGetAttributeWithName(
  result: MarkupParseResult,
  name: string,
): MarkupAttribute | undefined {
  return result.attributes.find((attribute) => attribute.name === name);
}

/**
 * Gets a property named `name` from an attribute, if present — property
 * names compare case-insensitively (upstream `MarkupAttribute.TryGetProperty`).
 */
export function tryGetProperty(attribute: MarkupAttribute, name: string): MarkupValue | undefined {
  for (const [key, value] of Object.entries(attribute.properties)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }
  return undefined;
}

/**
 * Returns the substring of `result.text` covered by `attribute`'s position
 * and length (upstream `MarkupParseResult.TextForAttribute`): the empty
 * string for a zero-length attribute.
 */
export function textForAttribute(result: MarkupParseResult, attribute: MarkupAttribute): string {
  if (attribute.length === 0) {
    return "";
  }
  if (result.text.length < attribute.position + attribute.length) {
    // Upstream throws here too (MarkupParseResult.cs TextForAttribute): a
    // range that exceeds the text is CALLER error, not line content — the
    // collect-don't-throw rule covers content problems, not API misuse.
    throw new RangeError(
      "Attribute represents a range not representable by this text. Does this MarkupAttribute belong to this MarkupParseResult?",
    );
  }
  return result.text.slice(attribute.position, attribute.position + attribute.length);
}

/**
 * Deletes an attribute's range from a markup parse result (upstream
 * `MarkupParseResult.DeleteRange`): returns a NEW result — the text has the
 * range removed, and surrounding attributes are shifted, truncated, or
 * deleted as upstream documents. A zero-length attribute deletes only
 * itself; the text is unmodified.
 */
export function deleteRange(result: MarkupParseResult, attributeToDelete: MarkupAttribute): MarkupParseResult {
  // The trivial case: a zero-length attribute didn't apply to any text, so
  // the plain text is left unmodified and only the attribute is removed.
  if (attributeToDelete.length === 0) {
    return {
      text: result.text,
      attributes: result.attributes.filter((a) => a !== attributeToDelete),
    };
  }

  const deletionStart = attributeToDelete.position;
  const deletionEnd = attributeToDelete.position + attributeToDelete.length;

  const editedSubstring =
    result.text.slice(0, deletionStart) + result.text.slice(deletionEnd);

  const newAttributes: MarkupAttribute[] = [];
  for (const existing of result.attributes) {
    if (existing === attributeToDelete) {
      continue;
    }
    const start = existing.position;
    const end = existing.position + existing.length;
    const edited = { ...existing };

    if (start <= deletionStart) {
      if (end <= deletionStart) {
        // Entirely before the deleted range: unmodified.
      } else if (end <= deletionEnd) {
        // Ends inside the deleted range: trim the length to the deletion start.
        edited.length = deletionStart - start;
        if (existing.length > 0 && edited.length <= 0) {
          // The attribute's contents were entirely removed.
          continue;
        }
      } else {
        // Ends after the deleted range: remove its length.
        edited.length = existing.length - attributeToDelete.length;
      }
    } else if (start >= deletionEnd) {
      // Begins after the deleted range: offset the start.
      edited.position = start - attributeToDelete.length;
    } else if (start >= deletionStart && end <= deletionEnd) {
      // Entirely within the deleted range: deleted too.
      continue;
    } else if (start >= deletionStart && end > deletionEnd) {
      // Starts within, ends outside: truncate the overlapping start.
      const overlapLength = deletionEnd - start;
      edited.position = deletionStart;
      edited.length = existing.length - overlapLength;
    }

    newAttributes.push(edited);
  }

  return { text: editedSubstring, attributes: newAttributes };
}

/**
 * A marker processor: produces replacement text for a named markup marker
 * (upstream `IAttributeMarkerProcessor`). Registered on a `LineParser` via
 * `registerMarkerProcessor`; the built-in processors implement the
 * `[select]`, `[plural]`, and `[ordinal]` replacement markers.
 */
export interface AttributeMarkerProcessor {
  processReplacementMarker(
    marker: MarkupAttribute,
    childBuilder: StringBuilder,
    childAttributes: MarkupAttribute[],
    localeCode: string,
  ): ReplacementMarkerResult;
}

/**
 * A bundle of results from processing a replacement marker (upstream
 * `ReplacementMarkerResult`).
 */
export interface ReplacementMarkerResult {
  /** Diagnostics produced during processing (collected, not thrown). */
  diagnostics: MarkupDiagnostic[];
  /**
   * The number of invisible characters the processing inserted into the
   * line (e.g. rich-text tags around the children's text).
   */
  invisibleCharacters: number;
}

/**
 * A minimal mutable string builder, the processing surface given to marker
 * processors (upstream passes a `System.Text.StringBuilder`, which
 * processors may insert into and append to).
 */
export class StringBuilder {
  private parts: string[];

  constructor(initial = "") {
    this.parts = initial === "" ? [] : [initial];
  }

  get length(): number {
    return this.parts.reduce((total, part) => total + part.length, 0);
  }

  append(text: string): this {
    if (text !== "") this.parts.push(text);
    return this;
  }

  /** Inserts `text` at `index` (clamped to [0, length]). */
  insert(index: number, text: string): this {
    if (text === "") return this;
    // Rebuild as a flat string for arbitrary-position inserts; processors
    // insert at most a few times per marker, so this stays cheap.
    const joined = this.parts.join("");
    const clamped = Math.max(0, Math.min(index, joined.length));
    this.parts = [joined.slice(0, clamped), text, joined.slice(clamped)];
    return this;
  }

  clear(): this {
    this.parts = [];
    return this;
  }

  toString(): string {
    return this.parts.join("");
  }
}
