// SPDX-License-Identifier: CC0-1.0
/**
 * Saliency: the content-selection machinery for node groups and
 * line groups, mirroring upstream 3.2.2 `Yarn.Saliency` (coding standards §5).
 *
 * - `ContentSaliencyOption` mirrors upstream `ContentSaliencyOption`: one
 *   piece of selectable content with its complexity score, pass/fail
 *   condition counts, and content type.
 * - `ContentSaliencyStrategy` mirrors upstream `IContentSaliencyStrategy`:
 *   the pluggable two-method interface — `queryBestContent` (read-only
 *   choice) and `contentWasSelected` (state update on commitment).
 * - The four built-in strategies mirror upstream's classes one-for-one;
 *   the runtime default is Random Best-Least-Recently-Viewed (upstream
 *   `VirtualMachine`'s default), with view counts kept as generated
 *   variables in variable storage (coding standards §4) through the
 *   `SaliencyState` seam.
 * - Complexity scoring mirrors upstream `NodeGroupCompiler` /
 *   `When_headerContext.ComplexityScore`: a `when: always` header scores 0,
 *   a `when: once` marker adds 1, and an expression adds its binary boolean
 *   operator count (`and`/`or`/`xor`) plus 1.
 */

/** The kind of content a saliency option represents (upstream `ContentSaliencyContentType`). */
export type ContentSaliencyContentType = "node" | "line";

/** One piece of selectable content, as presented to a saliency strategy (upstream `ContentSaliencyOption`). */
export interface ContentSaliencyOption {
  /** Identifies the content: a node-group member's unique name, or a line group item's line ID. */
  contentId: string;
  /** The complexity score (see module doc): strategies prefer more complex content. */
  complexityScore: number;
  /** How many of the content's conditions passed. */
  passingConditionValueCount: number;
  /** How many of the content's conditions failed — any failure makes the content non-salient. */
  failingConditionValueCount: number;
  contentType: ContentSaliencyContentType;
  /**
   * The destination instruction the VM jumps to when this content is
   * selected. Internal to the VM (upstream keeps the same field internal);
   * strategies must treat it as opaque.
   */
  destination?: number;
}

/**
 * Read/write access to the saliency history — how many times each piece of
 * content has been seen. The runtime's implementation stores the counts as
 * generated variables in variable storage (coding standards §4), so they
 * reset with it.
 */
export interface SaliencyState {
  getViewCount(contentId: string): number;
  recordView(contentId: string): void;
}

/**
 * The pluggable two-method strategy interface (upstream
 * `IContentSaliencyStrategy`): choose the most salient content, and record
 * a selection. `queryBestContent` must be a read-only operation; any state
 * update belongs in `contentWasSelected`.
 */
export interface ContentSaliencyStrategy {
  queryBestContent(content: readonly ContentSaliencyOption[]): ContentSaliencyOption | null;
  contentWasSelected(content: ContentSaliencyOption): void;
}

/**
 * Upstream `FirstSaliencyStrategy`: the first non-failing item. Used when a
 * dialogue must choose but has no tracked saliency state.
 */
export class FirstSaliencyStrategy implements ContentSaliencyStrategy {
  queryBestContent(content: readonly ContentSaliencyOption[]): ContentSaliencyOption | null {
    return content.find((c) => c.failingConditionValueCount === 0) ?? null;
  }
  contentWasSelected(): void {}
}

/**
 * Upstream `BestSaliencyStrategy`: the highest-complexity non-failing item,
 * first of ties (upstream's stable `OrderByDescending`), regardless of how
 * often it has been seen.
 */
export class BestSaliencyStrategy implements ContentSaliencyStrategy {
  queryBestContent(content: readonly ContentSaliencyOption[]): ContentSaliencyOption | null {
    let best: ContentSaliencyOption | null = null;
    for (const c of content) {
      if (c.failingConditionValueCount !== 0) continue;
      if (best === null || c.complexityScore > best.complexityScore) best = c;
    }
    return best;
  }
  contentWasSelected(): void {}
}

/** Shared selection core for the two BLRV strategies: least-seen tier first,
 * then highest complexity, each comparison stable (first of ties — upstream's
 * `OrderBy(viewCount).ThenByDescending(complexity).First()`). */
