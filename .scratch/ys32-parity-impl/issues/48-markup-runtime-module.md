# 48: Markup runtime module + replacement markers

**What to build:** text rendered to the consumer goes through the upstream markup split — the runtime line-parser module expands `{expr}` substitutions, then parses markup into a structured result (attributes with positions, delete-range, text-for-attribute); replacement markers `[select]`/`[plural]`/`[ordinal]` via `Intl.PluralRules` with overridable locale and invisible-character counts; parser completeness (close-all `[/]`, property shorthand, self-closing trim + `trimwhitespace=false`, attribute types); implicit `[character name=]` marker replaces the regex speaker slice; minimal custom-processor registry; styling tags stay opaque.

Fixture corpus has no markup coverage — verified by ported upstream inline tests against the module directly (seam 2).

**Blocked by:** 43 (tests hit the new API's Line payloads).

**Status:** resolved

- [x] Ported upstream markup tests green
- [x] Replacement markers produce upstream-identical classes and counts
- [x] Speaker resolution via implicit marker
- [x] Full suite green

## Comments

### 2025 — implementation complete (340/340 green)

**New runtime markup module** (ported from upstream `YarnSpinner.Markup` at tag v3.2.2):

- `src/markup/types.ts` — upstream-shaped `MarkupValue` struct (`type` + all four value fields, mirroring `MarkupValueType`), `MarkupAttribute` (`position`/`sourcePosition`/`length`/`name`/`properties`), `MarkupDiagnostic` (`message`/`column`), `MarkupParseResult` (`{ text, attributes }`), helpers (`tryGetAttributeWithName`, `tryGetProperty` case-insensitive, `textForAttribute`, `deleteRange`), and the `AttributeMarkerProcessor`/`ReplacementMarkerResult` seam.
- `src/markup/lineParser.ts` — full port of upstream `LineParser.cs`: index-cursor lexer (tokens incl. `interpolatedValue` and boolean literals, token End inclusive), `TokenStream` with `comparePattern`/`lookAhead`, tree builder with nomarkup scanning, `cleanUpUnmatchedCloses` (adoption-agency rebalance with LIFO orphan reparenting), squish (`static squishSplitAttributes`), implicit `[character name="..."]` marker via upstream regex `/^((?:[^:\\]|\\.)*):\s*/` (skipped when the line already starts with `[character`), `[/]` close-all, property shorthand, self-closing trim + `trimwhitespace`, `\[`/`\]`/`\:` unescaping, `parseStringWithDiagnostics` with column positions.
- `src/markup/builtInReplacer.ts` — `BuiltInMarkupReplacer` for `[select]`/`[plural]`/`[ordinal]` with `Intl.PluralRules` (cardinal/ordinal) over an overridable locale, `languageSubtag` narrowing via `Intl.getCanonicalLocales`, upstream `%`-placeholder semantics and the non-string-replacement diagnostic quirk.

**Runtime split (upstream architecture):**

- The compiler stores RAW line text: `src/parse/parser.ts` no longer parses markup, strips speakers, or unescapes runtime-owned escapes at compile time. Main-grammar escapes (`\#`, `\<`, `\>`, `\/`, `\\`) still unescape at compile time (upstream `TextEscapedMode`); `\{`, `\}`, `\[`, `\]`, `\:` keep their backslashes for the line parser.
- `src/runtime/interpolate.ts` became a `LineComposer`: expands `{expr}` substitutions first (errors compose as empty string), then parses through `LineParser`. `composeLine` derives `speaker` from the implicit `character` attribute's `name` property and slices the prefix off the delivered line text (event contract from ticket 43 kept: `speaker` separate, `text` message-only, attributes offset to message coordinates). `composeOption` delivers the FULL composed text with the prefix intact (upstream `GetComposedTextForLine` treats options identically — a colon in option text is not a speaker separator, verified against `InlineExpressions`/`Smileys`/`Escaping` testplans). `interpolate` expands substitutions alone for commands (upstream VM: commands never pass through the markup parser — `<<hide Collision:GermOnPorch>>` keeps its colon).
- `src/runtime/vm.ts` lazily builds the composer; registers built-in replacers plus host processors (`Dialogue.registerMarkerProcessor`/`deregisterMarkerProcessor`); `Dialogue.getLocale`/`setLocale` (default `"en"`) and `getLineParser` exposed through the facade and options.
- Compile-time markup and the fork-era segment model (`MarkupSegment`/`MarkupWrapper`/old `parseMarkup`) are fully retired; `src/model/ast.ts` dropped `Line.speaker`/`Line.markup`/`Option.markup`.
- `src/react/MarkupRenderer.tsx` rewritten over the attribute model: nested/overlapping attribute runs, zero-length self-closing markers as empty elements, `data-markup-*` properties; styling tags stay opaque data.

**Tests:** `src/tests/markupLineParser.test.ts` — 66 tests ported from upstream `MarkupTests.cs` (lexer token tables, tree shapes, rewriters, squish/invisible-character counts, replacement markers incl. locale variants and ordinals, implicit character cases, diagnostics with column positions, multibyte, property parsing, trimwhitespace). All ported tests hit the module directly (spec-sanctioned seam 2). Upstream conformance: all 32 testplan pairs green; `FormatFunctions.yarn` allowlist entry REMOVED (replacement markers closed the gap). Full suite: 340/340.

### Code review (two-axis) findings resolved

- **Spec (fixed)**: `PluralReplace` non-string replacement — upstream adds the diagnostic but STILL appends the text (LineParser.cs has no `return` in that branch); the port had early-returned, dropping the text. Now faithful. Also removed a lowercase fallback property lookup absent upstream (`TryGetProperty(pluralCaseName)` only).
- **Standards (fixed)**: the 3× duplicated substitution lambda in `LineComposer` extracted to a private `substitute()`; `textForAttribute`'s `RangeError` now carries a comment recording it as upstream-parity API-misuse behavior (not a content-path throw).
- **Standards (accepted)**: `lexMarkup`/`buildMarkupTreeFromTokens`/`walkAndProcessTree` widened from upstream `internal` for the spec-sanctioned seam-2 tests — deliberate, recorded here.
