// SPDX-License-Identifier: CC0-1.0
import React from "react";
import type { MarkupAttribute, MarkupParseResult } from "../markup/types.js";

interface MarkupRendererProps {
  text: string;
  markup?: MarkupParseResult;
  length?: number;
}

const DEFAULT_HTML_TAGS = new Set(["b", "em", "small", "strong", "sub", "sup", "ins", "del", "mark"]);

/**
 * Renders a markup parse result (the attribute model, ticket 48): the
 * text is sliced by the attributes' ranges, nested attributes wrap their
 * range, and zero-length markers (e.g. self-closing `[pause/]`) render as
 * empty elements at their position. Styling tags are opaque data: names
 * outside the default HTML set render as `span` with a class and
 * `data-markup-*` attributes for the consumer.
 */
export function MarkupRenderer({ text, markup, length }: MarkupRendererProps) {
  const maxLength = length ?? text.length;

  if (!markup || markup.attributes.length === 0) {
    return <>{text.slice(0, maxLength)}</>;
  }

  const source = markup.text;
  const limit = Math.max(0, Math.min(maxLength, source.length));

  const covering = (index: number): MarkupAttribute[] =>
    markup.attributes.filter(
      (attribute) =>
        attribute.length > 0 &&
        attribute.position <= index &&
        index < attribute.position + attribute.length,
    );

  // Group the text into runs by the set of attributes covering each index.
  interface Piece {
    start: number;
    end: number;
    attrs: MarkupAttribute[];
  }
  const pieces: Piece[] = [];
  let current: Piece | null = null;
  const sameAttrs = (a: MarkupAttribute[], b: MarkupAttribute[]) =>
    a.length === b.length && a.every((attr, i) => attr === b[i]);

  for (let i = 0; i < limit; i++) {
    const attrs = covering(i);
    if (current && sameAttrs(current.attrs, attrs)) {
      current.end = i + 1;
    } else {
      current = { start: i, end: i + 1, attrs };
      pieces.push(current);
    }
  }

  // Zero-length attributes (self-closing markers) render as empty
  // elements at their position.
  const markers = markup.attributes
    .filter((attribute) => attribute.length === 0 && attribute.position <= limit)
    .sort((a, b) => a.position - b.position);

  // Interleave markers and pieces by position: markers at a position emit
  // before the run of text starting there.
  const output: React.ReactNode[] = [];
  let offset = 0;
  let markerIndex = 0;
  for (const piece of pieces) {
    while (
      markerIndex < markers.length &&
      markers[markerIndex].position <= Math.max(offset, piece.start)
    ) {
      output.push(createWrapperElement(markers[markerIndex], `marker-${markerIndex}`, null));
      markerIndex += 1;
    }
    output.push(
      piece.attrs.reduceRight<React.ReactNode>(
        (child, attribute, index) =>
          createWrapperElement(attribute, `piece-${piece.start}-${index}`, child),
        source.slice(piece.start, piece.end),
      ),
    );
    offset = piece.end;
  }
  while (markerIndex < markers.length) {
    output.push(createWrapperElement(markers[markerIndex], `marker-${markerIndex}`, null));
    markerIndex += 1;
  }

  return <>{output}</>;
}

function createWrapperElement(
  attribute: MarkupAttribute,
  key: string,
  children: React.ReactNode
): React.ReactElement {
  const tagName = DEFAULT_HTML_TAGS.has(attribute.name) ? attribute.name : "span";
  const className = DEFAULT_HTML_TAGS.has(attribute.name)
    ? undefined
    : `yd-markup-${sanitizeClassName(attribute.name)}`;

  const dataAttributes: Record<string, string> = {};
  for (const [propertyName, value] of Object.entries(attribute.properties)) {
    dataAttributes[`data-markup-${propertyName}`] = String(
      value.type === "bool"
        ? value.boolValue
          ? "True"
          : "False"
        : value.type === "integer"
          ? value.integerValue
          : value.type === "float"
            ? value.floatValue
            : value.stringValue,
    );
  }

  return React.createElement(
    tagName,
    {
      key,
      className,
      ...dataAttributes,
    },
    children
  );
}

function sanitizeClassName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}
