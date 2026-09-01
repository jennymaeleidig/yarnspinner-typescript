/**
 * Enum types (spec ticket 41; CONTEXT.md "Enum").
 *
 * An enum is a named set of cases with uniform raw values (number or string).
 * Script enums come from `<<enum>>` blocks; host enums are registered from
 * TypeScript via EnumTypeBuilder and flow through the external declarations
 * path (compileSource's `declarations.enums`) into compile-time checking and
 * userDefinedTypes — the same relationship upstream's EnumTypeBuilder output
 * has to CompilationJob.Declarations.
 *
 * Validation mirrors upstream YarnSpinner.Compiler.TypeCheckerListener.
 * ExitEnum_statement (verified against upstream main):
 * - no case has a raw value → number type, auto-numbered 0,1,2,…
 * - any case has a raw value → ALL must, all of one raw value type
 *   (number or string), all unique, numbers must be integers
 * - case names must be unique; enum names must be unique (YS0040)
 * - raw values must be constant literals (YS0037); declaration problems are
 *   the YS0035 catch-all
 * An enum that fails validation is not registered (upstream: "return without
 * registering the new type").
 */

import type { EnumBlock } from "../model/ast.js";

export type EnumRawValue = number | string;
export type EnumRawValueType = "number" | "string";

export interface EnumCase {
  name: string;
  rawValue: EnumRawValue;
}

export interface EnumType {
  name: string;
  rawValueType: EnumRawValueType;
  cases: EnumCase[];
}

/**
 * Builds a host-defined EnumType from TypeScript (upstream
 * `YarnSpinner.Compiler.EnumTypeBuilder`, with `WithName`/`WithCase`
 * mirrored as the constructor name and `addCase`).
 *
 * Like upstream, every case requires an explicit raw value (there is no
 * valueless `WithCase` overload upstream; auto-numbering is a script-enum
 * feature handled by the compile seam). Construction misuse (missing raw
 * value, duplicate case names, duplicate raw values, mixed raw value types)
 * throws here — matching upstream, which throws ArgumentException from the
 * builder. This is host programming error, not content diagnostics: the
 * compile seam stays collect-don't-throw (coding standards §3), and script
 * `<<enum>>` blocks go through diagnostics.
 */
export class EnumTypeBuilder {
  private readonly cases: EnumCase[] = [];
  private rawValueType: EnumRawValueType | null = null;

  constructor(public readonly name: string) {}

  addCase(caseName: string, rawValue?: number | string): this {
    if (rawValue === undefined) {
      // Upstream has no valueless WithCase overload; accept it in the type
      // so JS callers get a thrown error rather than a compile error.
      throw new Error(`Can't add case ${caseName} to enum ${this.name}: cases require an explicit raw value`);
    }
    if (this.cases.some((c) => c.name === caseName)) {
      throw new Error(`Can't add case ${caseName} to enum ${this.name}: a case with this name already exists`);
    }
    const rawType: EnumRawValueType = typeof rawValue === "number" ? "number" : "string";
    if (this.rawValueType === null) {
      this.rawValueType = rawType;
    } else if (this.rawValueType !== rawType) {
      throw new Error(
        `Can't add case ${caseName} to enum ${this.name}: raw value type must be ${this.rawValueType}`,
      );
    }
    if (this.cases.some((c) => c.rawValue === rawValue)) {
      throw new Error(
        `Can't add case ${caseName} with value ${rawValue} to enum ${this.name}: a case with this value already exists`,
      );
    }
    this.cases.push({ name: caseName, rawValue });
    return this;
  }

  build(): EnumType {
    if (this.cases.length === 0) {
      throw new Error(`Can't build enum ${this.name}: an enum must have at least one case`);
    }
    return {
      name: this.name,
      rawValueType: this.rawValueType ?? "number",
      cases: this.cases.map((c) => ({ ...c })),
    };
  }
}

/** A parsed raw-value literal: number or string. */
interface RawValueLiteral {
  rawValueType: EnumRawValueType;
  value: EnumRawValue;
}

/**
 * Parse a raw-value token as a constant literal (upstream
 * LiteralValueVisitor): a number (integer check is the caller's), a quoted
 * string, or a negated number. Anything else (function calls, member
 * references, bare words) is not a constant → null.
 */
export function parseRawValueLiteral(text: string): RawValueLiteral | null {
  const trimmed = text.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return { rawValueType: "number", value: Number(trimmed) };
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return { rawValueType: "string", value: trimmed.slice(1, -1) };
  }
  return null;
}

export type EnumDiagnosticEmitter = (code: string, message: string) => void;

/**
 * Validate script `<<enum>>` blocks and merge them with host-defined enum
 * types. Host enums register first: a script enum shadowing a host enum (or
 * a duplicate within either) is YS0040. Invalid script enums are not
 * registered. Returns the registry of valid enum types in registration
 * order.
 */
