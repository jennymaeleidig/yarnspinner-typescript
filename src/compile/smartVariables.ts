/**
 * Smart variable classification (spec ticket 42).
 *
 * Upstream Yarn Spinner 3.2 classifies a `<<declare>>` by the shape of its
 * initial value expression (TypeCheckerListener.ResolveInitialValues): a
 * plain literal (number, string, `true`/`false`), a single unary minus over
 * a number literal (issue #421 — negative literals are not smart), or an
 * enum member reference (`Enum.Case` / `.Case` shorthand — a constant type
 * property) yields a *stored* variable with a default value. Any other
 * expression shape — variables, operators, function calls, or a
 * parenthesized literal like `(1)` (the YS0030 registry example) — yields a
 * *smart variable* (upstream "inline expansion",
 * `Declaration.IsInlineExpansion`): read-only, recomputed on every access.
 */

/** A parsed `<<declare $name = expression>>` command's parts. */
export interface DeclareCommand {
  name: string;
  expression: string;
}

/** Extract the variable name and initial value expression from a `<<declare>>` command's content. */
export function parseDeclareCommand(content: string): DeclareCommand | null {
  const match = /^declare\s+\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(content.trim());
  if (!match) return null;
  const asMatch = match[2].match(/\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  const expression = (asMatch ? match[2].slice(0, asMatch.index) : match[2]).trim();
  return { name: match[1], expression };
}

interface ShapeToken {
  kind: "num" | "str" | "ident" | "op" | "dot";
  text: string;
}

/** Quote-aware token scan of an initializer expression (shape only, no parsing). */
function shapeTokens(expr: string): ShapeToken[] {
  const tokens: ShapeToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== c) {
        if (expr[j] === "\\") j++; // skip escaped characters
        j++;
      }
      tokens.push({ kind: "str", text: expr.slice(i, Math.min(j + 1, expr.length)) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(?:\.[0-9]+)?/.exec(expr.slice(i))!;
      tokens.push({ kind: "num", text: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i))!;
      tokens.push({ kind: "ident", text: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === ".") {
      tokens.push({ kind: "dot", text: c });
      i++;
      continue;
    }
    tokens.push({ kind: "op", text: c });
    i++;
  }
  return tokens;
}

/**
 * True when the `<<declare>>` initializer expression makes the variable a
 * smart variable (upstream `Declaration.IsInlineExpansion`): any shape other
 * than the stored literal forms — a number with at most one leading unary
 * minus, a string literal, `true`/`false`, or an enum member reference.
 */
export function isSmartVariableInitializer(expr: string): boolean {
  const tokens = shapeTokens(expr);
  // Stored shapes: exactly one of the following token sequences.
  if (tokens.length === 1 && (tokens[0].kind === "num" || tokens[0].kind === "str")) return false;
  if (tokens.length === 1 && tokens[0].kind === "ident" && (tokens[0].text === "true" || tokens[0].text === "false")) {
    return false;
  }
  // Unary minus over a number literal (upstream issue #421).
  if (tokens.length === 2 && tokens[0].kind === "op" && tokens[0].text === "-" && tokens[1].kind === "num") {
    return false;
  }
  // Enum member reference: Enum.Case or the .Case shorthand.
  if (tokens.length === 2 && tokens[0].kind === "dot" && tokens[1].kind === "ident") return false;
  if (
    tokens.length === 3 &&
    tokens[0].kind === "ident" &&
    tokens[1].kind === "dot" &&
    tokens[2].kind === "ident"
  ) {
    return false;
  }
  return true;
}
