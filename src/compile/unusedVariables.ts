// SPDX-License-Identifier: CC0-1.0
/**
 * YS0010 UnusedVariable — the compile-end unused-declared-variable
 * analysis (upstream's pass in `Compiler.Compile`: declarations that never
 * appear in `NodeMetadataVisitor.VariableReferences` report
 * `DiagnosticDescriptor.UnusedVariable`, severity info — Definitions/
 * YS0010-UnusedVariable.md: "Variable '{0}' is declared but never used").
 *
 * The exact upstream rule (Compiler.cs, 3.2.2): a declaration is unused
 * when it is a variable (`IsVariable` — functions are excluded by shape),
 * its name is not a compiler-generated `$Yarn.Internal` variable, and the
 * variable is referenced NOWHERE in the content. "Referenced" is upstream
 * `NodeMetadataVisitor`'s VariableReferences set: every variable used as a
 * value anywhere (conditions, assignment right sides, declare initializers,
 * interpolation, function arguments, `when:` headers) PLUS every `<<set>>`
 * target — `VisitSet_statement` records the assignment target as a
 * reference, so a declared-but-only-written variable is USED, not unused
 * (pinned by upstream TestUsedVariablesShouldntGenerateDiagnostic's
 * `<<set $somevar = true>>` case). The declaration's own name in its
 * `<<declare>>` is not a reference (upstream records set targets only, and
 * the declared variable is not a `value_var`) — which is exactly why the
 * TestUnusedDeclaredVarsGenerateDiagnostic cases report.
 *
 * This is an analysis pass over the type-checked declaration set, not a
 * grammar-level check, so it runs in the compile seam after type checking
 * (alongside the other compile-end passes) and reads the artifacts those
 * passes already produce: the declaration list (post-salvage, external
 * declarations included) and the parsed documents.
 *
 * Exclusions (the ticket's spec, where upstream's loop is silent):
 * - external (host-declared) variables — the host's variable store is not
 *   the script's problem;
 * - smart variables (`isSmartVariable`, upstream IsInlineExpansion) — their
 *   value recomputes from the variables their initializer references, and
 *   they are read-only hosts of an expression, not storage;
 * - `$Yarn.Internal`-prefixed generated variables (upstream's explicit
 *   filter).
 */

import type { YarnDocument, Statement } from "../model/ast.js";
import { walkStatements } from "../model/walk.js";
import { inlineExpressionSpans } from "../runtime/interpolate.js";
import { parseSaliencyCondition } from "../runtime/saliency.js";
import { parseStateStatement } from "../parse/stateStatement.js";
import { IDENTIFIER } from "../parse/identifier.js";
import type { VariableDeclaration } from "./typeCheck.js";
import { makeDiagnostic } from "./diagnostics.js";
import type { Diagnostic } from "./diagnostics.js";

/**
 * The compiler's generated-variable prefix (upstream's `$Yarn.Internal.*`
 * filter on the unused set). Declaration names are stored bare (no `$`),
 * so the prefix compares without it.
 */
const GENERATED_PREFIX = "Yarn.Internal.";

/** A `$`-prefixed variable reference inside an expression (an upstream
 * `VAR_ID` token; the shared unicode identifier classes, so localized
 * names like `$生命` count as references too). */
const VAR_REF = new RegExp(`\\$(${IDENTIFIER})`, "gu");

/**
 * Collect a string's variable references into `into`, skipping quoted
 * string literals (a `$var` inside `'...'`/`"..."` is text, not a
 * reference — the expression grammar lexes STRING as a literal value).
 */
function scanVars(text: string, into: Set<string>): void {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "$") {
      VAR_REF.lastIndex = i;
      const match = VAR_REF.exec(text);
      if (match) {
        into.add(match[1]);
        i = match.index + match[0].length - 1;
      }
    }
  }
}

/** Scan the inline `{expr}` spans of line/option/command text (the spans
 * are exactly where upstream's grammar puts expressions in formatted
 * text; bare `$var` outside braces is COMMAND_TEXT, not a reference). */
function scanFormattedText(text: string, into: Set<string>): void {
  for (const span of inlineExpressionSpans(text)) scanVars(span.source, into);
}

/** A command statement's references (upstream VisitSet_statement and the
 * command_formatted_text walk): a `<<set>>` target IS a reference (so a
 * set-only variable counts as used), a `<<declare>>`'s own target is NOT
 * (its initializer's variables are), `<<call>>` arguments are expressions,
 * and every other command contributes its inline `{expr}` spans. */
function scanCommand(content: string, into: Set<string>): void {
  const state = parseStateStatement(content);
  if (state) {
    if (state.kind === "set") into.add(state.name);
    scanVars(state.expression, into);
    return;
  }
  const call = content.match(/^call\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/);
  if (call) {
    scanVars(call[2], into);
    return;
  }
  scanFormattedText(content, into);
}

/** Collect every variable reference in the document's content — upstream
 * `NodeMetadataVisitor`'s VariableReferences, the read set YS0010 checks
 * declarations against. */
export function collectVariableReferences(doc: YarnDocument): Set<string> {
  const refs = new Set<string>();

  // `when:` headers carry expressions (upstream `header_when_expression`
  // is a grammar rule containing `expression`, so its value_vars are
  // visited like any other).
  for (const node of doc.nodes) {
    for (const raw of node.when ?? []) {
      const parsed = parseSaliencyCondition(raw);
      if (parsed.kind === "expression" || parsed.kind === "once-if") {
        scanVars(parsed.expression, refs);
      }
    }
    walkStatements(node.body, {
      onLine: (line) => {
        scanFormattedText(line.text, refs);
        if (line.condition) scanVars(line.condition, refs);
        if (line.once?.condition) scanVars(line.once.condition, refs);
      },
      onOption: (option) => {
        scanFormattedText(option.text, refs);
        if (option.condition) scanVars(option.condition, refs);
        if (option.once?.condition) scanVars(option.once.condition, refs);
      },
      onStatement: (s: Statement) => {
        if (s.type === "Command") {
          scanCommand(s.content, refs);
        } else if (s.type === "Jump" || s.type === "Detour") {
          // A braced jump/detour target is an expression (upstream
          // jumpToExpression/detourToExpression); a bare node name is not.
          const targetExpr = s.target.match(/^\{([\s\S]*)\}$/);
          if (targetExpr) scanVars(targetExpr[1], refs);
        } else if (s.type === "If") {
          // Container conditions are the containers' own data (the walker
          // recurses their bodies but doesn't hand over their expressions).
          for (const branch of s.branches) {
            if (branch.condition !== null) scanVars(branch.condition, refs);
          }
        } else if (s.type === "Once") {
          if (s.condition) scanVars(s.condition, refs);
        }
      },
    });
  }
  return refs;
}

/**
 * The compile-end YS0010 pass: one info diagnostic per declaration that is
 * a variable, not compiler-generated, not external, not a smart variable,
 * and referenced nowhere in the content.
 */
export function addUnusedVariableDiagnostics(
  declarations: VariableDeclaration[],
  referenced: Set<string>,
  externalVariables: ReadonlySet<string>,
  push: (d: Diagnostic) => void,
): void {
  for (const decl of declarations) {
    if (referenced.has(decl.name)) continue;
    if (externalVariables.has(decl.name)) continue;
    if (decl.isSmartVariable) continue;
    if (decl.name.startsWith(GENERATED_PREFIX)) continue;
    // Message from the submodule's Definitions registry template
    // (YS0010-UnusedVariable.md); declaration names surface with their `$`.
    push(makeDiagnostic("YS0010", `Variable '$${decl.name}' is declared but never used`));
  }
}