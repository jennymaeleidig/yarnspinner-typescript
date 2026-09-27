// SPDX-License-Identifier: CC0-1.0
/**
 * Command-definition parsing (`.ysls.json`, upstream schema
 * https://schemas.yarnspinner.dev/ysls.schema.json) and opt-in command
 * validation (YS0060 UnknownCommand / YS0061 WrongCommandParameterCount).
 *
 * Both codes are `generated_in: languageserver` upstream and are not emitted
 * by the default compile path: `validateCommands` is opt-in so output and
 * diagnostics stay byte-identical without it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSource } from "../compile/compileSource.js";
import { parseCommandDefinitions } from "../compile/commandDefinitions.js";
import type { Diagnostic } from "../compile/diagnostics.js";
import { loadProject } from "../index.js";
import type { YarnProjectFileSystem } from "../index.js";

// ── .ysls.json parsing ────────────────────────────────────────────────────

const codesOf = (diagnostics: { code: string }[]) =>
  diagnostics.map((d) => d.code);

const GOOD = JSON.stringify({
  version: 1,
  commands: [
    {
      yarnName: "block",
      parameters: [
        { name: "id", type: "string" },
        {
          name: "placement",
          type: "string",
          defaultValue: "join",
        },
      ],
    },
  ],
  functions: [],
});

test("parseCommandDefinitions reads a well-formed .ysls.json", () => {
  const { definitions, diagnostics } = parseCommandDefinitions(
    GOOD,
    "definitions.ysls.json",
  );
  assert.deepEqual(codesOf(diagnostics), []);
  assert.equal(definitions?.version, 1);
  assert.equal(definitions?.commands.length, 1);
  assert.equal(definitions?.commands[0].yarnName, "block");
  assert.equal(definitions?.commands[0].parameters[1].defaultValue, "join");
});

test("parseCommandDefinitions diagnoses malformed JSON without throwing", () => {
  const { definitions, diagnostics } = parseCommandDefinitions(
    "{ not json",
    "definitions.ysls.json",
  );
  assert.equal(definitions, null);
  assert.deepEqual(codesOf(diagnostics), ["YP0009"]);
  assert.match(diagnostics[0].message, /definitions\.ysls\.json/);
});

test("parseCommandDefinitions diagnoses a missing version", () => {
  const { diagnostics } = parseCommandDefinitions(
    JSON.stringify({ commands: [] }),
    "d.ysls.json",
  );
  assert.ok(codesOf(diagnostics).includes("YP0009"));
});

test("parseCommandDefinitions diagnoses additionalProperties violations at every level", () => {
  const { diagnostics } = parseCommandDefinitions(
    JSON.stringify({
      version: 1,
      nope: true,
      commands: [
        {
          yarnName: "block",
          parameters: [{ name: "id", type: "string", potato: 1 }],
          bogus: 2,
        },
      ],
      functions: [
        {
          yarnName: "f",
          parameters: [],
          return: { type: "number", extra: 1 },
          alsoBogus: 1,
        },
      ],
    }),
    "d.ysls.json",
  );
  const messages = diagnostics.map((d) => d.message).join("\n");
  for (const key of ["nope", "potato", "bogus", "extra", "alsoBogus"]) {
    assert.match(messages, new RegExp(`\\b${key}\\b`), `missing ${key}`);
  }
});

test("parseCommandDefinitions diagnoses an invalid parameter type", () => {
  const { diagnostics } = parseCommandDefinitions(
    JSON.stringify({
      version: 1,
      commands: [
        {
          yarnName: "block",
          parameters: [{ name: "id", type: "potato" }],
        },
      ],
    }),
    "d.ysls.json",
  );
  assert.ok(codesOf(diagnostics).includes("YP0009"));
});

// ── Opt-in command validation ────────────────────────────────────────────

const POLICY = JSON.stringify({
  version: 1,
  commands: [
    {
      yarnName: "block",
      parameters: [
        { name: "id", type: "string" },
        { name: "placement", type: "string", defaultValue: "join" },
      ],
    },
    {
      yarnName: "spread",
      parameters: [
        { name: "first", type: "string" },
        { name: "rest", type: "string", isParamsArray: true },
      ],
    },
  ],
});

function check(body: string, definitions = POLICY): Diagnostic[] {
  return compileSource(`title: Start\n---\n${body}\n===\n`, {
    validateCommands: true,
    commandDefinitions: parseCommandDefinitions(definitions, "d.ysls.json")
      .definitions!,
  }).diagnostics;
}

test("a declared command with matching arity produces no command diagnostic", () => {
  assert.deepEqual(codesOf(check('<<block "flock-demo" join>>')), []);
});

test("an unknown command produces exactly one YS0060 at the command name", () => {
  const diagnostics = check('<<blcok "x">>');
  assert.deepEqual(codesOf(diagnostics), ["YS0060"]);
  assert.equal(diagnostics[0].message, "Unknown command: blcok");
  assert.deepEqual(diagnostics[0].range, {
    startLine: 2,
    startCol: 2,
    endLine: 2,
    endCol: 7,
  });
});

test("a declared command called with too few or too many arguments is YS0061", () => {
  for (const body of ["<<block>>", '<<block "a" "b" "c">>']) {
    const diagnostics = check(body);
    assert.deepEqual(
      codesOf(diagnostics),
      ["YS0061"],
      `for ${body}: ${JSON.stringify(diagnostics)}`,
    );
  }
});

test("a defaultValue makes the trailing parameter optional", () => {
  assert.deepEqual(codesOf(check('<<block "only-id">>')), []);
});

test("an isParamsArray last parameter accepts N extra arguments", () => {
  assert.deepEqual(codesOf(check('<<spread "a" "b" "c" "d">>')), []);
  // ...but still requires the mandatory prefix.
  assert.deepEqual(codesOf(check("<<spread>>")), ["YS0061"]);
});

test("built-in commands are not reported unknown; wait is arity-checked", () => {
  assert.deepEqual(codesOf(check("<<stop>>")), []);
  assert.deepEqual(codesOf(check("<<wait 1>>")), []);
  assert.deepEqual(codesOf(check("<<wait 1 2>>")), ["YS0061"]);
});

test("interpolated command names are not validated statically", () => {
  assert.deepEqual(codesOf(check("<<{ $cmd }>>")), []);
});

test("without validateCommands the compile result is byte-identical", () => {
  const source = "title: Start\n---\n<<made up command>>\n===\n";
  const plain = compileSource(source);
  const optIn = compileSource(source, {
    validateCommands: false,
    commandDefinitions: { version: 1, commands: [], functions: [] },
  });
  assert.deepEqual(codesOf(plain.diagnostics), []);
  assert.deepEqual(
    JSON.stringify(plain.program),
    JSON.stringify(optIn.program),
  );
});

// ── Loader seam ───────────────────────────────────────────────────────────

function memoryFs(files: Record<string, string>): YarnProjectFileSystem {
  const names = Object.keys(files).sort();
  return {
    listFiles: () => [...names],
    read: (p: string) => (p in files ? files[p] : null),
  };
}

const project = {
  projectFileVersion: 4,
  sourceFiles: ["**/*.yarn"],
  baseLanguage: "en",
  definitions: "definitions.ysls.json",
};

