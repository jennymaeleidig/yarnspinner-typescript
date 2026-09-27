// SPDX-License-Identifier: CC0-1.0
/**
 * `.ysls.json` command/function definitions (upstream schema:
 * https://schemas.yarnspinner.dev/ysls.schema.json) — the declared command
 * surface the project file's `definitions` field points at.
 *
 * Pure (coding standard §2): text in, parsed definitions + diagnostics out;
 * the loader reads the files through its injected file system and calls this.
 * Coding standard §3: every schema violation is a collected diagnostic
 * (`YP0009` malformed; `YP0010` is the loader's unreadable-file code), never
 * a throw. A file that still parses yields its (valid) declarations so known
 * commands keep validating even when a sibling entry is broken.
 *
 * The schema closes every object (`additionalProperties: false`) and requires
 * `version` at the root, `yarnName`/`parameters` on each command, and
 * `yarnName`/`parameters`/`return` on each function — all enforced here.
 */

import { projectDiagnostic } from "./projectDiagnostics.js";
import type { Diagnostic } from "./diagnostics.js";
import { describeError } from "../describeError.js";

/** The `.ysls` type vocabulary (upstream schema `$defs.type`). */
export type YarnValueType =
  "number" | "string" | "bool" | "instance" | "node" | "enum" | "any";

const VALUE_TYPES: readonly YarnValueType[] = [
  "number",
  "string",
  "bool",
  "instance",
  "node",
  "enum",
  "any",
];

export interface SourcePosition {
  line: number;
  character: number;
}

export interface DefinitionLocation {
  start: SourcePosition;
  end: SourcePosition;
}

export interface CommandParameter {
  name: string;
  type: YarnValueType;
  subtype?: string;
  documentation?: string;
  /** A default makes this parameter optional for count validation. */
  defaultValue?: string;
  /** `params`-style variadic: optional, and swallows further parameters. */
  isParamsArray?: boolean;
}

export interface CommandDefinition {
  /** Name as written in Yarn scripts. */
  yarnName: string;
  parameters: CommandParameter[];
  definitionName?: string;
  fileName?: string;
  language?: string;
  documentation?: string;
  async?: boolean;
  containsErrors?: boolean;
  location?: DefinitionLocation;
}

export interface FunctionReturn {
  type: YarnValueType;
  subtype?: string;
  description?: string;
}

export interface FunctionDefinition extends CommandDefinition {
  return: FunctionReturn;
}

/** The parsed contents of one `.ysls.json` file. */
export interface CommandDefinitions {
  version: number;
  commands: CommandDefinition[];
  functions: FunctionDefinition[];
}

export interface ParsedCommandDefinitions {
  /** Present when the file parsed to an object; `null` on JSON/root failure. */
  definitions: CommandDefinitions | null;
  diagnostics: Diagnostic[];
}

