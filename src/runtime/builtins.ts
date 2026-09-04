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
import { stringifyOperand } from "./evaluator.js";

/** Register the built-in functions into `library`. */
export function registerBuiltinFunctions(
  library: Library,
  /** Live read access to the variable storage (generated keys included). */
  getVariables: () => VariableStorage,
): void {
  const builtins: Record<string, (...args: unknown[]) => unknown> = {
    // Default conversion helpers
    string: (v: unknown) => String(v ?? ""),
    number: (v: unknown) => Number(v),
    bool: (v: unknown) => Boolean(v),
    visited: (nodeName: unknown) => {
      const name = String(nodeName ?? "");
      return (Number(getVariables().get(visitCountVariableKey(name))) || 0) > 0;
    },
    visited_count: (nodeName: unknown) => {
      const name = String(nodeName ?? "");
      return Number(getVariables().get(visitCountVariableKey(name))) || 0;
    },
    format_invariant: (n: unknown) => {
      const num = Number(n);
      if (!isFinite(num)) return "0";
      return new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 20 }).format(num);
    },
    random: () => Math.random(),
    // Upstream: random_range returns an integer.
    random_range: (a: unknown, b: unknown) => {
      const x = Number(a), y = Number(b);
      const min = Math.min(x, y);
      const max = Math.max(x, y);
      return Math.floor(min + Math.random() * (max - min + 1));
    },
    dice: (sides: unknown) => {
      const s = Math.max(1, Math.floor(Number(sides)) || 1);
      return Math.floor(Math.random() * s) + 1;
    },
    // Variadic (upstream std-lib: min/max take any number of arguments).
    min: (...args: unknown[]) => Math.min(...args.map(Number)),
    max: (...args: unknown[]) => Math.max(...args.map(Number)),
    round: (n: unknown) => Math.round(Number(n)),
    round_places: (n: unknown, places: unknown) => {
      const p = Math.max(0, Math.floor(Number(places)) || 0);
      const factor = Math.pow(10, p);
      return Math.round(Number(n) * factor) / factor;
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
      const v = Number(n);
      return Math.abs(v - Math.trunc(v));
    },
    int: (n: unknown) => Math.trunc(Number(n)),
    // Upstream std-lib `format`: positional `{0}`-style placeholders.
    format: (fmt: unknown, ...args: unknown[]) =>
      String(fmt ?? "").replace(/\{(\d+)\}/g, (match, i: string) => {
        const value = args[Number(i)];
        return value === undefined ? match : stringifyOperand(value);
      }),
  };
  for (const [name, fn] of Object.entries(builtins)) {
    library.registerFunction(name, fn, builtinSignatures[name]);
  }
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
  dice: { params: ["number"], returns: "number" },
  min: { params: ["number"], variadic: true, returns: "number" },
  max: { params: ["number"], variadic: true, returns: "number" },
  round: { params: ["number"], returns: "number" },
  round_places: { params: ["number", "number"], returns: "number" },
  floor: { params: ["number"], returns: "number" },
  ceil: { params: ["number"], returns: "number" },
  inc: { params: ["number"], returns: "number" },
  dec: { params: ["number"], returns: "number" },
  decimal: { params: ["number"], returns: "number" },
  int: { params: ["number"], returns: "number" },
  format: { params: ["string", "number"], variadic: true, returns: "string" },
};
