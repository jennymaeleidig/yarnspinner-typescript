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
   * variable's description, upstream `allowCommentsAfter` — ticket 54);
   * plain `//` trails are ignored.
   */
  trailingComment?: string;
}

// Minimal indentation-sensitive lexer to support options and their bodies.
export function lex(input: string): Token[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const tokens: Token[] = [];
  const indentStack: number[] = [0];

  let inHeaders = true;

  /** The last non-EMPTY line's token type + raw indent — the indentation
   *  validation (ticket 54) only inspects options and line-group items. */
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
      // Indentation validation (ticket 54, upstream ParseFailures case
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
    // (ticket 65 — the vendored diagnostic-definition examples use it).
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

    // Header: key: value (only valid while inHeaders)
    if (inHeaders) {
      const m = content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (m) {
        push("HEADER_KEY", m[1], lineNum, indent.length + 1);
        push("HEADER_VALUE", m[2], lineNum, indent.length + 1 + m[0].indexOf(m[2]));
        continue;
      }
    }

    if (content.startsWith("->")) {
      push("OPTION", content.slice(2).trim(), lineNum, indent.length + 1);
      continue;
    }

    // Line-group item (ticket 47): `=> text` — like an option arrow, the
    // `=>` prefix is consumed by the lexer; the parser owns the rest of the
    // line-suffix pipeline.
    if (content.startsWith("=>")) {
      push("LINE_GROUP", content.slice(2).trim(), lineNum, indent.length + 1);
      continue;
    }

    // Commands like <<...>> (single line); a trailing // comment after the
    // closing >> is not part of the command (upstream lexer skips comments).
    const cmd = content.match(/^<<(.+?)>>\s*(\/\/.*)?$/);
    if (cmd) {
      push("COMMAND", cmd[1].trim(), lineNum, indent.length + 1, cmd[2]);
      continue;
    }

    // A line opening a command but never closing it (ticket 54, upstream
    // ParseFailures case "NewlinesNotPermittedInCommands"): upstream's
    // lexer hits the newline while still in command mode and reports
    // YS0006 UnclosedCommand. Lines whose `>>` closes but carries text
    // after it are line-level `<<if>>`/`<<once>>` modifier lines (legal
    // here), so only the truly unclosed shape is rejected.
    if (content.startsWith("<<") && !content.includes(">>")) {
      throw new ParseError(
        "Unclosed command: missing >>",
        { startLine: lineNum - 1, startCol: indent.length, endLine: lineNum - 1, endCol: indent.length + content.length },
        "YS0006",
      );
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


