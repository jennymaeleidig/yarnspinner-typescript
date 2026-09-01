# Markup scope

Type: grilling
Status: resolved
Blocked by: —

## Question

The fork's markup parser produces opaque segments — rendering is consumer-side (correct posture), but upstream core semantics are missing (audit + census §2): replacement markers `[select]`/`[plural]`/`[ordinal]` (locale-aware, CLDR plural classes), implicit `[character name=]` marker generated first (3.2.0), close-all `[/]`, property shorthand `[wave=2]`, self-closing whitespace-trim, markup diagnostics feeding compilation (3.2.1), custom `IAttributeMarkerProcessor`-equivalent. Decide: which of these are core-parser responsibilities vs runtime-line-parsing responsibilities in the TS design (upstream splits `LineParser` out of `Dialogue`); whether replacement markers land in the first spec; where the extension point for custom processors sits; and confirm styling tags (`[wave]`, `[pause]`, …) stay opaque data for the consumer.

## Answer

All recommendations confirmed by the maintainer:

1. **Adopt the upstream split**: compiler stores raw line text; a runtime `LineParser` module expands `{expr}` substitutions then parses markup to a `MarkupParseResult` (attributes with positions, `DeleteRange`, `TextForAttribute`). Composed-text fixture assertions require this; it is also the text-provider seam (ticket 05).
2. **Replacement markers in the first spec**: `[select]`, `[plural]`, `[ordinal]` backed by `Intl.PluralRules` (default locale overridable), with invisible-char counts (`ReplacementMarkerResult`).
3. **Parser correctness features included**: close-all `[/]`, property shorthand, self-closing whitespace-trim + `trimwhitespace=false`, attribute types (int/float/bool/string).
4. **Implicit `[character name=]` marker adopted** (generated first, 3.2.0) — replaces the fork's regex speaker slice.
5. **Markup diagnostics fold into compilation** (3.2.1 / YS0063) via the diagnostics contract (ticket 10).
6. **Minimal custom-processor registry** (name → processor) alongside built-in markers.
7. **Styling tags stay opaque data** — consumer-side rendering confirmed; demo renders as today.
