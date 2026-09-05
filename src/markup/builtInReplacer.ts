/**
 * The built-in replacement marker processor (upstream
 * `Yarn.Markup.BuiltInMarkupReplacer`): implements the `[select]`,
 * `[plural]`, and `[ordinal]` replacement markers.
 *
 * `[select value=...] key="text with %"` picks the property matching the
 * stringified value; `[plural value=N one=... other=...]` and
 * `[ordinal value=N one=... two=... few=... many=... other=...]` pick the
 * property named after the number's plural case. In every case a `%`
 * placeholder in the chosen text is replaced by the value, and the chosen
 * property must be a string.
 *
 * The plural classes come from `Intl.PluralRules` (upstream uses its
 * vendored CLDR tables): `select`/`plural` use cardinal rules, `ordinal`
 * uses ordinal rules. The locale is resolved to its language subtag
 * (upstream resolves specific locales to their neutral parent) and hosts
 * may override it per call.
 *
 * Ported from upstream 3.2.2 (MIT © Secret Lab Pty. Ltd. and Yarn Spinner
 * contributors).
 */

// Citation: adapted from YarnSpinner v3.2.2 LineParser.cs (BuiltInMarkupReplacer),
// https://github.com/YarnSpinnerTool/YarnSpinner (MIT). The upstream license
// survives this adaptation.
// Modified by Jenny Mae LEIDIG on 2026-09-04 — the plural/ordinal `%`
// placeholder now renders with the current culture, matching upstream's
// `numericValue.ToString(CultureInfo.CurrentCulture)` (LineParser.cs
// PluralReplace); select stays invariant as upstream.

import type {
  AttributeMarkerProcessor,
  MarkupAttribute,
  MarkupDiagnostic,
  ReplacementMarkerResult,
  StringBuilder,
} from "./types.js";
import { markupValueToString, tryGetProperty } from "./types.js";

/** The `%` placeholder in replacement-marker text (upstream `ValuePlaceholderRegex`). */
const VALUE_PLACEHOLDER_REGEX = /(?<!\\)%/g;

export interface PluralRulesResolver {
  (localeCode: string, value: number, category: "cardinal" | "ordinal"): string;
}

/**
 * The default plural-class resolver: `Intl.PluralRules` resolved to its
 * language subtag (CLDR 'neutral' locales, like upstream's parent-culture
 * collapse), falling back to `other` when the runtime has no rules for the
 * locale.
 */
export const defaultPluralRulesResolver: PluralRulesResolver = (localeCode, value, category) => {
  const languageCode = languageSubtag(localeCode);
  try {
    return new Intl.PluralRules(languageCode, { type: category }).select(value);
  } catch {
    // A locale the runtime doesn't know: fall back to the default locale's
    // rules rather than failing the composition.
    return new Intl.PluralRules("en", { type: category }).select(value);
  }
};

/**
 * Resolves a BCP-47 tag to its 'neutral' (language-only) form, the way
 * upstream narrows a specific culture to its parent: `"en-AU"` → `"en"`.
 * An unparseable tag is returned unchanged (upstream's
 * `CultureNotFoundException` fallback).
 */
export function languageSubtag(localeCode: string): string {
  try {
    const canonical = Intl.getCanonicalLocales(localeCode)[0];
    if (canonical === undefined) return localeCode;
    const language = canonical.split("-")[0];
    return language === "" ? localeCode : language;
  } catch {
    return localeCode;
  }
}

/**
 * The host environment's current culture (BCP-47, or `undefined` for the
 * JS runtime default) — the port's analogue of .NET's process-wide
 * `CultureInfo.CurrentCulture` that upstream reads when rendering the
 * `%` placeholder in plural/ordinal replacement text. Environment
 * configuration, not story state: upstream's CurrentCulture is likewise
 * process-global mutable state (`CultureInfo.CurrentCulture = ...`).
 */
let currentCulture: string | undefined = undefined;

/** The current culture `%` substitution renders under. */
export function getCurrentCulture(): string | undefined {
  return currentCulture;
}

/** Overrides the current culture `%` substitution renders under (upstream `CultureInfo.CurrentCulture`). */
export function setCurrentCulture(culture: string | undefined): void {
  currentCulture = culture;
}

/**
 * Renders a number the way upstream `PluralReplace` renders the `%`
 * placeholder: `numericValue.ToString(System.Globalization.CultureInfo
 * .CurrentCulture)` — the host environment's current culture, not the
 * line's locale code and not the invariant culture. In JS the current
 * culture is the runtime default locale, so this formats with no explicit
 * locale unless a host pinned one through `setCurrentCulture`. No
 * grouping (C# `double.ToString` never groups) and full precision, to
 * match the rest of the port's numeric rendering.
 */
export function formatNumberInCurrentCulture(numericValue: number): string {
  if (!Number.isFinite(numericValue)) return String(numericValue);
  return numericValue.toLocaleString(getCurrentCulture(), {
    useGrouping: false,
    maximumFractionDigits: 20,
  });
}

