// SPDX-License-Identifier: CC0-1.0
/**
 * Fidelity ticket 14: generated-variable & once-state key parity.
 *
 * - Generated-variable keys carry upstream's leading `$` sigil — upstream
 *   names its generated variables `$Yarn.Internal.*` (Library.cs
 *   `GenerateUniqueContentViewedVariableName`,
 *   `ContentSaliencyOption.ViewCountKey`), and host-visible storage
 *   inspection should match. The storage keeps the sigil; the VM reads
 *   generated keys straight from storage (they are never authored
 *   variables, so the evaluator's `$`-stripping resolution never applies).
 * - `<<once>>`-statement keys derive from upstream's location checksum:
 *   TypeCheckerListener.ExitOnce_primary_clause computes
 *   CRC32("'once' statement in file {file}, node {node}, line {line}") and
 *   names the variable `$Yarn.Internal.Once.<checksum>`.
 * - Saliency complexity scoring counts boolean operators from a parsed
 *   expression (upstream `GetBooleanOperatorCountInExpression` walks the
 *   parse tree for ExpAndOrXorContext nodes) — a variable named `$or` is a
 *   variable, not an operator.
 */

import { test } from "node:test";
import { equal, ok } from "node:assert";
import { compileOk } from "./compileOk.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";
import { runUntilCompleteEvents } from "../runtime/transcript.js";
import {
  contentViewCountVariableKey,
  generatedVariablePrefix,
  onceStatementVariableKey,
  onceVariableKey,
  visitCountVariableKey,
} from "../runtime/generatedVariables.js";

function makeDialogue(
  source: string,
  opts?: ConstructorParameters<typeof Dialogue>[1],
): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

function mapStorage(): {
  storage: Map<string, unknown>;
  variableStorage: ConstructorParameters<typeof Dialogue>[1] extends infer O
    ? O extends { variableStorage?: infer V }
      ? V
      : never
    : never;
} {
  const storage = new Map<string, unknown>();
  return {
    storage,
    variableStorage: {
      has: (k: string) => storage.has(k),
      get: (k: string) => storage.get(k),
      set: (k: string, v: unknown) => storage.set(k, v),
      entries: () => storage.entries(),
    } as never,
  };
}

// ── The `$` sigil ────────────────────────────────────────────────────────

test("generated-variable keys carry upstream's $ sigil", () => {
  equal(generatedVariablePrefix, "$Yarn.Internal.");
  equal(onceVariableKey("line:abc"), "$Yarn.Internal.Once.line:abc");
  equal(
    contentViewCountVariableKey("content"),
    "$Yarn.Internal.Content.ViewCount.content",
  );
  equal(visitCountVariableKey("Start"), "$Yarn.Internal.VisitCount.Start");
});

test("once-state lives in storage under the sigil'd generated namespace — and still gates", () => {
  const ONCE_SCRIPT = `
title: Start
---
<<once>>
    Once line
<<endonce>>
Narrator: Always
===
`;
  const { storage, variableStorage } = mapStorage();
  const first = makeDialogue(ONCE_SCRIPT, { variableStorage });
  runUntilCompleteEvents(first);
  const keys = [...storage.keys()];
  ok(
    keys.some((k) => k.startsWith("$Yarn.Internal.Once.")),
    `once-state should sit under upstream's $-sigil'd namespace, got: ${keys.join(", ")}`,
  );

  // The once gate still works across the sigil: a fresh dialogue over the
  // same storage suppresses the block (the bytecode's sigil'd pushVariable
  // reads the same stored key).
  const second = makeDialogue(ONCE_SCRIPT, { variableStorage });
  const texts = runUntilCompleteEvents(second)
    .filter(
      (e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line",
    )
    .map((e) => e.text);
  ok(
    !texts.includes("Once line"),
    "the stored once-flag (under its sigil'd key) still suppresses the block",
  );
  ok(texts.includes("Always"));
});

test("visit counts land under the sigil'd key and visited() reads them", () => {
  const { storage, variableStorage } = mapStorage();
  const first = makeDialogue(
    `
title: Start
---
Narrator: here
===
`,
    { variableStorage },
  );
  runUntilCompleteEvents(first);
  equal(
    storage.get(visitCountVariableKey("Start")),
    1,
    "the visit count sits under the sigil'd key",
  );

  const second = makeDialogue(
    `
title: Start
---
{visited("Start")}
===
`,
    { variableStorage },
  );
  const line = second
    .continue()
    .find(
      (e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line",
    );
  ok(line);
  equal(
    line.text,
    "True",
    "visited() reads the same sigil'd key the runtime writes",
  );
});

// ── <<once>> statement keys: upstream's location CRC32 ──────────────────

test("<<once>> statement keys derive from upstream's location checksum", () => {
  // Golden value computed with .NET against upstream's exact derivation:
  // CRC32 of "'once' statement in file story.yarn, node Start, line 5",
  // rendered little-endian lowercase hex (upstream CRC32.GetChecksumString).
  equal(
    onceStatementVariableKey({
      sourceFileName: "story.yarn",
      nodeTitle: "Start",
      lineNumber: 5,
    }),
    "$Yarn.Internal.Once.512285c3",
  );
  // Distinct locations hash distinctly.
  ok(
    onceStatementVariableKey({
      sourceFileName: "story.yarn",
      nodeTitle: "Start",
      lineNumber: 6,
    }) !==
      onceStatementVariableKey({
        sourceFileName: "story.yarn",
        nodeTitle: "Start",
        lineNumber: 5,
      }),
  );
});

// ── Complexity scoring: parsed expressions, not string matching ──────────

test("a variable named $or is not counted as a boolean operator", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<declare $or = false>>
<<jump Group>>
===
title: Group
when: $or
---
Member 0
===
`);
  const options = dialogue.getSaliencyOptionsForNodeGroup("Group");
  equal(options.length, 1);
  // Upstream ComplexityScore for `when: $or`: no ExpAndOrXor nodes → 0 + 1.
  equal(
    options[0].complexityScore,
    1,
    "the variable named $or is not counted as an operator",
  );
});

test("boolean operators still score from the parsed expression", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<declare $a = false>>
<<declare $b = false>>
<<declare $c = false>>
<<jump Group>>
===
title: Group
when: $a and $b or $c
---
Member 0
===
`);
  const options = dialogue.getSaliencyOptionsForNodeGroup("Group");
  equal(options.length, 1);
  equal(options[0].complexityScore, 3, "two boolean operators + 1");
});

test("quoted strings and $-sigil'd variable names do not contribute", () => {
  const dialogue = makeDialogue(`
title: Start
---
<<declare $t = "">>
<<declare $or = false>>
<<jump Group>>
===
title: Group
when: $t == "or and xor" and $or
---
Member 0
===
`);
  const options = dialogue.getSaliencyOptionsForNodeGroup("Group");
  equal(options[0].complexityScore, 2, "one operator in the expression + 1");
});