function bestLeastRecentlyViewed(
  content: readonly ContentSaliencyOption[],
  state: SaliencyState,
): ContentSaliencyOption | null {
  let best: ContentSaliencyOption | null = null;
  let bestViews = 0;
  for (const c of content) {
    if (c.failingConditionValueCount !== 0) continue;
    if (best === null) {
      best = c;
      bestViews = state.getViewCount(c.contentId);
      continue;
    }
    const views = state.getViewCount(c.contentId);
    if (views < bestViews || (views === bestViews && c.complexityScore > best.complexityScore)) {
      best = c;
      bestViews = views;
    }
  }
  return best;
}

/**
 * Upstream `BestLeastRecentlyViewedSaliencyStrategy`: the first of the
 * best, least-recently-seen choices. Stores view counts in the provided
 * `SaliencyState` (upstream: the variable storage).
 */
export class BestLeastRecentlyViewedSaliencyStrategy implements ContentSaliencyStrategy {
  constructor(private readonly state: SaliencyState) {}
  queryBestContent(content: readonly ContentSaliencyOption[]): ContentSaliencyOption | null {
    return bestLeastRecentlyViewed(content, this.state);
  }
  contentWasSelected(content: ContentSaliencyOption): void {
    this.state.recordView(content.contentId);
  }
}

/**
 * Upstream `RandomBestLeastRecentlyViewedSaliencyStrategy` — the runtime's
 * default: among the least-seen, most-complex choices, pick randomly.
 */
export class RandomBestLeastRecentlyViewedSaliencyStrategy implements ContentSaliencyStrategy {
  constructor(private readonly state: SaliencyState) {}
  queryBestContent(content: readonly ContentSaliencyOption[]): ContentSaliencyOption | null {
    const passing = content.filter((c) => c.failingConditionValueCount === 0);
    if (passing.length === 0) return null;
    // Group by view count (least first), then by complexity (highest first),
    // and pick a random element of the final group (upstream's grouping).
    let group = passing;
    let key = (c: ContentSaliencyOption) => this.state.getViewCount(c.contentId);
    group = extremalGroup(group, key, "min");
    key = (c) => c.complexityScore;
    group = extremalGroup(group, key, "max");
    return group[Math.floor(Math.random() * group.length)];
  }
  contentWasSelected(content: ContentSaliencyOption): void {
    this.state.recordView(content.contentId);
  }
}

/** The items sharing the extreme value of `key` (first of equals — stable). */
function extremalGroup<T>(
  items: readonly T[],
  key: (item: T) => number,
  which: "min" | "max",
): T[] {
  let extreme = 0;
  let group: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (group.length === 0 || (which === "min" ? value < extreme : value > extreme)) {
      extreme = value;
      group = [item];
    } else if (value === extreme) {
      group.push(item);
    }
  }
  return group;
}

/** The saliency strategy mode names: upstream `<<set_saliency>>` commands
 *  (Try Yarn Spinner: `first`, `random`, `best`, `best_least_recent`,
 *  `random_best_least_recent`) plus the conformance harness's plan-step
 *  vocabulary (`*_seen` spellings, upstream TestBase's saliencyStrategies
 *  map). */
export const SALIENCY_MODES = [
  "first",
  "random",
  "best",
  "best_least_recent",
  "random_best_least_recent",
  "best_least_recently_seen",
  "random_best_least_recently_seen",
] as const;

/** The runtime's default strategy mode (upstream `VirtualMachine`'s default). */
export const DEFAULT_SALIENCY_MODE = "random_best_least_recent";

/**
 * Resolve a strategy mode name to a built-in strategy instance (shared by
 * the `<<set_saliency>>` command, the conformance harness's `saliency:`
 * steps, and hosts). Returns `null` for an unknown mode.
 */
export function saliencyStrategyForMode(
  mode: string,
  state: SaliencyState,
): ContentSaliencyStrategy | null {
  switch (mode) {
    case "first":
      return new FirstSaliencyStrategy();
    case "best":
      return new BestSaliencyStrategy();
    case "best_least_recent":
    case "best_least_recently_seen":
      return new BestLeastRecentlyViewedSaliencyStrategy(state);
    case "random":
    case "random_best_least_recent":
    case "random_best_least_recently_seen":
      return new RandomBestLeastRecentlyViewedSaliencyStrategy(state);
    default:
      return null;
  }
}