/**
 * A marker processor that handles the built-in markers `[select]`,
 * `[plural]`, and `[ordinal]` (upstream `BuiltInMarkupReplacer`).
 */
export class BuiltInMarkupReplacer implements AttributeMarkerProcessor {
  private readonly resolvePluralRules: PluralRulesResolver;

  constructor(resolvePluralRules: PluralRulesResolver = defaultPluralRulesResolver) {
    this.resolvePluralRules = resolvePluralRules;
  }

  processReplacementMarker(
    marker: MarkupAttribute,
    childBuilder: StringBuilder,
    _childAttributes: MarkupAttribute[],
    localeCode: string,
  ): ReplacementMarkerResult {
    // These are all self-closing tags: there is no sensible way to perform
    // a replacement for anything else.
    if (childBuilder.length > 0 || _childAttributes.length > 0) {
      return {
        diagnostics: [
          { message: `'${marker.name}' markup only works on self-closing tags.`, column: marker.position },
        ],
        invisibleCharacters: 0,
      };
    }

    const valueProp = tryGetProperty(marker, "value");
    if (valueProp === undefined) {
      return {
        diagnostics: [
          {
            message: `no 'value' property was found on the marker, ${marker.name} requires this to exist.`,
            column: marker.position,
          },
        ],
        invisibleCharacters: 0,
      };
    }

    switch (marker.name) {
      case "select":
        return { diagnostics: selectReplace(marker, childBuilder, markupValueToString(valueProp)), invisibleCharacters: 0 };

      case "plural":
      case "ordinal": {
        if (valueProp.type !== "integer" && valueProp.type !== "float") {
          return {
            diagnostics: [
              {
                message: `Asked to pluralise '${markupValueToString(valueProp)}' but this is a type that does not support pluralisation.`,
                column: marker.position,
              },
            ],
            invisibleCharacters: 0,
          };
        }
        const numericValue = valueProp.type === "integer" ? valueProp.integerValue : valueProp.floatValue;
        return {
          diagnostics: pluralReplace(marker, localeCode, childBuilder, numericValue, this.resolvePluralRules),
          invisibleCharacters: 0,
        };
      }

      default:
        return {
          diagnostics: [
            {
              message: `Asked to perform replacement for ${marker.name}, a marker we don't handle.`,
              column: marker.position,
            },
          ],
          invisibleCharacters: 0,
        };
    }
  }
}

/**
 * `[select value=V k1="..." ...]`: the property named by the stringified
 * value supplies the replacement text, with `%` replaced by the value.
 */
function selectReplace(
  marker: MarkupAttribute,
  childBuilder: StringBuilder,
  value: string,
): MarkupDiagnostic[] {
  const replacementProp = tryGetProperty(marker, value);
  if (replacementProp === undefined) {
    return [{ message: `no replacement value for ${value} was found`, column: marker.position }];
  }

  let replacement = markupValueToString(replacementProp);
  replacement = replacement.replace(VALUE_PLACEHOLDER_REGEX, value);
  childBuilder.append(replacement);

  return [];
}

/**
 * `[plural ...]` / `[ordinal ...]`: the number's plural case (cardinal for
 * `plural`, ordinal for `ordinal`) names the property that supplies the
 * replacement text, with `%` replaced by the number.
 */
function pluralReplace(
  marker: MarkupAttribute,
  localeCode: string,
  childBuilder: StringBuilder,
  numericValue: number,
  resolvePluralRules: PluralRulesResolver,
): MarkupDiagnostic[] {
  const category = marker.name === "ordinal" ? "ordinal" : "cardinal";
  let pluralCaseName: string;
  try {
    pluralCaseName = resolvePluralRules(localeCode, numericValue, category);
  } catch (error) {
    return [
      {
        message: `Unexpected pluralisation marker name ${marker.name}${
          error instanceof Error ? ` (${error.message})` : ""
        }`,
        column: marker.position,
      },
    ];
  }

  const replacementValue = tryGetProperty(marker, pluralCaseName.toUpperCase());
  if (replacementValue === undefined) {
    return [
      {
        message: `no replacement for ${numericValue}'s plural case of ${pluralCaseName.toUpperCase()} was found.`,
        column: marker.position,
      },
    ];
  }

  if (replacementValue.type !== "string") {
    // Upstream quirks: the diagnostic is added but the text is STILL
    // appended — only a missing plural case early-outs (LineParser.cs
    // PluralReplace, the non-string branch has no return).
    const diagnostics: MarkupDiagnostic[] = [
      {
        message: `select replacement values are expected to be strings, not ${replacementValue.type}`,
        column: marker.position,
      },
    ];
    const input = markupValueToString(replacementValue);
    childBuilder.append(input.replace(VALUE_PLACEHOLDER_REGEX, formatNumberInCurrentCulture(numericValue)));
    return diagnostics;
  }

  const input = markupValueToString(replacementValue);
  childBuilder.append(input.replace(VALUE_PLACEHOLDER_REGEX, formatNumberInCurrentCulture(numericValue)));
  return [];
}