const ROOT_KEYS = new Set(["version", "commands", "functions"]);
const COMMAND_KEYS = new Set([
  "yarnName",
  "definitionName",
  "fileName",
  "language",
  "documentation",
  "parameters",
  "async",
  "location",
  "containsErrors",
]);
const FUNCTION_KEYS = new Set([...COMMAND_KEYS, "return"]);
const PARAMETER_KEYS = new Set([
  "name",
  "type",
  "subtype",
  "documentation",
  "defaultValue",
  "isParamsArray",
]);
const RETURN_KEYS = new Set(["type", "subtype", "description"]);
const LOCATION_KEYS = new Set(["start", "end"]);
const POSITION_KEYS = new Set(["line", "character"]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parse and validate one `.ysls.json`. `file` names the source in every
 * diagnostic (and is the JSONP-level `YP0009`/`null` failure). Returns
 * `definitions: null` only when the text is not JSON or the root is not an
 * object; schema violations inside a well-formed object are diagnosed but the
 * valid declarations still come back.
 */
export function parseCommandDefinitions(
  source: string,
  file = "definitions.ysls.json",
): ParsedCommandDefinitions {
  const diagnostics: Diagnostic[] = [];
  const fail = (message: string): ParsedCommandDefinitions => {
    diagnostics.push(projectDiagnostic("YP0009", message, file));
    return { definitions: null, diagnostics };
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (e) {
    return fail(`${file} is not valid JSON: ${describeError(e)}`);
  }
  if (!isObject(parsed)) {
    return fail(`${file} must contain a JSON object`);
  }

  /** Skip (with a diagnostic) every key not in `allowed` at one object. */
  const unknownKeys = (
    obj: Record<string, unknown>,
    allowed: Set<string>,
    path: string,
  ): void => {
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) {
        diagnostics.push(
          projectDiagnostic(
            "YP0009",
            `Unknown field \`${key}\` at \`${path}\` (not in the ysls schema)`,
            file,
          ),
        );
      }
    }
  };

  const readString = (
    obj: Record<string, unknown>,
    key: string,
    path: string,
  ): string | undefined => {
    const value = obj[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      diagnostics.push(
        projectDiagnostic(
          "YP0009",
          `\`${path}.${key}\` must be a string`,
          file,
        ),
      );
      return undefined;
    }
    return value;
  };

  const readBoolean = (
    obj: Record<string, unknown>,
    key: string,
    path: string,
  ): boolean | undefined => {
    const value = obj[key];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
      diagnostics.push(
        projectDiagnostic(
          "YP0009",
          `\`${path}.${key}\` must be a boolean`,
          file,
        ),
      );
      return undefined;
    }
    return value;
  };

  const readType = (
    obj: Record<string, unknown>,
    key: string,
    path: string,
  ): YarnValueType | undefined => {
    const value = obj[key];
    if (
      typeof value !== "string" ||
      !VALUE_TYPES.includes(value as YarnValueType)
    ) {
      diagnostics.push(
        projectDiagnostic(
          "YP0009",
          `\`${path}.${key}\` must be one of ${VALUE_TYPES.join(" | ")}`,
          file,
        ),
      );
      return undefined;
    }
    return value as YarnValueType;
  };

  const readLocation = (
    obj: Record<string, unknown>,
    path: string,
  ): DefinitionLocation | undefined => {
    const value = obj.location;
    if (value === undefined) return undefined;
    if (!isObject(value) || !isObject(value.start) || !isObject(value.end)) {
      diagnostics.push(
        projectDiagnostic(
          "YP0009",
          `\`${path}.location\` must be { start, end } positions`,
          file,
        ),
      );
      return undefined;
    }
    unknownKeys(value, LOCATION_KEYS, `${path}.location`);
    const readPos = (p: Record<string, unknown>, at: string) => {
      unknownKeys(p, POSITION_KEYS, at);
      if (typeof p.line !== "number" || typeof p.character !== "number") {
        diagnostics.push(
          projectDiagnostic(
            "YP0009",
            `\`${at}\` must have numeric \`line\` and \`character\``,
            file,
          ),
        );
        return null;
      }
      return { line: p.line, character: p.character };
    };
    const start = readPos(value.start, `${path}.location.start`);
    const end = readPos(value.end, `${path}.location.end`);
    if (!start || !end) return undefined;
    return { start, end };
  };

  const readParameter = (
    value: unknown,
    path: string,
  ): CommandParameter | undefined => {
    if (!isObject(value)) {
      diagnostics.push(
        projectDiagnostic("YP0009", `\`${path}\` must be an object`, file),
      );
      return undefined;
    }
    unknownKeys(value, PARAMETER_KEYS, path);
    const name = readString(value, "name", path);
    const type = readType(value, "type", path);
    const isParamsArray = readBoolean(value, "isParamsArray", path);
    if (name === undefined || type === undefined) {
      diagnostics.push(
        projectDiagnostic(
          "YP0009",
          `\`${path}\` requires \`name\` and \`type\``,
          file,
        ),
      );
      return undefined;
    }
    return {
      name,
      type,
      ...optionalString(value, "subtype", path, diagnostics, file),
      ...optionalString(value, "documentation", path, diagnostics, file),
      ...optionalString(value, "defaultValue", path, diagnostics, file),
      ...(isParamsArray !== undefined ? { isParamsArray } : {}),
    };
  };

  const readParameters = (
    value: unknown,
    path: string,
  ): CommandParameter[] | undefined => {
    if (!Array.isArray(value)) {
      diagnostics.push(
        projectDiagnostic(
          "YP0009",
          `\`${path}\` must be an array of parameters`,
          file,
        ),
      );
      return undefined;
    }
    const parameters: CommandParameter[] = [];
    for (let i = 0; i < value.length; i++) {
      const p = readParameter(value[i], `${path}[${i}]`);
      if (p) parameters.push(p);
    }
    return parameters;
  };

  const readCommand = (
    value: unknown,
    path: string,
    isFunction: boolean,
  ): CommandDefinition | undefined => {
    if (!isObject(value)) {
      diagnostics.push(
        projectDiagnostic("YP0009", `\`${path}\` must be an object`, file),
      );
      return undefined;
    }
    unknownKeys(value, isFunction ? FUNCTION_KEYS : COMMAND_KEYS, path);
    const yarnName = readString(value, "yarnName", path);
    const parameters = readParameters(value.parameters, `${path}.parameters`);
    const isAsync = readBoolean(value, "async", path);
    const containsErrors = readBoolean(value, "containsErrors", path);
    if (yarnName === undefined || parameters === undefined) {
      diagnostics.push(
        projectDiagnostic(
          "YP0009",
          `\`${path}\` requires \`yarnName\` and \`parameters\``,
          file,
        ),
      );
      return undefined;
    }
    const base: CommandDefinition = {
      yarnName,
      parameters,
      ...optionalString(value, "definitionName", path, diagnostics, file),
      ...optionalString(value, "fileName", path, diagnostics, file),
      ...optionalString(value, "language", path, diagnostics, file),
      ...optionalString(value, "documentation", path, diagnostics, file),
      ...(isAsync !== undefined ? { async: isAsync } : {}),
      ...(containsErrors !== undefined ? { containsErrors } : {}),
    };
    const location = readLocation(value, path);
    if (location) base.location = location;
    return base;
  };

  unknownKeys(parsed, ROOT_KEYS, file);

  const version = parsed.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    diagnostics.push(
      projectDiagnostic(
        "YP0009",
        `\`${file}\` requires an integer \`version\``,
        file,
      ),
    );
  }

  const commands: CommandDefinition[] = [];
  if (parsed.commands !== undefined) {
    if (!Array.isArray(parsed.commands)) {
      diagnostics.push(
        projectDiagnostic("YP0009", "`commands` must be an array", file),
      );
    } else {
      for (let i = 0; i < parsed.commands.length; i++) {
        const c = readCommand(parsed.commands[i], `commands[${i}]`, false);
        if (c) commands.push(c);
      }
    }
  }

  const functions: FunctionDefinition[] = [];
  if (parsed.functions !== undefined) {
    if (!Array.isArray(parsed.functions)) {
      diagnostics.push(
        projectDiagnostic("YP0009", "`functions` must be an array", file),
      );
    } else {
      for (let i = 0; i < parsed.functions.length; i++) {
        const path = `functions[${i}]`;
        const base = readCommand(parsed.functions[i], path, true);
        if (!base) continue;
        const entry = parsed.functions[i] as Record<string, unknown>;
        const returnObj = entry.return;
        if (!isObject(returnObj)) {
          diagnostics.push(
            projectDiagnostic(
              "YP0009",
              `\`${path}\` requires a \`return\``,
              file,
            ),
          );
        } else {
          unknownKeys(returnObj, RETURN_KEYS, `${path}.return`);
          const type = readType(returnObj, "type", `${path}.return`);
          if (type !== undefined) {
            functions.push({
              ...base,
              return: {
                type,
                ...optionalString(
                  returnObj,
                  "subtype",
                  `${path}.return`,
                  diagnostics,
                  file,
                ),
                ...optionalString(
                  returnObj,
                  "description",
                  `${path}.return`,
                  diagnostics,
                  file,
                ),
              },
            });
          }
        }
      }
    }
  }

  return {
    definitions: {
      version: typeof version === "number" ? version : 0,
      commands,
      functions,
    },
    diagnostics,
  };
}

/** Read an optional string field, diagnosing a wrong-typed value. */
function optionalString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
  file: string,
): Record<string, string> {
  const value = obj[key];
  if (value === undefined) return {};
  if (typeof value !== "string") {
    diagnostics.push(
      projectDiagnostic("YP0009", `\`${path}.${key}\` must be a string`, file),
    );
    return {};
  }
  return { [key]: value };
}