/** The runtime's default strategy (upstream `VirtualMachine`'s constructor). */
export function defaultSaliencyStrategy(state: SaliencyState): ContentSaliencyStrategy {
  return saliencyStrategyForMode(DEFAULT_SALIENCY_MODE, state)!;
}

// ── Complexity scoring ──────────────────────────────────────────────────

/**
 * Count the binary boolean operators in an expression — upstream
 * `GetBooleanOperatorCountInExpression` (Compiler.cs:1618) walks the parse
 * tree for `ExpAndOrXorContext` nodes (`and`/`&&`, `or`/`||`, `xor`/`^`),
 * one node per operator. This count is taken over a token scan rather than
 * a raw string match, so a quoted string contributes nothing and a variable
 * named `$or` is a variable, not an operator. For well-formed expressions
 * the operator-token count equals upstream's parse-tree count (each binary
 * boolean operator occurrence is one context node).
 */
export function booleanOperatorCount(expression: string): number {
  let count = 0;
  let i = 0;
  while (i < expression.length) {
    const c = expression[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      // A quoted string is one literal token; it cannot contribute.
      i++;
      while (i < expression.length && expression[i] !== c) {
        i += expression[i] === "\\" ? 2 : 1;
      }
      i++;
      continue;
    }
    if (c === "$" || /[A-Za-z_]/.test(c)) {
      // A variable ($name) or identifier: consumed whole, so a variable
      // named `$or` never reads as the operator.
      const start = c === "$" ? i + 1 : i;
      let end = start;
      while (end < expression.length && /[A-Za-z0-9_]/.test(expression[end])) end++;
      if (c !== "$") {
        const word = expression.slice(start, end);
        if (word === "and" || word === "or" || word === "xor") count++;
      }
      i = end;
      continue;
    }
    const two = expression.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      count++;
      i += 2;
      continue;
    }
    if (c === "^") {
      count++;
      i++;
      continue;
    }
    i++;
  }
  return count;
}

/** One parsed `when:` header condition (or a line-group item's modifier). */
export type ParsedSaliencyCondition =
  | { kind: "always" }
  | { kind: "once" }
  | { kind: "once-if"; expression: string }
  | { kind: "expression"; expression: string };

/**
 * Parse a `when:` header's raw text (or a line-group item's `<<once>>`/
 * `<<once if>>`/`<<if>>` modifier, which shares the shape): `always`, a
 * `once` marker, `once if <expr>`, or a plain expression.
 */
export function parseSaliencyCondition(raw: string): ParsedSaliencyCondition {
  const text = raw.trim();
  const onceIf = text.match(/^once\s+if\s+(.+)$/);
  if (onceIf) return { kind: "once-if", expression: onceIf[1].trim() };
  if (text === "once") return { kind: "once" };
  if (text === "always") return { kind: "always" };
  return { kind: "expression", expression: text };
}

/**
 * A `when:` header's complexity score (upstream
 * `When_headerContext.ComplexityScore`): `always` scores 0, a `once` marker
 * adds 1, and an expression adds its boolean-operator count plus 1. A
 * condition is the sum over its parts.
 */
export function saliencyConditionComplexity(raw: string): number {
  const parsed = parseSaliencyCondition(raw);
  switch (parsed.kind) {
    case "always":
      return 0;
    case "once":
      return 1;
    case "once-if":
      return 1 + booleanOperatorCount(parsed.expression) + 1;
    case "expression":
      return booleanOperatorCount(parsed.expression) + 1;
  }
}

/**
 * A node-group member's unique name (upstream `Utility.GetNodeUniqueName`):
 * `Title.Subtitle` when the member carries a `subtitle:` header, otherwise
 * `Title.<index>` — this project's deterministic scheme standing in for
 * upstream's `Title.<crc32 of file+title+line>` checksum, whose inputs
 * (source file name, line number) the instruction-stream program does not
 * carry. It qualifies the member's saliency content ID and once-state key.
 */
export function nodeGroupMemberId(
  groupTitle: string,
  member: { subtitle?: string },
  index: number,
): string {
  return member.subtitle ? `${groupTitle}.${member.subtitle}` : `${groupTitle}.${index}`;
}
