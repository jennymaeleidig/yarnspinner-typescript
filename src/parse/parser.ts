import { lex, Token } from "./lexer.js";
import { parseMarkup, sliceMarkup } from "../markup/parser.js";
import type { MarkupParseResult } from "../markup/types.js";
import type {
  YarnDocument,
  YarnNode,
  Statement,
  Line,
  Command,
  OptionGroup,
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
    return { type: "Document", enums, nodes };
  }

  private parseNode(): YarnNode {
    const headers: Record<string, string> = {};
    let title: string | null = null;
    let titleHeaderCount = 0;
    let nodeTags: string[] | undefined;
    let whenConditions: string[] = [];

    // headers
    while (!this.at("NODE_START")) {
      const keyTok = this.take("HEADER_KEY", "Expected node header before '---'");
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
      if (cmd === "once") return this.parseOnceBlock();
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
      const raw = this.take("TEXT").text.replace(/\s\/\/.*$/, "").trimEnd();
      const { cleanText: textWithoutTags, tags } = this.extractTags(raw);
      // Removed fork extensions (ticket 40): &css{} and inline {if} blocks.
      this.rejectRemovedSyntax(textWithoutTags, t);
      const markup = parseMarkup(textWithoutTags);
      const speakerMatch = markup.text.match(/^([^:\s][^:]*)\s*:\s*(.*)$/);
      if (speakerMatch) {
        const messageText = speakerMatch[2];
        const messageOffset = markup.text.length - messageText.length;
        const slicedMarkup = sliceMarkup(markup, messageOffset);
        const normalizedMarkup = this.normalizeMarkup(slicedMarkup);
        return {
          type: "Line",
          speaker: speakerMatch[1].trim(),
          text: messageText,
          tags,
          markup: normalizedMarkup,
        } as Line;
      }
      return {
        type: "Line",
        text: markup.text,
        tags,
        markup: this.normalizeMarkup(markup),
      } as Line;
    }
    throw new ParseError(`Unexpected token ${t.type}`, this.rangeAt(t));
  }

  private parseOptionGroup(): OptionGroup {
    const options: Option[] = [];
    // One or more OPTION lines, with bodies under INDENT
    while (this.at("OPTION")) {
      const optTok = this.take("OPTION");
      const raw = optTok.text.replace(/\s\/\/.*$/, "").trimEnd();
      const { cleanText: textWithAttrs, tags } = this.extractTags(raw);
      // Removed fork extensions (ticket 40): &css{} and the [if expr] option
      // condition suffix.
      this.rejectRemovedSyntax(textWithAttrs, optTok);
      const { text: optionText, condition } = this.extractOptionIfCondition(textWithAttrs, optTok);
      const markup = parseMarkup(optionText);
      let body: Statement[] = [];
      if (this.at("INDENT")) {
        this.take("INDENT");
        body = this.parseStatementsUntil("DEDENT");
        this.take("DEDENT");
        while (this.at("EMPTY")) this.i++;
      }
      options.push({
        type: "Option",
        text: markup.text,
        body,
        tags,
        markup: this.normalizeMarkup(markup),
        condition,
      });
      // Consecutive options belong to the same group; a blank line between
      // options separates groups (upstream: options must be consecutive lines).
      let blanks = 0;
      while (this.at("EMPTY")) { this.i++; blanks++; }
      if (blanks > 0 || this.trailingBlankBeforeEnd) break;
    }
    return { type: "OptionGroup", options };
  }

  private normalizeMarkup(result: MarkupParseResult): MarkupParseResult | undefined {
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

  /**
   * Upstream option conditions: an <<if expr>> suffix on the option line.
   * The expression is stripped from the option text and returned; an
   * expression-less <<if>> is the upstream ParseFailures case
   * (OptionConditions-MustHaveExpressions) and throws YS0005 via the seam.
   */
  private extractOptionIfCondition(input: string, token: Token): { text: string; condition?: string } {
    if (/<<\s*if\s*>>/.test(input)) {
      throw new ParseError(
        "Option condition <<if>> requires an expression (Yarn Spinner 3.x syntax)",
        this.rangeAt(token),
      );
    }
    let condition: string | undefined;
    const text = input.replace(/<<\s*if\s+([\s\S]+?)>>/g, (_m, expr) => {
      if (condition !== undefined && condition !== expr.trim()) {
        throw new ParseError(
          "An option can have only one <<if>> condition (Yarn Spinner 3.x syntax)",
          this.rangeAt(token),
        );
      }
      condition ??= expr.trim();
      return "";
    });
    return { text: text.trim(), condition };
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

  private parseOnceBlock(): OnceBlock {
    // Already consumed <<once>>; expect body under INDENT then <<endonce>> as COMMAND
    let body: Statement[] = [];
    if (this.at("INDENT")) {
      this.take("INDENT");
      body = this.parseStatementsUntil("DEDENT");
      this.take("DEDENT");
    } else {
      // Alternatively, body until explicit <<endonce>> command on single line
      body = [];
    }
    // consume closing command if present on own line
    if (this.at("COMMAND") && this.peek().text === "endonce") {
      this.take("COMMAND");
    }
    return { type: "Once", body };
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


