// SPDX-License-Identifier: CC0-1.0
/**
 * The built-in functions every dialogue carries (upstream `StandardLibrary`
 * role). Registered into the runtime's Library at construction; host
 * libraries are imported over them, so a host may override any entry.
 *
 * Shared by the one execution driver (the instruction-stream VM):
 * visit-count queries read
 * through the VM's variable storage — the generated-variable key
 * contract (coding standards §4) is what makes `visited()`/`visited_count()`
 * work uniformly.
 */

import type { Library } from "./library.js";
import type { FunctionSignature } from "./library.js";
import { visitCountVariableKey } from "./generatedVariables.js";
import type { VariableStorage } from "./variableStorage.js";
import {
  convertToInt32,
  stringifyOperand,
  toNumberOperand,
} from "./operands.js";

/**
 * Render a number the way upstream's `format_invariant` does
 * (`float.ToString(CultureInfo.InvariantCulture)`): the value is a 32-bit
 * float, rendered as its shortest round-tripping decimal — plain notation
 * from 1e-4 up through 1e8, upstream's exponent form ("E±XX", signed, two
 * exponent digits) outside that window — with upstream's non-finite
 * spellings ("NaN", "Infinity", "-Infinity").
 */
function formatFloat32Invariant(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const f = Math.fround(value);
  // The shortest decimal that round-trips through float32 (C# float's
  // shortest-round-trip formatting): widen the precision until it does.
  let mantissa = "";
  let exponent = 0;
  for (let precision = 1; precision <= 9; precision++) {
    if (Math.fround(Number(f.toPrecision(precision))) === f) {
      const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(
        f.toExponential(precision - 1),
      )!;
      mantissa = match[2] + (match[3] ?? "").replace(/0+$/, "");
      exponent = Number(match[4]);
      if (match[1] === "-") return `-${renderCSharpFloat(mantissa, exponent)}`;
      return renderCSharpFloat(mantissa, exponent);
    }
  }
  return String(f); // unreachable: float32 round-trips within 9 digits
}

/**
 * Render shortest-round-trip digits (`mantissa`, a digit string; `exponent`,
 * the power of ten of its leading digit) in C# float notation: plain from
 * 1e-4 through 1e8, `E±XX` outside.
 */
