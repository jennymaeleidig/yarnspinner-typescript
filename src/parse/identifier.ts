// SPDX-License-Identifier: CC0-1.0
/**
 * Upstream identifier character classes — the one home for the ID rule every
 * consumer previously restated as `[A-Za-z_][A-Za-z0-9_]*`: header keys,
 * variable names, enum case names, function and type names, node titles.
 *
 * The exported strings are character-class *sources* (the text between `[`
 * and `]`); compose them into `u`-flagged `RegExp`s — the astral ranges
 * (`\u{10000}`) are only valid with the `u` flag.
 *
 * Citation: transcribed from upstream's YarnSpinnerLexer.g4 IDENTIFIER_HEAD
 * / IDENTIFIER_CHARACTER fragments — Yarn Spinner 3.2.2
 * (YarnSpinner.Compiler/Grammars/YarnSpinnerLexer.g4),
 * https://github.com/YarnSpinnerTool/YarnSpinner (MIT).
 */

// IDENTIFIER_HEAD, in the g4's own order: the ASCII core, the explicit
// Unicode range list, then the per-block astral ranges.
const HEAD_ASCII = String.raw`a-zA-Z_`;
const HEAD_RANGES = String.raw`\u00A8\u00AA\u00AD\u00AF\u00B2-\u00B5\u00B7-\u00BA\u00BC-\u00BE\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0100-\u02FF\u0370-\u167F\u1681-\u180D\u180F-\u1DBF\u1E00-\u1FFF\u200B-\u200D\u202A-\u202E\u203F-\u2040\u2054\u2060-\u206F\u2070-\u20CF\u2100-\u218F\u2460-\u24FF\u2776-\u2793\u2C00-\u2DFF\u2E80-\u2FFF\u3004-\u3007\u3021-\u302F\u3031-\u303F\u3040-\uD7FF\uF900-\uFD3D\uFD40-\uFDCF\uFDF0-\uFE1F\uFE30-\uFE44\uFE47-\uFFFD`;
const HEAD_ASTRAL = String.raw`\u{10000}-\u{1FFFD}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}\u{40000}-\u{4FFFD}\u{50000}-\u{5FFFD}\u{60000}-\u{6FFFD}\u{70000}-\u{7FFFD}\u{80000}-\u{8FFFD}\u{90000}-\u{9FFFD}\u{A0000}-\u{AFFFD}\u{B0000}-\u{BFFFD}\u{C0000}-\u{CFFFD}\u{D0000}-\u{DFFFD}\u{E0000}-\u{EFFFD}`;

/** IDENTIFIER_HEAD: the first character of an identifier. */
export const IDENTIFIER_HEAD = HEAD_ASCII + HEAD_RANGES + HEAD_ASTRAL;

/** IDENTIFIER_CHARACTER: digits and the combining-mark ranges, plus
 *  IDENTIFIER_HEAD (a continuation character of an identifier). */
export const IDENTIFIER_CHARACTER =
  String.raw`0-9\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F` + IDENTIFIER_HEAD;

/** The full ID rule: one IDENTIFIER_HEAD, then IDENTIFIER_CHARACTERS. */
export const IDENTIFIER = `[${IDENTIFIER_HEAD}][${IDENTIFIER_CHARACTER}]*`;

/** Single-code-unit test for an identifier's head character — the
 *  tokenizer scans that walk one UTF-16 code unit at a time use this to
 *  gate an identifier read. */
export const IDENTIFIER_HEAD_TEST = new RegExp(`[${IDENTIFIER_HEAD}]`, "u");

/** A negative lookahead over the identifier-continuation characters
 *  (digits, combining marks, heads): anchors an identifier match at its
 *  end, the boundary the lexers get for free from longest-match. */
export const NOT_IDENTIFIER_CHARACTER = String.raw`(?![${IDENTIFIER_CHARACTER}])`;