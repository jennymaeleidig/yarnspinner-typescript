import { lex, Token } from "./lexer.js";
import type {
  YarnDocument,
  YarnNode,
  Statement,
  Line,
  Command,
  OptionGroup,
  LineGroup,
  Option,
  IfBlock,
  OnceBlock,
  Jump,
  Detour,
  EnumBlock,
  EnumCaseDef,
} from "../model/ast";

export class ParseError extends Error {
  /** 0-based source range of the offending token, when known. */
  range?: { startLine: number; startCol: number; endLine: number; endCol: number };
  constructor(message: string, range?: ParseError["range"]) {
    super(message);
    this.range = range;
  }
}

export function parseYarn(text: string): YarnDocument {
  const tokens = lex(text);
  const p = new Parser(tokens);
  return p.parseDocument();
}

/**
 * Speaker identity is resolved at RUNTIME by the line parser's implicit
 * `[character name=]` marker (ticket 48) — no compile-time regex split.
 * The compiler stores raw line text; the speaker surfaces on the delivered
 * event, derived from the markup attribute.
 */

/**
 * Truncate line text at the first unescaped `//` outside `<<...>>` spans
 * (upstream: an unescaped `//` starts a comment anywhere in line text, so
 * a literal `//` — a URL, say — must be written `\/`). Escape-aware: `\X`
 * pairs are skipped.
 */
function truncateAtComment(text: string): string {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "<" && text[i + 1] === "<") {
      const close = text.indexOf(">>", i + 2);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") return text.slice(0, i);
  }
  return text;
}

/** A line-level modifier: `<<if expr>>` or `<<once>>`/`<<once if expr>>`. */
type LineModifier = { kind: "if"; condition: string } | { kind: "once"; condition?: string };

/**
 * Extract the line-level `<<if expr>>` / `<<once>>` / `<<once if expr>>`
 * modifier (upstream line conditions). At most one modifier per line or
 * option; an expression-less `<<if>>` or `<<once if>>` is the upstream
 * ParseFailures case (YS0005 via the compile seam).
 */
function extractLineModifier(text: string, token: Token): { text: string; modifier?: LineModifier } {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "<" && text[i + 1] === "<") {
      const close = text.indexOf(">>", i + 2);
      if (close === -1) break;
      const inner = text.slice(i + 2, close).trim();
      const modifier = parseModifierInner(inner, token);
      if (modifier) {
        const remainder = (text.slice(0, i) + " " + text.slice(close + 2)).trim();
        if (extractLineModifier(remainder, token).modifier) {
          throw new ParseError(
            "A line or option can have only one <<if>>/<<once>> condition (Yarn Spinner 3.x syntax)",
            rangeOf(token),
          );
        }
        return { text: remainder, modifier };
      }
      i = close + 1;
      continue;
    }
  }
  return { text };
}

function parseModifierInner(inner: string, token: Token): LineModifier | null {
  const onceIf = inner.match(/^once\s+if\s+([\s\S]+)$/);
  if (onceIf) {
    const condition = onceIf[1].trim();
    if (!condition) {
      throw new ParseError("<<once if>> requires an expression (Yarn Spinner 3.x syntax)", rangeOf(token));
    }
    return { kind: "once", condition };
  }
  if (inner === "once") return { kind: "once" };
  if (inner === "if") {
    throw new ParseError(
      "Option condition <<if>> requires an expression (Yarn Spinner 3.x syntax)",
      rangeOf(token),
    );
  }
  const plainIf = inner.match(/^if\s+([\s\S]+)$/);
  if (plainIf) {
    const condition = plainIf[1].trim();
    if (!condition) {
      throw new ParseError("<<if>> requires an expression (Yarn Spinner 3.x syntax)", rangeOf(token));
    }
    return { kind: "if", condition };
  }
  return null;
}

/**
 * The main-grammar escape sequences (upstream TextEscapedMode) unescape to
 * the literal character at compile time: `\#`, `\<`, `\>`, `\/`, `\\`. The
 * runtime-owned escapes — `\{`, `\}`, `\[`, `\]`, `\:` — keep their
 * backslash; the line-parser module consumes them at delivery (upstream
 * leaves them for its LineParser too).
 */