function renderCSharpFloat(mantissa: string, exponent: number): string {
  if (exponent >= -4 && exponent <= 8) {
    if (exponent < 0) {
      return `0.${"0".repeat(-exponent - 1)}${mantissa}`;
    }
    if (mantissa.length <= exponent + 1) {
      return mantissa + "0".repeat(exponent + 1 - mantissa.length);
    }
    return `${mantissa.slice(0, exponent + 1)}.${mantissa.slice(exponent + 1)}`;
  }
  const rest = mantissa.slice(1);
  return `${mantissa[0]}${rest ? `.${rest}` : ""}E${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/** Register the built-in functions into `library`. */
export function registerBuiltinFunctions(
  library: Library,
  /** Live read access to the variable storage (generated keys included). */
  getVariables: () => VariableStorage,
): void {
  const builtins: Record<string, (...args: unknown[]) => unknown> = {
    // Default conversion helpers — upstream `Convert.ToString` /
    // `Convert.ToSingle` / `Convert.ToBoolean` (CurrentCulture): booleans
    // render "True"/"False"; unconvertible input throws (upstream
    // FormatException) instead of coercing silently.
    string: (v: unknown) => stringifyOperand(v),
    number: (v: unknown) => {
      if (typeof v === "boolean") return v ? 1 : 0;
      if (v == null) return 0;
      const text = String(v).trim();
      if (
        text === "" ||
        !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)
      ) {
        throw new Error(`Cannot convert "${text}" to number`);
      }
      return Number(text);
    },
    bool: (v: unknown) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (v == null) return false;
      // Upstream's string overload is bool.Parse: exactly true/false,
      // case-insensitive, whitespace-trimmed — the numeric string "0" does
      // NOT parse (the string and number overloads differ upstream too).
      const text = String(v).trim();
      if (/^true$/i.test(text)) return true;
      if (/^false$/i.test(text)) return false;
      throw new Error(`Cannot convert "${text}" to bool`);
    },
    visited: (nodeName: unknown) => {
      const name = String(nodeName ?? "");
      return (Number(getVariables().get(visitCountVariableKey(name))) || 0) > 0;
    },
    visited_count: (nodeName: unknown) => {
      const name = String(nodeName ?? "");
      return Number(getVariables().get(visitCountVariableKey(name))) || 0;
    },
    format_invariant: (n: unknown) =>
      formatFloat32Invariant(toNumberOperand(n)),
    random: () => Math.random(),
    // Upstream: random_range returns an integer offset above the (untruncated)
    // min: Random.Next((int)max - (int)min + 1) + min. random_range_float is
    // the same formula under its own name. Random.Next throws for a negative
    // span — reversed bounds are an error, never a clamp.
    random_range: (a: unknown, b: unknown) => randomIntegerSpan(a, b),
    random_range_float: (a: unknown, b: unknown) => randomIntegerSpan(a, b),
    dice: (sides: unknown) => {
      // Upstream: Random.Next(sides) + 1 with an int parameter (ConvertTo<int>,
      // midpoint-to-even). Next throws for a negative argument — dice(-5) is
      // an error; Next(0) yields 0, so dice(0) is 1.
      const s = convertToInt32(toNumberOperand(sides));
      if (s < 0) {
        throw new Error(`dice: sides (${s}) must not be negative`);
      }
      return Math.floor(Math.random() * s) + 1;
    },
    // Upstream arity: exactly two parameters (float a, float b).
    min: (a: unknown, b: unknown) =>
      Math.min(toNumberOperand(a), toNumberOperand(b)),
    max: (a: unknown, b: unknown) =>
      Math.max(toNumberOperand(a), toNumberOperand(b)),
    // Upstream: (int)Math.Round(num) / (float)Math.Round(num, places) — C#
    // Math.Round rounds midpoints to even.
    round: (n: unknown) => convertToInt32(bankersRound(toNumberOperand(n))),
    round_places: (n: unknown, places: unknown) => {
      const p = convertToInt32(toNumberOperand(places));
      if (p < 0 || p > 15) {
        throw new Error(`round_places: places (${p}) must be between 0 and 15`);
      }
      const factor = Math.pow(10, p);
      return bankersRound(toNumberOperand(n) * factor) / factor;
    },
    floor: (n: unknown) => Math.floor(Number(n)),
    ceil: (n: unknown) => Math.ceil(Number(n)),
    inc: (n: unknown) => {
      const v = Number(n);
      return Number.isInteger(v) ? v + 1 : Math.ceil(v);
    },
    dec: (n: unknown) => {
      const v = Number(n);
      return Number.isInteger(v) ? v - 1 : Math.floor(v);
    },
    decimal: (n: unknown) => {
      // Upstream Decimal(value): value - trunc(value) — the sign survives.
      const v = toNumberOperand(n);
      return v - Math.trunc(v);
    },
    int: (n: unknown) => Math.trunc(Number(n)),
    // Upstream std-lib `format`: positional `{0}`-style placeholders with
    // exactly one argument (upstream `string.Format(culture, fmt, arg)`).
    format: (fmt: unknown, arg: unknown) =>
      String(fmt ?? "").replace(/\{(\d+)\}/g, (match, i: string) => {
        if (Number(i) !== 0) return match; // upstream: only {0} exists
        return arg === undefined ? match : stringifyOperand(arg);
      }),
  };
  for (const [name, fn] of Object.entries(builtins)) {
    library.registerFunction(name, fn, builtinSignatures[name]);
  }
}

/**
 * C# `Math.Round`'s midpoint-to-even over JS doubles (the shared kernel of
 * `round`/`round_places` — upstream rounds the binary value, so e.g. 2.675
 * — not exactly representable — rounds down at 2 digits).
 */
function bankersRound(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction === 0.5) {
    // Exactly halfway: take the even neighbor. (Halfway negatives: -2.5
    // rounds to -2.)
    const lowerIsEven = floor % 2 === 0;
    return lowerIsEven ? floor : floor + 1;
  }
  return Math.round(value);
}

/**
 * Upstream `random_range`/`random_range_float`:
 * `Random.Next((int)max - (int)min + 1) + min` — an integer span over the
 * untruncated min. A negative span (max below min) throws, matching
 * upstream's `Random.Next` ArgumentOutOfRangeException.
 */
function randomIntegerSpan(a: unknown, b: unknown): number {
  const min = toNumberOperand(a);
  const max = toNumberOperand(b);
  // The `(int)` here is a C# cast — truncation, not ConvertTo<int>'s
  // midpoint-to-even conversion.
  const span = Math.trunc(max) - Math.trunc(min) + 1;
  if (span < 0) {
    throw new Error(
      `random_range: min (${min}) must be less than or equal to max (${max})`,
    );
  }
  return Math.floor(Math.random() * span) + min;
}

/**
 * Compile-time signatures for the built-ins: upstream's compiler
 * knows its default Library's function types, so `{visited(true)}` is a
 * YS0050 type error at compile time, not a runtime surprise. The compile
 * seam merges these under the host's Library/declarations.
 */
export const builtinSignatures: Record<string, FunctionSignature> = {
  visited: { params: ["string"], returns: "bool" },
  visited_count: { params: ["string"], returns: "number" },
  format_invariant: { params: ["number"], returns: "string" },
  random: { params: [], returns: "number" },
  random_range: { params: ["number", "number"], returns: "number" },
  random_range_float: { params: ["number", "number"], returns: "number" },
  dice: { params: ["number"], returns: "number" },
  min: { params: ["number", "number"], returns: "number" },
  max: { params: ["number", "number"], returns: "number" },
  round: { params: ["number"], returns: "number" },
  round_places: { params: ["number", "number"], returns: "number" },
  floor: { params: ["number"], returns: "number" },
  ceil: { params: ["number"], returns: "number" },
  inc: { params: ["number"], returns: "number" },
  dec: { params: ["number"], returns: "number" },
  decimal: { params: ["number"], returns: "number" },
  int: { params: ["number"], returns: "number" },
  format: { params: ["string", "any"], returns: "string" },
};
