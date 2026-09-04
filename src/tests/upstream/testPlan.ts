/**
 * Parser for the upstream Yarn Spinner conformance `.testplan` DSL.
 *
 * Implements the CURRENT grammar (`YarnSpinnerTestPlan.g4`, in the upstream
 * submodule at
 * `test/fixtures/upstream/YarnSpinner/YarnSpinner.Tests/TestPlan/YarnSpinnerTestPlan.g4`),
 * as used by the
 * .NET suite at v3.2.2. Deliberately NOT a port of the Rust reader, which
 * parses the obsolete pre-backtick format (research ticket 01).
 *
 * Grammar (informative):
 *   testplan  : run ('---' run)*
 *   step      : 'line:' TEXT hashtag*
 *             | 'line:' '*' hashtag*
 *             | 'option:' TEXT hashtag* ('[disabled]')?
 *             | 'command:' TEXT
 *             | 'stop'
 *             | 'select:' NUMBER            // 1-indexed; 0 => no option selected
 *             | 'set:' $var = BOOL | NUMBER
 *             | 'saliency:' first|best|best_least_recently_seen
 *             | 'node:' IDENTIFIER
 *   TEXT      : '`' .*? '`'                 // no escapes; text cannot contain backticks
 *
 * Note on hashtags: upstream's ANTLR lexer has a quirk — its COMMENT token
 * ('#' ~[\r\n]*) swallows trailing `#tag`s after backticked text via maximal
 * munch, so its hashtag() parse contexts never fire in practice. The grammar
 * clearly intends trailing hashtags (ShadowLines.testplan relies on them), so
 * this parser implements the grammar's intent: `#tag` tokens after TEXT on a
 * step line are hashtags; a '#' starting a line is a comment.
 */

export type TestPlanStep =
  | { kind: "line"; text: string | null; hashtags: string[] }
  | { kind: "option"; text: string | null; hashtags: string[]; disabled: boolean }
  | { kind: "command"; text: string }
  | { kind: "stop" }
  | { kind: "select"; optionIndex: number }
  | { kind: "set"; variable: string; value: boolean | number }
  | { kind: "saliency"; mode: string }
  | { kind: "node"; nodeName: string };

export interface TestPlanRun {
  /** Node each run starts from. The current grammar always uses "Start". */
  startNode: string;
  steps: TestPlanStep[];
}

export interface TestPlan {
  runs: TestPlanRun[];
}

export class TestPlanSyntaxError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`testplan line ${line}: ${message}`);
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VARIABLE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const BOOL = /^(true|false)$/;
// Grammar-exact (YarnSpinnerTestPlan.g4: `NUMBER: [0-9]+`). Plans only carry
// non-negative integers (select: indices, set: values).
const NUMBER = /^[0-9]+$/;
const HASHTAG = /^#[^\s]+$/;

/** Parse the text inside backticks; returns null if not backtick-quoted. */
function parseBackticked(rest: string, lineNumber: number): { text: string; remainder: string } | null {
  const trimmed = rest.trimStart();
  if (!trimmed.startsWith("`")) return null;
  const close = trimmed.indexOf("`", 1);
  if (close === -1) {
    throw new TestPlanSyntaxError("unterminated backticked text (TEXT cannot contain backticks)", lineNumber);
  }
  return { text: trimmed.slice(1, close), remainder: trimmed.slice(close + 1) };
}

/** Parse trailing `#tag` and `[disabled]` tokens after a step's text. */
function parseTrailingTokens(
  remainder: string,
  lineNumber: number,
  allowDisabled: boolean,
): { hashtags: string[]; disabled: boolean } {
  const hashtags: string[] = [];
  let disabled = false;
  const tokens = remainder.trim().length ? remainder.trim().split(/\s+/) : [];
  for (const token of tokens) {
    if (HASHTAG.test(token)) {
      hashtags.push(token);
    } else if (allowDisabled && token === "[disabled]") {
      disabled = true;
    } else {
      throw new TestPlanSyntaxError(`unexpected trailing token "${token}"`, lineNumber);
    }
  }
  return { hashtags, disabled };
}

