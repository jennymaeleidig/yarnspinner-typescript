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
    childBuilder.append(input.replace(VALUE_PLACEHOLDER_REGEX, String(numericValue)));
    return diagnostics;
  }

  const input = markupValueToString(replacementValue);
  childBuilder.append(input.replace(VALUE_PLACEHOLDER_REGEX, String(numericValue)));
  return [];
}
