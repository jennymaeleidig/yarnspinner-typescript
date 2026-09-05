// SPDX-License-Identifier: CC0-1.0
import { ParseError } from "./parseError.js";

export interface Token {
  type:
    | "HEADER_KEY"
    | "HEADER_VALUE"
    | "NODE_START" // --- or -=-
    | "NODE_END" // ===
    | "OPTION" // ->
    | "LINE_GROUP" // => (line-group item)
    | "COMMAND" // <<...>> (single-line)
    | "TEXT" // any non-empty content line
    | "EMPTY"
    | "INDENT"
    | "DEDENT"
    | "EOF";
  text: string;
  line: number;
  column: number;
  /**
   * A `//`-comment after the closing `>>` on a command line. Only `///`
   * documentation comments are consumed (parser: they become the declared
   * variable's description, upstream `allowCommentsAfter`);
   * plain `//` trails are ignored.
   */
  trailingComment?: string;
  /**
   * Hashtags on the same line directly after the closing `>>` (upstream
   * `command_statement`'s `hashtag*`): `<<cmd>> #color:red`. Full tag text
   * (`#cool-tag` keeps its hyphen; HASHTAG_TEXT is `~[ \t\r\n#$<]+`).
   */
  tags?: string[];
}

// Minimal indentation-sensitive lexer to support options and their bodies.

/**
 * The index of a command's closing `>>` in a line whose command span starts
 * at `<<` (index 0 assumed): the FIRST `>>` outside quoted strings. The
 * expression-bearing command keywords push ExpressionMode, whose STRING
 * rule shields quotes — `<<set $x to "a>>b">>` ends after the real closing
 * quote. Arbitrary commands (CommandTextMode) have no string mode, so their
 * scan is the same quote-aware walk (it only ever moves the end LATER than
 * the raw first `>>`, and only when a quote precedes it).
 *
 * Citation: adapted from upstream's YarnSpinnerLexer.g4 STRING /
 * EXPRESSION_COMMAND_END / COMMAND_END rules —
 * YarnSpinner 3.2.2 (YarnSpinner.Compiler/Grammars/YarnSpinnerLexer.g4),
 * https://github.com/YarnSpinnerTool/YarnSpinner (MIT).
 */
function commandEndIndex(line: string): number {
  let i = 2;
  let quote: string | null = null;
  while (i < line.length) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === ">" && line[i + 1] === ">") return i;
    i++;
  }
  return -1;
}

/**
 * A hashtag's text at `#`: the run of non-delimiter characters after it
 * (upstream HASHTAG_TEXT: `~[ \t\r\n#$<]+` — `#cool-tag` keeps its hyphen,
 * digit-start tags extract, `$` and `<` end the tag), with optional
 * whitespace between `#` and the text (upstream HashtagMode's HASHTAG_WS).
 * Returns the tag text and the index past it, or null when `#` opens no
 * hashtag.
 */
