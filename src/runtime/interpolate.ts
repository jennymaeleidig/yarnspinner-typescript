/**
 * Line composition (the runtime line-parser stage): `{expr}` substitutions
 * expanded, then markup segments rebuilt around the substituted spans.
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

import type { MarkupParseResult, MarkupSegment, MarkupWrapper } from "../markup/types.js";
import { stringifyOperand } from "./evaluator.js";

/**
 * Expand `{expr}` substitutions in `text` (and rebuild `markup` segments
 * around the substituted spans when markup is supplied). Returns the
 * composed text and — only when formatting markup survived — the rebuilt
 * markup result.
 */
export function interpolate(
  text: string,
  evaluateExpression: (expr: string) => unknown,
  markup?: MarkupParseResult,
): { text: string; markup?: MarkupParseResult } {
  const evaluate = (expr: string): string => {
    try {
      const value = evaluateExpression(expr.trim());
      if (value === null || value === undefined) {
        return "";
      }
      // Upstream composed text (C# ToString): booleans as "True"/"False".
      return stringifyOperand(value);
    } catch {
      return "";
    }
  };

  if (!markup) {
    // Escaped braces (`\{`, `\}` — the tier-2 unescape keeps them for the
    // runtime line parser) compose as literal braces; unescaped braces
    // expand their expression.
    const interpolated = text.replace(
      /\\([{}])|\{([^}]+)\}/g,
      (_m, esc: string | undefined, expr: string | undefined) => (esc ? esc : evaluate(expr!)),
    );
    return { text: interpolated };
  }

  const segments = markup.segments.filter((segment) => !segment.selfClosing);
  const getWrappersAt = (index: number): MarkupWrapper[] => {
    for (const segment of segments) {
      if (segment.start <= index && index < segment.end) {
        return segment.wrappers.map((wrapper) => ({
          name: wrapper.name,
          type: wrapper.type,
          properties: { ...wrapper.properties },
        }));
      }
    }
    if (segments.length === 0) {
      return [];
    }
    if (index > 0) {
      return getWrappersAt(index - 1);
    }
    return segments[0].wrappers.map((wrapper) => ({
      name: wrapper.name,
      type: wrapper.type,
      properties: { ...wrapper.properties },
    }));
  };

  const resultChars: string[] = [];
  const newSegments: MarkupSegment[] = [];
  let currentSegment: MarkupSegment | null = null;

  const wrappersEqual = (a: MarkupWrapper[], b: MarkupWrapper[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const wa = a[i];
      const wb = b[i];
      if (wa.name !== wb.name || wa.type !== wb.type) return false;
      const keysA = Object.keys(wa.properties);
      const keysB = Object.keys(wb.properties);
      if (keysA.length !== keysB.length) return false;
      for (const key of keysA) {
        if (wa.properties[key] !== wb.properties[key]) return false;
      }
    }
    return true;
  };

  const flushSegment = () => {
    if (currentSegment) {
      newSegments.push(currentSegment);
      currentSegment = null;
    }
  };

  const appendCharWithWrappers = (char: string, wrappers: MarkupWrapper[]) => {
    const index = resultChars.length;
    resultChars.push(char);
    const wrappersCopy = wrappers.map((wrapper) => ({
      name: wrapper.name,
      type: wrapper.type,
      properties: { ...wrapper.properties },
    }));
    if (currentSegment && wrappersEqual(currentSegment.wrappers, wrappersCopy)) {
      currentSegment.end = index + 1;
    } else {
      flushSegment();
      currentSegment = { start: index, end: index + 1, wrappers: wrappersCopy };
    }
  };

  const appendStringWithWrappers = (value: string, wrappers: MarkupWrapper[]) => {
    if (!value) {
      flushSegment();
      return;
    }
    for (const ch of value) {
      appendCharWithWrappers(ch, wrappers);
    }
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && (text[i + 1] === "{" || text[i + 1] === "}")) {
      // Escaped brace: compose the literal character (the wrapper context is
      // the backslash's position).
      appendCharWithWrappers(text[i + 1], getWrappersAt(Math.max(0, Math.min(i, text.length - 1))));
      i += 2;
      continue;
    }
    if (char === '{') {
      const close = text.indexOf('}', i + 1);
      if (close === -1) {
        appendCharWithWrappers(char, getWrappersAt(Math.max(0, Math.min(i, text.length - 1))));
        i += 1;
        continue;
      }
      const expr = text.slice(i + 1, close);
      const evaluated = evaluate(expr);
      const wrappers = getWrappersAt(Math.max(0, Math.min(i, text.length - 1)));
      appendStringWithWrappers(evaluated, wrappers);
      i = close + 1;
      continue;
    }
    appendCharWithWrappers(char, getWrappersAt(i));
    i += 1;
  }

  flushSegment();
  const interpolatedText = resultChars.join('');
  const normalizedMarkup = normalizeMarkupResult({ text: interpolatedText, segments: newSegments });
  return { text: interpolatedText, markup: normalizedMarkup };
}

function normalizeMarkupResult(result: MarkupParseResult): MarkupParseResult | undefined {
  if (!result) return undefined;
  if (result.segments.length === 0) {
    return undefined;
  }
  const hasFormatting = result.segments.some(
    (segment) => segment.wrappers.length > 0 || segment.selfClosing
  );
  if (!hasFormatting) {
    return undefined;
  }
  return {
    text: result.text,
    segments: result.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      wrappers: segment.wrappers.map((wrapper) => ({
        name: wrapper.name,
        type: wrapper.type,
        properties: { ...wrapper.properties },
      })),
      selfClosing: segment.selfClosing,
    })),
  };
}