export function buildEnumTypes(
  scriptEnums: EnumBlock[],
  hostEnums: EnumType[],
  emit: EnumDiagnosticEmitter,
): Map<string, EnumType> {
  const registry = new Map<string, EnumType>();

  const register = (type: EnumType): boolean => {
    if (registry.has(type.name)) {
      emit("YS0040", `Can't create a new type ${type.name}: a type with this name already exists`);
      return false;
    }
    registry.set(type.name, type);
    return true;
  };

  for (const host of hostEnums) register(host);

  for (const enumBlock of scriptEnums) {
    if (enumBlock.cases.length === 0) {
      emit("YS0035", `Enum ${enumBlock.name} must not be empty`);
      continue;
    }

    // Unique case names (checked regardless of raw values).
    const byName = new Map<string, number>();
    let duplicateNames = false;
    for (const c of enumBlock.cases) {
      byName.set(c.name, (byName.get(c.name) ?? 0) + 1);
    }
    for (const [name, count] of byName) {
      if (count > 1) {
        duplicateNames = true;
        emit("YS0035", `Enum case ${name} must have a unique name.`);
      }
    }
    if (duplicateNames) continue;

    // Resolve raw values: literals only (upstream LiteralValueVisitor).
    interface ResolvedCase {
      name: string;
      literal: RawValueLiteral | null;
    }
    const resolvedCases: ResolvedCase[] = enumBlock.cases.map((c) => ({
      name: c.name,
      literal: c.rawValue !== undefined ? parseRawValueLiteral(c.rawValue) : null,
    }));

    const casesWithRawValue = resolvedCases.filter((c) => c.literal !== null);

    // Any non-literal raw value (function call, member reference, bare word)
    // is not a constant.
    const nonConstant = resolvedCases.filter(
      (c) => c.literal === null && enumBlock.cases.find((s) => s.name === c.name)?.rawValue !== undefined,
    );
    if (nonConstant.length > 0) {
      emit("YS0037", "Expected a constant type");
      continue;
    }

    if (casesWithRawValue.length === 0) {
      // No case has a raw value: number type, auto-numbered from 0.
      const cases = resolvedCases.map((c, index) => ({ name: c.name, rawValue: index as EnumRawValue }));
      register({ name: enumBlock.name, rawValueType: "number", cases });
      continue;
    }

    // Some case has a raw value: they ALL must.
    const missing = resolvedCases.filter((c) => c.literal === null);
    if (missing.length > 0) {
      for (const c of missing) {
        emit(
          "YS0035",
          `Enum case ${c.name} must also have a raw value (if any cases have a value, then they all must have one)`,
        );
      }
      continue;
    }

    // All raw values must be of a single type: number or string.
    const rawValueTypes = new Set(casesWithRawValue.map((c) => c.literal!.rawValueType));
    if (rawValueTypes.size > 1) {
      emit(
        "YS0035",
        `Enum member raw values may only be of a single type (they can't be a combination of ${[...rawValueTypes].join(" and ")})`,
      );
      continue;
    }
    const rawValueType = [...rawValueTypes][0];

    // Unique raw values.
    const byValue = new Map<EnumRawValue, string[]>();
    for (const c of casesWithRawValue) {
      const value = c.literal!.value;
      byValue.set(value, [...(byValue.get(value) ?? []), c.name]);
    }
    let duplicateValues = false;
    for (const [value, names] of byValue) {
      if (names.length > 1) {
        duplicateValues = true;
        for (const name of names) {
          emit(
            "YS0035",
            `Enum case ${name} must have a unique raw value (${value} is used by ${names.length - 1} other case(s).)`,
          );
        }
      }
    }
    if (duplicateValues) continue;

    // Number raw values must be integers.
    if (rawValueType === "number") {
      let nonInteger = false;
      for (const c of casesWithRawValue) {
        const num = c.literal!.value as number;
        if (!Number.isInteger(num)) {
          nonInteger = true;
          emit("YS0035", "Number raw values on enum cases must be integers");
        }
      }
      if (nonInteger) continue;
    }

    const cases = casesWithRawValue.map((c) => ({ name: c.name, rawValue: c.literal!.value }));
    register({ name: enumBlock.name, rawValueType, cases });
  }

  return registry;
}

/** Collect every `<<enum>>` block in the document (top-level and in nodes). */
export function collectEnumBlocks(doc: {
  enums: EnumBlock[];
  nodes: Array<{ body: Array<{ type: string }> }>;
}): EnumBlock[] {
  const blocks: EnumBlock[] = [...doc.enums];
  const walk = (stmts: Array<{ type: string }>): void => {
    for (const s of stmts) {
      if (s.type === "Enum") {
        blocks.push(s as EnumBlock);
        continue;
      }
      const nested = (s as { branches?: Array<{ body: Array<{ type: string }> }>; body?: Array<{ type: string }>; options?: Array<{ body: Array<{ type: string }> }> });
      for (const b of nested.branches ?? []) walk(b.body);
      if (nested.body) walk(nested.body);
      for (const o of nested.options ?? []) walk(o.body);
    }
  };
  for (const node of doc.nodes) walk(node.body);
  return blocks;
}

