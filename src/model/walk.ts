// SPDX-License-Identifier: CC0-1.0
/**
 * The statement-tree walker — the AST's shape gets exactly one home. Every
 * compile-seam pass previously re-walked the statement tree by hand
 * (`case "OptionGroup"` appeared nine times across five files), each
 * re-deriving the traversal's subtleties: document order, the option's own
 * line registering before its body, the `<<once>>`-exclusion variant
 * (upstream's `LastLineBeforeOptionsVisitor` has no once case), and
 * line-bearing vs all-statement filtering. One walker owns all of it;
 * each pass becomes a visitor of a few lines.
 *
 * Order (document order, depth-first):
 * - `onLine` — every line-bearing statement: `Line` statements and
 *   line-group items;
 * - `onOption` — a shortcut option, just before its body recurses (the
 *   option's own text is line-bearing: upstream registers/checks it, then
 *   walks the body);
 * - `onStatement` — every non-line statement (Command, Jump, Detour,
 *   EnumBlock, and the containers If/Once/OptionGroup before their
 *   children) — for passes that collect targets, commands, or a
 *   container's own data.
 *
 * The walker does not host every walk in the codebase, deliberately: the
 * compiler's lowering recursion (labels, branch wiring, the option stack)
 * and the type checker's statement walk (branch-condition rewrites
 * interleaved with body walks — `checkExpression` mutates checker state,
 * so the interleaving is load-bearing) are their own contracts, not
 * traversals; folding them in would need an interface as wide as their
 * implementations.
 */

import type { Line, LineGroup, Option, Statement } from "./ast.js";

/** Where a callback's node sits: its enclosing list and position in it.
 * One union type — narrowing on `type` decides Line vs Option without a
 * cast at the consumer. */
export interface WalkContext {
  list: readonly (Statement | Option)[];
  index: number;
}

/** Non-line statements: everything `onLine`/`onOption` don't cover. */
export type NonLineStatement = Exclude<Statement, Line | LineGroup>;

export interface StatementWalker {
  /** Line-bearing statements: `Line` statements and line-group items. */
  onLine?(line: Line, at: WalkContext): void;
  /** A shortcut option, just before its body recurses. */
  onOption?(option: Option, at: WalkContext): void;
  /** Every non-line statement, containers included, before their children. */
  onStatement?(stmt: NonLineStatement, at: WalkContext): void;
}

export interface WalkOptions {
  /**
   * Visit `<<once>>` block bodies (default `true`). `false` skips the
   * whole `<<once>>` block — the upstream `LastLineBeforeOptionsVisitor`
   * shape (its visitor has no once case), used by the string table's
   * last-line flagging.
   */
  includeOnce?: boolean;
}

/** Walk a statement list depth-first in document order. */
export function walkStatements(
  stmts: Statement[],
  walker: StatementWalker,
  options?: WalkOptions,
): void {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    switch (s.type) {
      case "Line":
        walker.onLine?.(s, { list: stmts, index: i });
        break;
      case "LineGroup":
        for (let j = 0; j < s.items.length; j++) {
          walker.onLine?.(s.items[j], { list: s.items, index: j });
        }
        break;
      case "OptionGroup":
        walker.onStatement?.(s, { list: stmts, index: i });
        for (let k = 0; k < s.options.length; k++) {
          walker.onOption?.(s.options[k], { list: s.options, index: k });
          walkStatements(s.options[k].body, walker, options);
        }
        break;
      case "If":
        walker.onStatement?.(s, { list: stmts, index: i });
        for (const b of s.branches) walkStatements(b.body, walker, options);
        break;
      case "Once":
        if (options?.includeOnce !== false) {
          walker.onStatement?.(s, { list: stmts, index: i });
          walkStatements(s.body, walker, options);
          if (s.elseBody) walkStatements(s.elseBody, walker, options);
        }
        break;
      case "Command":
      case "Jump":
      case "Detour":
      case "Enum":
        walker.onStatement?.(s, { list: stmts, index: i });
        break;
    }
  }
}