test("loadProject reads the .yarnproject definitions and validates when opted in", () => {
  const r = loadProject({
    project,
    fileSystem: memoryFs({
      "story.yarn": 'title: A\n---\n<<block "id" join>>\n===\n',
      "definitions.ysls.json": POLICY,
    }),
    validateCommands: true,
  });
  assert.deepEqual(codesOf(r.diagnostics), []);
  assert.equal(r.project?.commandDefinitions?.commands.length, 2);
});

test("loadProject without validateCommands keeps a typo silent (byte parity)", () => {
  const r = loadProject({
    project,
    fileSystem: memoryFs({
      "story.yarn": 'title: A\n---\n<<blcok "id">>\n===\n',
      "definitions.ysls.json": POLICY,
    }),
  });
  assert.deepEqual(codesOf(r.diagnostics), []);
});

test("loadProject reports a malformed definitions file as a project diagnostic", () => {
  const r = loadProject({
    project,
    fileSystem: memoryFs({
      "story.yarn": "title: A\n---\n===\n",
      "definitions.ysls.json": "{ not json",
    }),
    validateCommands: true,
  });
  assert.ok(codesOf(r.diagnostics).includes("YP0009"));
  assert.ok(r.program, "a warning must not block the build");
});

test("loadProject reports an unreadable definitions file (YP0010)", () => {
  const r = loadProject({
    project,
    fileSystem: memoryFs({ "story.yarn": "title: A\n---\n===\n" }),
    validateCommands: true,
  });
  assert.ok(codesOf(r.diagnostics).includes("YP0010"));
});