export function readHashtagText(line: string, at: number): { text: string; end: number } | null {
  let j = at + 1;
  while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
  if (j >= line.length || /[\s#$<]/.test(line[j])) return null;
  let end = j;
  while (end < line.length && !/[\s#$<]/.test(line[end])) end++;
  return { text: line.slice(j, end), end };
}

export function lex(input: string): Token[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const tokens: Token[] = [];
  const indentStack: number[] = [0];

  let inHeaders = true;

  /** The last non-EMPTY line's token type + raw indent — the indentation
   *  validation only inspects options and line-group items. */
  let lastContent: { type: Token["type"]; indent: number } | null = null;

  /** Raw indent of the line currently being lexed (push() records it). */
  let currentIndent = 0;

  function push(
    type: Token["type"],
    text: string,
    line: number,
    column: number,
    trailingComment?: string,
  ) {
    const token: Token = { type, text, line, column };
    if (trailingComment !== undefined) token.trailingComment = trailingComment;
    tokens.push(token);
    if (type !== "EMPTY") lastContent = { type, indent: currentIndent };
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNum = i + 1;
    const indent = raw.match(/^[ \t]*/)?.[0] ?? "";
    currentIndent = indent.length;
    const content = raw.slice(indent.length);

    if (content.trim() === "") {
      // Indentation validation (upstream ParseFailures case
      // "IndentedLinesFollowingOptionsMustHaveContent"): a whitespace-only
      // line indented past an option/line-group line would start a body
      // with no content — upstream reports the extraneous empty text as a
      // syntax error (YS0005 via the compile seam). Blank lines at or below
      // the option's indent are legal group separators, and indented blanks
      // after body content are fine too (verified against upstream).
      // (The assertion defeats TS's closure-narrowing of lastContent: the
      // assignments happen inside push(), and the runtime value is always
      // the declared type.)
      const last = lastContent as { type: Token["type"]; indent: number } | null;
      if (
        last &&
        (last.type === "OPTION" || last.type === "LINE_GROUP") &&
        indent.length > last.indent
      ) {
        throw new ParseError(
          "An indented line following an option must have content",
          { startLine: lineNum - 1, startCol: 0, endLine: lineNum - 1, endCol: raw.length },
        );
      }
      push("EMPTY", "", lineNum, 1);
      continue;
    }

    // Manage indentation tokens only within node bodies and on non-empty lines
    if (!inHeaders) {
      const prev = indentStack[indentStack.length - 1];
      if (indent.length > prev) {
        indentStack.push(indent.length);
        push("INDENT", "", lineNum, 1);
      } else if (indent.length < prev) {
        while (indentStack.length && indent.length < indentStack[indentStack.length - 1]) {
          indentStack.pop();
          push("DEDENT", "", lineNum, 1);
        }
      }
    }

    // Node header/body separator: `---`, or upstream's alternate `-=-`
    // (the vendored diagnostic-definition examples use it).
    if (content === "---" || content === "-=-") {
      inHeaders = false;
      push("NODE_START", content, lineNum, indent.length + 1);
      continue;
    }
    if (content === "===") {
      inHeaders = true;
      // flush indentation to root
      while (indentStack.length > 1) {
        indentStack.pop();
        push("DEDENT", "", lineNum, 1);
      }
      push("NODE_END", content, lineNum, indent.length + 1);
      continue;
    }

    // Header: key: value (only valid while inHeaders). Upstream
    // HeaderMode's HEADER_COMMENT strips a `//` comment from the value
    // (comments go to the COMMENTS channel; the value text ends there).
    if (inHeaders) {
      const m = content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (m) {
        let value = m[2];
        const comment = value.indexOf("//");
        if (comment !== -1) value = value.slice(0, comment).trimEnd();
        push("HEADER_KEY", m[1], lineNum, indent.length + 1);
        push("HEADER_VALUE", value, lineNum, indent.length + 1 + m[0].indexOf(m[2]));
        continue;
      }
    }

    if (content.startsWith("->")) {
      push("OPTION", content.slice(2).trim(), lineNum, indent.length + 1);
      continue;
    }

    // Line-group item: `=> text` — like an option arrow, the
    // `=>` prefix is consumed by the lexer; the parser owns the rest of the
    // line-suffix pipeline.
    if (content.startsWith("=>")) {
      push("LINE_GROUP", content.slice(2).trim(), lineNum, indent.length + 1);
      continue;
    }

    // Commands like <<...>>. A command ends at the FIRST `>>` (upstream
    // CommandMode's COMMAND_END), so a second command or a hashtag on the
    // same line stays out of the command's content (upstream grammar:
    // `command_statement : COMMAND_START command_formatted_text COMMAND_END
    // (hashtag*)`). Inside the expression-bearing command keywords (`if`,
    // `elseif`, `set`, `declare`, `call`, `case` — the ones that push
    // ExpressionMode), quoted strings shield `>>` (the ExpressionMode
    // STRING rule); arbitrary commands (CommandTextMode) have no string
    // mode and end at the first `>>`. A trailing `//` comment is not part
    // of the command (upstream lexer skips comments). Empty command content
    // (`<<>>`) is allowed through as an empty COMMAND: the parser reports
    // it with upstream's "Command text expected" (TestEmptyCommand) — the
    // lexer must not silently demote it to text.
    if (content.startsWith("<<")) {
      let remaining = content;
      for (;;) {
        const close = commandEndIndex(remaining);
        if (close === -1) {
          // A line opening a command but never closing it (upstream
          // ParseFailures case "NewlinesNotPermittedInCommands"): upstream's
          // lexer hits the newline while still in command mode and reports
          // YS0006 UnclosedCommand. Only the truly unclosed shape is
          // rejected; closed spans continue below.
          throw new ParseError(
            "Unclosed command: missing >>",
            { startLine: lineNum - 1, startCol: indent.length, endLine: lineNum - 1, endCol: indent.length + content.length },
            "YS0006",
          );
        }
        const inner = remaining.slice(2, close);
        const tail = remaining.slice(close + 2);
        const tags: string[] = [];
        let trailingComment: string | undefined;
        let textStart = -1;
        let resumeCommandAt = -1;
        let k = 0;
        while (k < tail.length) {
          const ch = tail[k];
          if (ch === " " || ch === "\t") {
            k++;
            continue;
          }
          if (ch === "/" && tail[k + 1] === "/") {
            trailingComment = tail.slice(k);
            k = tail.length;
            break;
          }
          if (ch === "#") {
            const tag = readHashtagText(tail, k);
            if (tag) {
              tags.push(tag.text);
              k = tag.end;
              continue;
            }
          }
          if (ch === "<" && tail[k + 1] === "<") {
            resumeCommandAt = k;
            break;
          }
          textStart = k;
          break;
        }
        push("COMMAND", inner.trim(), lineNum, indent.length + 1, trailingComment);
        if (tags.length > 0) tokens[tokens.length - 1].tags = tags;
        if (resumeCommandAt >= 0) {
          remaining = tail.slice(resumeCommandAt);
          continue;
        }
        if (textStart >= 0) {
          // Trailing dialogue after a command re-enters text mode (upstream
          // lexes a line_statement after the command_statement on the same
          // line; the parser reports YS0019 for the shape).
          const textPart = tail.slice(textStart);
          push("TEXT", textPart, lineNum, indent.length + 1 + (content.length - textPart.length));
        }
        break;
      }
      continue;
    }

    // Plain text line
    push("TEXT", content, lineNum, indent.length + 1);
  }

  // close remaining indentation at EOF
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ type: "DEDENT", text: "", line: lines.length, column: 1 });
  }

  tokens.push({ type: "EOF", text: "", line: lines.length + 1, column: 1 });
  return tokens;
}