const MAIN_GRAMMAR_ESCAPES: ReadonlySet<string> = new Set(["#", "<", ">", "/", "\\"]);

function unescapeMainGrammar(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length && MAIN_GRAMMAR_ESCAPES.has(text[i + 1])) {
      out += text[i + 1];
      i++;
      continue;
    }
    out += text[i];
  }
  return out;
}

function rangeOf(token: Token): ParseError["range"] {
  return {
    startLine: token.line - 1,
    startCol: token.column - 1,
    endLine: token.line - 1,
    endCol: token.column - 1 + Math.max(token.text.length, 1),
  };
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0) {
    return this.tokens[this.i + offset];
  }
  private at(type: Token["type"]) {
    return this.peek()?.type === type;
  }
  private take(type: Token["type"], err?: string): Token {
    const t = this.peek();
    if (!t || t.type !== type) throw new ParseError(err ?? `Expected ${type}, got ${t?.type}`, this.rangeAt(this.peek()));
    this.i++;
    return t;
  }

  /** 0-based half-open range covering a token (the diagnostics convention). */
  private rangeAt(t?: Token) {
    if (!t) return undefined;
    return {
      startLine: t.line - 1,
      startCol: t.column - 1,
      endLine: t.line - 1,
      endCol: t.column - 1 + Math.max(t.text.length, 1),
    };
  }
  private takeIf(type: Token["type"]) {
    if (this.at(type)) return this.take(type);
    return null;
  }

  /**
   * Consume one lexer-emitted indentation token if the current statement
   * context treats it as transparent. The lexer emits INDENT/DEDENT for any
   * indentation change, and upstream fixtures deliberately mix indent levels
   * inside if/once/option bodies, so statement loops skip these tokens unless
   * the enclosing construct owns them (shared by the three statement loops).
   */
  private skipIndentTransparency(endType?: Token["type"]): boolean {
    if (this.at("INDENT") || (this.at("DEDENT") && endType !== "DEDENT")) {
      this.i++;
      return true;
    }
    return false;
  }

  parseDocument(): YarnDocument {
    const enums: EnumBlock[] = [];
    const nodes: YarnNode[] = [];
    // File-level hashtags (upstream file_hashtag): `#tag` lines preceding
    // the first node. Surfaced in the compile result's per-file `fileTags`.
    const fileTags: string[] = [];
    while (this.at("TEXT") && this.peek().text.trimStart().startsWith("#")) {
      const tagLine = this.take("TEXT").text.trim();
      for (const tag of tagLine.split(/^#+|\s#+/).filter(Boolean)) {
        const name = tag.trim();
        if (name) fileTags.push(name);
      }
      while (this.at("EMPTY")) this.i++;
    }
    while (!this.at("EOF")) {
      // Skip empties
      while (this.at("EMPTY")) this.i++;
      if (this.at("EOF")) break;
      
      // Check if this is an enum definition (top-level)
      if (this.at("COMMAND")) {
        const cmd = this.peek().text.trim();
        if (cmd.startsWith("enum ")) {
          const enumCmd = this.take("COMMAND").text; // consume the enum command
          const enumName = enumCmd.slice(5).trim();
          const enumDef = this.parseEnumBlock(enumName);
          enums.push(enumDef);
          continue;
        }
      }
      
      nodes.push(this.parseNode());
    }
    return {
      type: "Document",
      enums,
      nodes,
      ...(fileTags.length > 0 ? { fileTags } : {}),
    };
  }

  private parseNode(): YarnNode {
    const headers: Record<string, string> = {};
    let title: string | null = null;
    let titleHeaderCount = 0;
    let nodeTags: string[] | undefined;
    let whenConditions: string[] = [];
    let startLine: number | undefined;

    // headers
    while (!this.at("NODE_START")) {
      const keyTok = this.take("HEADER_KEY", "Expected node header before '---'");
      startLine ??= keyTok.line;
      const valTok = this.take("HEADER_VALUE", "Expected header value");
      if (keyTok.text === "title") {
        // Upstream recovers from a repeated title: header, keeping the FIRST
        // title (YS0052 NodeHasMoreThanOneTitle).
        if (title === null) title = valTok.text.trim();
        else titleHeaderCount++;
      }
      if (keyTok.text === "tags") {
        const raw = valTok.text.trim();
        nodeTags = raw.split(/\s+/).filter(Boolean);
      }
      if (keyTok.text === "when") {
        // Each when: header adds one condition (can have multiple when: headers)
        const raw = valTok.text.trim();
        whenConditions.push(raw);
      }
      // Removed fork extension (ticket 40): header-carried &css{} styles are
      // rejected with a YS0005 diagnostic via the compile seam.
      this.rejectRemovedSyntax(valTok.text, valTok);
      headers[keyTok.text] = valTok.text;
      // allow empty lines
      while (this.at("EMPTY")) this.i++;
    }
    if (!title) {
      throw new ParseError("Every node must have a title header", this.rangeAt(this.peek()));
    }
    this.take("NODE_START");
    // allow optional empties after ---
    while (this.at("EMPTY")) this.i++;

    const body: Statement[] = this.parseStatementsUntil("NODE_END");
    this.take("NODE_END", "Expected node end '==='");
    return { 
      type: "Node", 
      title, 
      headers, 
      nodeTags, 
      when: whenConditions.length > 0 ? whenConditions : undefined,
      duplicateTitleHeaders: titleHeaderCount > 0 ? titleHeaderCount : undefined,
      startLine,
      body 
    };
  }

  /**
   * Set by parseStatementsUntil: whether blank line(s) immediately preceded
   * the terminating token (used to detect option-group separation).
   */
  private trailingBlankBeforeEnd = false;

  private parseStatementsUntil(endType: Token["type"]): Statement[] {
    const out: Statement[] = [];
    this.trailingBlankBeforeEnd = false;
    while (!this.at(endType) && !this.at("EOF")) {
      // skip extra empties
      let blanks = 0;
      while (this.at("EMPTY")) { this.i++; blanks++; }
      if (this.at(endType) || this.at("EOF")) {
        this.trailingBlankBeforeEnd = blanks > 0;
        break;
      }

      if (this.at("OPTION")) {
        out.push(this.parseOptionGroup());
        continue;
      }

      // A line group: consecutive `=>` lines (ticket 47).
      if (this.at("LINE_GROUP")) {
        out.push(this.parseLineGroup());
        continue;
      }

      // Full-line // comments are not dialogue content (upstream lexer skips them)
      if (this.at("TEXT") && this.peek().text.trimStart().startsWith("//")) {
        this.i++;
        continue;
      }

      // Indentation tokens are transparent outside the constructs that own
      // them (see skipIndentTransparency). Only endType terminates here.
      if (this.skipIndentTransparency(endType)) continue;

      const stmt = this.parseStatement();
      out.push(stmt);
    }
    return out;
  }

  private parseStatement(): Statement {
    const t = this.peek();
    if (!t) throw new ParseError("Unexpected EOF");

    if (t.type === "COMMAND") {
      const cmd = this.take("COMMAND").text;
      if (cmd.startsWith("jump ")) return { type: "Jump", target: cmd.slice(5).trim() } as Jump;
      if (cmd.startsWith("detour ")) return { type: "Detour", target: cmd.slice(7).trim() } as Detour;
      if (cmd.startsWith("if ")) return this.parseIfCommandBlock(cmd);
      if (cmd === "once" || cmd.startsWith("once ")) return this.parseOnceBlock(cmd);
      if (cmd.startsWith("enum ")) {
        const enumName = cmd.slice(5).trim();
        return this.parseEnumBlock(enumName);
      }
      // $-prefix strictness (ticket 40, spec story 10): state commands must
      // target a $-prefixed variable; bare names get a YS0005 via the seam.
      const stateCmd = cmd.match(/^(set|declare)\s+(\S+)/);
      if (stateCmd && !stateCmd[2].startsWith("$")) {
        throw new ParseError(
          `Variables must be prefixed with '$' — <<${stateCmd[1]} ${stateCmd[2]} ...>> uses a bare variable name (Yarn Spinner 3.x requires the $ prefix)`,
          this.rangeAt(t),
        );
      }
      return { type: "Command", content: cmd } as Command;
    }
    if (t.type === "TEXT") {
      return this.parseLineFromText(this.take("TEXT").text, t);
    }
    throw new ParseError(`Unexpected token ${t.type}`, this.rangeAt(t));
  }

  /**
   * One line-group item, from a LINE_GROUP token (the lexer consumed the
   * `=>` prefix): the same line-suffix pipeline as a text line.
   */
  private parseLineGroupItem(token: Token): Line {
    return this.parseLineFromText(token.text, token);
  }

  /**
   * A line group (ticket 47): the consecutive run of `=>` line statements.
   * Blank lines, comments, and indentation tokens between items do not
   * break the group (upstream: the group is the run of line_group_items —
   * comments are not statements and blank lines are not either); any other
   * statement ends it.
   */
  private parseLineGroup(): LineGroup {
    const items: Line[] = [];
    while (!this.at("EOF")) {
      if (this.at("LINE_GROUP")) {
        items.push(this.parseLineGroupItem(this.take("LINE_GROUP")));
        continue;
      }
      if (this.at("EMPTY")) {
        this.i++;
        continue;
      }
      if (this.at("TEXT") && this.peek().text.trimStart().startsWith("//")) {
        this.i++;
        continue;
      }
      break;
    }
    return { type: "LineGroup", items };
  }

  /**
   * Parse one line of text (a TEXT or LINE_GROUP token's content) through
   * the line-suffix pipeline (upstream TextMode order): an unescaped `//`
   * comment ends the line; a `<<if>>`/`<<once>>`/`<<once if>>` modifier is
   * extracted; hashtags are pulled. The text is stored raw — markup
   * parsing, `{expr}` substitution, and speaker resolution all happen at
   * runtime through the line-parser module (ticket 48); the runtime-owned
   * escapes (`\{`, `\}`, `\[`, `\]`, `\:`) keep their backslashes.
   */
  private parseLineFromText(raw: string, token: Token): Line {
    const commented = truncateAtComment(raw).trimEnd();
    const { text: withoutModifier, modifier } = extractLineModifier(commented, token);
    const { cleanText: textWithoutTags, tags } = this.extractTags(withoutModifier);
    // Removed fork extensions (ticket 40): &css{} and inline {if} blocks.
    this.rejectRemovedSyntax(textWithoutTags, token);
    const line: Line = {
      type: "Line",
      text: unescapeMainGrammar(textWithoutTags),
      tags,
      lineNumber: token.line,
    };
    if (modifier?.kind === "if") line.condition = modifier.condition;
    if (modifier?.kind === "once") line.once = modifier.condition ? { condition: modifier.condition } : {};
    return line;
  }

  private parseOptionGroup(): OptionGroup {
    const options: Option[] = [];
    // Reset here: the flag is only meaningful to the parseStatementsUntil
    // invocation that set it. Nested body parses (an option body ending in
    // blank lines) would otherwise leak a stale "ended after blanks" into
    // this loop and split consecutive options into separate groups.
    this.trailingBlankBeforeEnd = false;
    // One or more OPTION lines, with bodies under INDENT
    while (this.at("OPTION")) {
      const optTok = this.take("OPTION");
      const raw = optTok.text;
      // Option-line pipeline: same stages as a text line (see
      // parseStatement) — comment, condition/once modifier, hashtags. The
      // option's text is stored raw; markup and substitutions compose at
      // runtime through the line-parser module (ticket 48).
      const commented = truncateAtComment(raw).trimEnd();
      const { text: withoutModifier, modifier } = extractLineModifier(commented, optTok);
      const { cleanText: textWithAttrs, tags } = this.extractTags(withoutModifier);
      // Removed fork extensions (ticket 40): &css{} and the [if expr] option
      // condition suffix.
      this.rejectRemovedSyntax(textWithAttrs, optTok);
      let body: Statement[] = [];
      if (this.at("INDENT")) {
        this.take("INDENT");
        body = this.parseStatementsUntil("DEDENT");
        this.take("DEDENT");
        while (this.at("EMPTY")) this.i++;
      }
      const option: Option = {
        type: "Option",
        text: unescapeMainGrammar(textWithAttrs),
        body,
        tags,
        lineNumber: optTok.line,
      };
      if (modifier?.kind === "if") option.condition = modifier.condition;
      if (modifier?.kind === "once") option.once = modifier.condition ? { condition: modifier.condition } : {};
      options.push(option);
      // Consecutive options belong to the same group; a blank line between
      // options separates groups (upstream: options must be consecutive lines).
      let blanks = 0;
      while (this.at("EMPTY")) { this.i++; blanks++; }
      if (blanks > 0 || this.trailingBlankBeforeEnd) break;
    }
    return { type: "OptionGroup", options };
  }

  private extractTags(input: string): { cleanText: string; tags?: string[] } {
    const tags: string[] = [];
    // Match tags that are space-separated and not part of hex colors or CSS.
    // Tag names may contain ':' (reserved tags: #line:, #shadow:).
    const re = /\s#([a-zA-Z_][a-zA-Z0-9_:]*)(?![\w:])/g;
    let text = input;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input))) {
      tags.push(m[1]);
    }
    if (tags.length > 0) {
      // Only remove tags that match the pattern (not hex colors in CSS)
      text = input.replace(/\s#([a-zA-Z_][a-zA-Z0-9_:]*)(?![\w:])/g, "").trimEnd();
      return { cleanText: text, tags };
    }
    return { cleanText: input };
  }

  /**
   * Removed fork extensions (ticket 40 — the three intentional breaking
   * syntax removals). Each surfaces as a YS0005 SyntaxError through the
   * compile seam with a migration pointer in the message; see
   * docs/migration-notes.md.
   */
  private rejectRemovedSyntax(text: string, token: Token): void {
    const cssMatch = text.match(/&css\{/);
    if (cssMatch) {
      throw new ParseError(
        "&css{} has been removed; styling is consumer-side via markup properties (see docs/migration-notes.md)",
        this.rangeAt(token),
      );
    }
    if (/\{if\s|\{else\}|\{else\s|\{elseif|\{endif\}/.test(text)) {
      throw new ParseError(
        "Inline {if}...{endif} blocks have been removed; use line-level <<if expr>> conditions instead (see docs/migration-notes.md)",
        this.rangeAt(token),
      );
    }
    const bracketIf = text.match(/\[\s*if\s+[^\]]*\]\s*$/i);
    if (bracketIf) {
      throw new ParseError(
        `Option condition syntax ${bracketIf[0].trim()} has been removed; write <<if expr>> on the option line instead (see docs/migration-notes.md)`,
        this.rangeAt(token),
      );
    }
  }

  private parseStatementsUntilStop(shouldStop: () => boolean): Statement[] {
    const out: Statement[] = [];
    while (!this.at("EOF")) {
      // Check stop condition at root level only
      if (shouldStop()) break;
      while (this.at("EMPTY")) this.i++;
      if (this.at("EOF") || shouldStop()) break;
      if (this.at("OPTION")) {
        out.push(this.parseOptionGroup());
        continue;
      }
      if (this.at("LINE_GROUP")) {
        out.push(this.parseLineGroup());
        continue;
      }
      // Full-line // comments are not dialogue content (upstream lexer skips them)
      if (this.at("TEXT") && this.peek().text.trimStart().startsWith("//")) {
        this.i++;
        continue;
      }
      // Indentation tokens are transparent here (see skipIndentTransparency):
      // if/once bodies may be written at any indent level relative to their
      // delimiting commands, so INDENT/DEDENT must not terminate the body.
      if (this.skipIndentTransparency()) continue;
      out.push(this.parseStatement());
    }
    return out;
  }

  /**
   * A `<<once>>` / `<<once if expr>>` block: the body runs once (the
   * once-state is a generated variable — coding standards §4); `<<else>>`
   * starts the else body, and `<<endonce>>` closes the block.
   */
  private parseOnceBlock(cmd: string): OnceBlock {
    let condition: string | undefined;
    const rest = cmd.slice(4).trim();
    if (rest.length > 0) {
      if (rest === "if" || !rest.startsWith("if ")) {
        throw new ParseError(
          `Unexpected content after <<once>>: "${rest}" — expected <<once>>, <<once if expr>>, <<else>>, or <<endonce>>`,
          this.rangeAt(this.peek()),
        );
      }
      condition = rest.slice(3).trim();
      if (!condition) {
        throw new ParseError("<<once if>> requires an expression (Yarn Spinner 3.x syntax)", this.rangeAt(this.peek()));
      }
    }
    // Body until <<else>> or <<endonce>> at the same level (indentation is
    // transparent here, as in if-blocks).
    const atOnceClose = () =>
      this.at("COMMAND") && (this.peek().text === "else" || this.peek().text === "endonce");
    const body = this.parseStatementsUntilStop(atOnceClose);
    let elseBody: Statement[] | undefined;
    if (this.at("COMMAND") && this.peek().text === "else") {
      this.take("COMMAND");
      elseBody = this.parseStatementsUntilStop(
        () => this.at("COMMAND") && this.peek().text === "endonce",
      );
    }
    if (this.at("COMMAND") && this.peek().text === "endonce") {
      this.take("COMMAND");
    }
    const block: OnceBlock = { type: "Once", body };
    if (condition !== undefined) block.condition = condition;
    if (elseBody) block.elseBody = elseBody;
    return block;
  }

  private parseEnumBlock(enumName: string): EnumBlock {
    const cases: EnumCaseDef[] = [];
    
    // Parse cases until <<endenum>>
    while (!this.at("EOF")) {
      while (this.at("EMPTY")) this.i++;
      // Indentation around <<case>> lines (see skipIndentTransparency)
      // must not stall the loop.
      if (this.skipIndentTransparency()) continue;
      if (this.at("COMMAND")) {
        const cmd = this.peek().text.trim();
        if (cmd === "endenum") {
          this.take("COMMAND");
          break;
        }
        if (cmd.startsWith("case ")) {
          this.take("COMMAND");
          // `<<case Name>>` or `<<case Name = <constant raw value>>` (upstream
          // 3.x enum grammar; the raw value's constant-ness is validated by
          // the enum type builder).
          const caseText = cmd.slice(5).trim();
          const caseMatch = caseText.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*([\s\S]+))?$/);
          if (!caseMatch) {
            throw new ParseError(`Invalid enum case: <<${cmd}>>`, this.rangeAt(this.peek()));
          }
          const [, caseName, rawValue] = caseMatch;
          cases.push(rawValue !== undefined ? { name: caseName, rawValue } : { name: caseName });
        } else {
          // Unknown command, might be inside enum block - skip or break?
          break;
        }
      } else {
        // Skip non-command lines
        if (this.at("TEXT")) this.take("TEXT");
      }
    }
    
    return { type: "Enum", name: enumName, cases };
  }

  private parseIfCommandBlock(firstCmd: string): IfBlock {
    const branches: IfBlock["branches"] = [];
    const firstCond = firstCmd.slice(3).trim();
    // Body until next elseif/else/endif command (check at root level, not inside indented blocks)
    const firstBody = this.parseStatementsUntilStop(() => {
      // Only stop at root level commands, not inside indented blocks
      return this.at("COMMAND") && /^(elseif\s|else$|endif$)/.test(this.peek().text);
    });
    branches.push({ condition: firstCond, body: firstBody });

    while (!this.at("EOF")) {
      if (!this.at("COMMAND")) break;
      const t = this.peek();
      const txt = t.text.trim();
      if (txt.startsWith("elseif ")) {
        this.take("COMMAND");
        const cond = txt.slice(7).trim();
        const body = this.parseStatementsUntilStop(() => this.at("COMMAND") && /^(elseif\s|else$|endif$)/.test(this.peek().text));
        branches.push({ condition: cond, body });
        continue;
      }
      if (txt === "else") {
        this.take("COMMAND");
        const body = this.parseStatementsUntilStop(() => this.at("COMMAND") && /^(endif$)/.test(this.peek().text));
        branches.push({ condition: null, body });
        // require endif after else body
        if (this.at("COMMAND") && this.peek().text.trim() === "endif") {
          this.take("COMMAND");
        }
        break;
      }
      if (txt === "endif") {
        this.take("COMMAND");
        break;
      }
      break;
    }

    return { type: "If", branches };
  }

}


