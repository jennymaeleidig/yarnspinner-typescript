// SPDX-License-Identifier: CC0-1.0
/**
 * The runtime's operand semantics — one home for what each operator does
 * to its operand values. The VM's stack ops (`executeStackOp`) and the
 * string evaluator's arithmetic/comparison/logical loops both dispatch
 * through `applyBinaryOp`/`applyUnaryOp`, so a rule stated here holds for
 * both drivers' event streams — the lockstep the prose comments used to
 * coordinate (and which snapped once: xor was added "end to end" but
 * missed the string evaluator — ADR 0005).
 *
 * The primitives (`stringifyOperand`, `toNumberOperand`,
 * `deepEqualsOperands`) are the shared coercion/equality contract; they
 * are re-exported through `./evaluator.js`, their historical import path,
 * so the public surface (index.ts `export *`) is unchanged.
 */

/**
 * Render a value for string concatenation and composed text, the way upstream
 * does (C# value.ToString()): booleans as "True"/"False". This is the
 * observable text contract the upstream conformance corpus asserts.
 */
export function stringifyOperand(value: unknown): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value ?? "");
}

/**
 * Coerce an operand to a number the way the runtime's arithmetic does
 * (upstream C# conversions): booleans are 1/0, null and the empty string
 * are 0, anything else goes through `Number()` — and a non-numeric result
 * is an error, which callers surface as a runtime diagnostic.
 */
export function toNumberOperand(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value == null || value === "") return 0;
  const num = Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`Cannot convert ${String(value)} to number`);
  }
  return num;
}

/**
 * Convert a number to an int the way upstream's `Value.ConvertTo<int>()`
 * does (C# `Convert.ChangeType` → `IConvertible.ToInt32`): the midpoint
 * rounds to even (banker's rounding), so 7.5 converts to 8 and 2.5 to 2 —
 * not a truncating `(int)` cast. The `%` operator and the int-parameter
 * built-ins (`dice`) route through this.
 */
export function convertToInt32(value: number): number {
  const truncated = Math.trunc(value);
  const fraction = value - truncated;
  if (Math.abs(fraction) === 0.5) {
    return truncated % 2 === 0 ? truncated : truncated + Math.sign(value);
  }
  if (fraction > 0.5) return truncated + 1;
  if (fraction < -0.5) return truncated - 1;
  return truncated;
}

/**
 * The implicit default a variable has when compared against a typed value.
 */
function defaultValueFor(value: unknown): unknown {
  switch (typeof value) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "string":
      return "";
    default:
      return undefined;
  }
}

/**
 * The equality contract of the runtime's `==`/`!=` (shared with the VM's
 * `equalTo`/`notEqualTo` ops): deep equality, where an unset variable
 * carries its implicit default (bool→false, number→0, string→"")
 * inferred from the other side of the comparison — a deliberate
 * adaptation: upstream 3.2.2 instead falls back to the program's
 * declared initial values and throws when a variable is unset
 * (`VirtualMachine.PushVariable`).
 */
export function deepEqualsOperands(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // (The unset-variable contract — implicit default, deliberate adaptation
  // vs upstream's throw — is stated on the JSDoc above.)
  if (a === undefined && b !== undefined)
    return deepEqualsOperands(b, defaultValueFor(b));
  if (b === undefined && a !== undefined)
    return deepEqualsOperands(a, defaultValueFor(a));
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** The binary operator set over operand values (the instruction-stream op
 *  names; the string evaluator maps its operator spellings onto these). */
export type BinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "modulo"
  | "equalTo"
  | "notEqualTo"
  | "lessThan"
  | "greaterThan"
  | "lessThanOrEqualTo"
  | "greaterThanOrEqualTo"
  | "and"
  | "or"
  | "xor";

/** The unary operator set. */
export type UnaryOperator = "negate" | "not";

/**
 * Apply one binary operator to two operand values — the single statement of
 * every binary rule:
 * - `add`: string concatenation when either side is a string, rendering
 *   operands the upstream way (C# `ToString`: booleans as "True"/"False");
 *   otherwise numeric addition;
 * - `subtract`…`divide`: numeric via `toNumberOperand`; `modulo` converts
 *   both operands to int (upstream `ConvertTo<int>`, midpoint-to-even) and
 *   errors on a zero divisor;
 * - `equalTo`/`notEqualTo`: `deepEqualsOperands`;
 * - relationals: numeric via plain `Number()` (NaN comparisons yield false,
 *   never throw);
 * - `and`/`or`: JS boolean semantics over the values as given (the drivers'
 *   event streams must stay identical for non-bool operands too);
 * - `xor`: `Boolean(a) !== Boolean(b)` — upstream `BooleanType.MethodXor`:
 *   `ConvertTo<bool>() ^ ConvertTo<bool>()`.
 */
export function applyBinaryOp(
  op: BinaryOperator,
  a: unknown,
  b: unknown,
): unknown {
  switch (op) {
    case "add":
      return typeof a === "string" || typeof b === "string"
        ? stringifyOperand(a) + stringifyOperand(b) // upstream rendering
        : toNumberOperand(a) + toNumberOperand(b);
    case "subtract":
      return toNumberOperand(a) - toNumberOperand(b);
    case "multiply":
      return toNumberOperand(a) * toNumberOperand(b);
    case "divide":
      return toNumberOperand(a) / toNumberOperand(b);
    case "modulo": {
      // Upstream `NumberType.MethodModulus`: `a.ConvertTo<int>() %
      // b.ConvertTo<int>()` — both operands convert to int (C#
      // `Convert.ToInt32`: midpoint-to-even), and the remainder is C#'s int
      // remainder (sign follows the dividend, which JS `%` matches). A zero
      // divisor is a runtime error (upstream DivideByZeroException), never
      // NaN.
      const divisor = convertToInt32(toNumberOperand(b));
      if (divisor === 0) {
        throw new Error("Cannot divide by zero");
      }
      return convertToInt32(toNumberOperand(a)) % divisor;
    }
    case "equalTo":
      return deepEqualsOperands(a, b);
    case "notEqualTo":
      return !deepEqualsOperands(a, b);
    case "lessThan":
      return Number(a) < Number(b);
    case "greaterThan":
      return Number(a) > Number(b);
    case "lessThanOrEqualTo":
      return Number(a) <= Number(b);
    case "greaterThanOrEqualTo":
      return Number(a) >= Number(b);
    case "and":
      // Booleans, like the evaluator's logical evaluator.
      return Boolean(a && b);
    case "or":
      return Boolean(a || b);
    case "xor":
      return Boolean(a) !== Boolean(b);
  }
}

/**
 * Apply one unary operator (`negate` is numeric via `toNumberOperand`;
 * `not` is JS boolean negation of the value as given).
 */
export function applyUnaryOp(op: UnaryOperator, a: unknown): unknown {
  return op === "negate" ? -toNumberOperand(a) : !a;
}
