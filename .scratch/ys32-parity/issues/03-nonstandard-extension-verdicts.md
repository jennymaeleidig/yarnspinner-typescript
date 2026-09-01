# Nonstandard extension verdicts

Type: grilling
Status: resolved
Blocked by: —

## Question

The fork carries syntax that does not exist upstream. Per the divergence policy ("conform to upstream, decide per-conflict"), rule on each: **keep as documented extension, deprecate, or drop**.

- Option conditions `[if expr]` suffix (upstream: `<<if expr>>` on the option line) — see [repo audit](../research/repo-audit.md), Options.
- Inline `{if ...}{else}{endif}` text blocks inside line text (upstream has only `{expr}` interpolation).
- `&css{...}` in headers/lines/options.
- `scene:` header + the YAML scene/actor system.
- Ternary `? :` in expressions (README documents it; evaluator doesn't support it; upstream has none — likely just fix the docs).
- Emitting a `CommandResult` for *every* command including `<<set>>`/`<<declare>>` (upstream delivers only non-state commands to the CommandHandler).

For each: what breaks for existing content if dropped, and what the spec should say. Record verdicts as glossary-worthy terms where they introduce new canonical language.

## Answer

Verdicts decided with the maintainer (2026 session; breaking changes allowed, conform-to-upstream default):

1. **Option conditions `[if expr]` → DROP outright** (maintainer chose the strict option over the deprecated-alias middle path). Upstream `<<if $x >>` on the option line is the only supported syntax. Spec must include a migration note and, per the diagnostics decision, ideally an error diagnostic for `[if` on option lines.
2. **Inline `{if ...}{else}{endif}` text blocks → DROP.** Collides with upstream `{…}` expression semantics (content upstream would reject). Migration: line-level `<<if>>`/`<<once>>` conditions.
3. **`&css{...}` → REMOVE from core.** Styling is engine-side upstream; consumer-side rendering reads markup properties. Demo styling hooks move to markup attributes.
4. **`scene:` header → upstream-compatible passthrough, no action.** Upstream allows arbitrary `key: value` headers, so the header itself needs nothing; the scene/actor system stays with the React layer, out of the parity spec (confirmed out of scope).
5. **Ternary `? :` → fix the README only.** No evaluator change; upstream has none.
6. **`CommandResult` for every command → CONFORM.** State commands (`<<set>>`/`<<declare>>`) become internal; the CommandHandler-equivalent receives only non-state commands; variables API is the observation point. Breaking change accepted.

Net spec implications: two syntaxes deleted (`[if]`, `{if}` blocks), one extension removed from core (`&css{}`), one behavior conformed (command visibility), one docs fix. No new canonical terms required beyond upstream's own vocabulary.