export function parseTestPlan(source: string): TestPlan {
  const runs: TestPlanRun[] = [];
  let current: TestPlanRun = { startNode: "Start", steps: [] };
  let sawStep = false;

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNumber = i + 1;

    if (line === "" || line.startsWith("#")) continue; // blank or comment
    if (line === "---") {
      if (!sawStep) {
        throw new TestPlanSyntaxError("run contains no steps", lineNumber);
      }
      runs.push(current);
      current = { startNode: "Start", steps: [] };
      sawStep = false;
      continue;
    }

    sawStep = true;
    const colon = line.indexOf(":");
    const keyword = colon === -1 ? line : line.slice(0, colon).trim();
    const rest = colon === -1 ? "" : line.slice(colon + 1);

    switch (keyword) {
      case "line": {
        if (rest.trimStart().startsWith("*")) {
          const { hashtags } = parseTrailingTokens(rest.trimStart().slice(1), lineNumber, false);
          current.steps.push({ kind: "line", text: null, hashtags });
          break;
        }
        const parsed = parseBackticked(rest, lineNumber);
        if (!parsed) {
          throw new TestPlanSyntaxError("expected backticked text or '*' after 'line:'", lineNumber);
        }
        const { hashtags } = parseTrailingTokens(parsed.remainder, lineNumber, false);
        current.steps.push({ kind: "line", text: parsed.text, hashtags });
        break;
      }
      case "option": {
        const parsed = parseBackticked(rest, lineNumber);
        if (!parsed) {
          throw new TestPlanSyntaxError("expected backticked text after 'option:'", lineNumber);
        }
        const { hashtags, disabled } = parseTrailingTokens(parsed.remainder, lineNumber, true);
        current.steps.push({ kind: "option", text: parsed.text, hashtags, disabled });
        break;
      }
      case "command": {
        const parsed = parseBackticked(rest, lineNumber);
        if (!parsed || parseTrailingTokens(parsed.remainder, lineNumber, false).hashtags.length) {
          throw new TestPlanSyntaxError("expected exactly backticked text after 'command:'", lineNumber);
        }
        current.steps.push({ kind: "command", text: parsed.text });
        break;
      }
      case "stop": {
        if (rest.trim() !== "") {
          throw new TestPlanSyntaxError("'stop' takes no arguments", lineNumber);
        }
        current.steps.push({ kind: "stop" });
        break;
      }
      case "select": {
        const value = rest.trim();
        if (!NUMBER.test(value)) {
          throw new TestPlanSyntaxError(`'select:' expects a number, got "${value}"`, lineNumber);
        }
        // Upstream converts the 1-indexed plan value to 0-based; 0 => -1 (no option selected).
        current.steps.push({ kind: "select", optionIndex: parseInt(value, 10) - 1 });
        break;
      }
      case "set": {
        const match = rest.trim().match(/^(\$\S+)\s*=\s*(\S+)$/);
        if (!match) {
          throw new TestPlanSyntaxError(`'set:' expects "$var = value", got "${rest.trim()}"`, lineNumber);
        }
        const varMatch = match[1].match(VARIABLE);
        if (!varMatch) {
          throw new TestPlanSyntaxError(`'set:' variable must be $identifier, got "${match[1]}"`, lineNumber);
        }
        const rawValue = match[2];
        if (BOOL.test(rawValue)) {
          current.steps.push({ kind: "set", variable: varMatch[1], value: rawValue === "true" });
        } else if (NUMBER.test(rawValue)) {
          current.steps.push({ kind: "set", variable: varMatch[1], value: parseInt(rawValue, 10) });
        } else {
          throw new TestPlanSyntaxError(`'set:' value must be a bool or integer, got "${rawValue}"`, lineNumber);
        }
        break;
      }
      case "saliency": {
        const mode = rest.trim();
        if (!IDENTIFIER.test(mode)) {
          throw new TestPlanSyntaxError(`'saliency:' expects an identifier, got "${mode}"`, lineNumber);
        }
        current.steps.push({ kind: "saliency", mode });
        break;
      }
      case "node": {
        const name = rest.trim();
        if (!IDENTIFIER.test(name)) {
          throw new TestPlanSyntaxError(`'node:' expects an identifier, got "${name}"`, lineNumber);
        }
        current.steps.push({ kind: "node", nodeName: name });
        break;
      }
      default:
        throw new TestPlanSyntaxError(`unknown step "${line}"`, lineNumber);
    }
  }

  if (sawStep) {
    runs.push(current);
  }
  if (runs.length === 0) {
    throw new TestPlanSyntaxError("test plan contains no runs", 1);
  }
  return { runs };
}
