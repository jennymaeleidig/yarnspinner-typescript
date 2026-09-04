// SPDX-License-Identifier: CC0-1.0
import { test } from "node:test";
import { strictEqual, ok, deepEqual } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileOk } from "./compileOk.js";
import * as pkg from "../index.js";
import { Dialogue } from "../runtime/dialogue.js";
import type { DialogueEvent } from "../runtime/dialogue.js";

function makeDialogue(source: string, opts?: ConstructorParameters<typeof Dialogue>[1]): Dialogue {
  const program = compileOk(source);
  return new Dialogue(program, { startAt: "Start", ...opts });
}

const lineTexts = (events: DialogueEvent[]) =>
  events.filter((e): e is Extract<DialogueEvent, { type: "line" }> => e.type === "line").map((e) => e.text);

// The AST-level lowering seam is internal: real
// for tooling and the compiler's own tests, unreachable from the package
// root — hosts meet only the collect-don't-throw seam.
test("compileDocument and its error types are not package surface", () => {
  strictEqual("compileDocument" in pkg, false);
  strictEqual("LoweringError" in pkg, false);
  strictEqual("CompileDocumentOptions" in pkg, false);
});

// The React adapter was deleted: the package root must stay React-free.
// The strengthened pin asserts the whole surface, not just the namespace —
// no stray adapter export, no "./react" subpath in the export map, no
// react/react-dom peers, and no jsx-runtime reference anywhere in dist/.
test("the package root and its packaging are React-free", () => {
  strictEqual("DialogueRunner" in pkg, false);
  strictEqual("useDialogue" in pkg, false);

  const pkgJson: {
    exports: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
    peerDependenciesMeta?: Record<string, unknown>;
  } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  ok(!("./react" in pkgJson.exports), 'exports must not carry a "./react" subpath');
  ok(!pkgJson.peerDependencies?.react, "peerDependencies must not list react");
  ok(!pkgJson.peerDependencies?.["react-dom"], "peerDependencies must not list react-dom");
  ok(!pkgJson.peerDependenciesMeta?.react, "peerDependenciesMeta must not list react");
  ok(!pkgJson.peerDependenciesMeta?.["react-dom"], "peerDependenciesMeta must not list react-dom");

  // Same technique as nextjsHost's bundle-purity pin, scoped to the shipped
  // artifacts (the `files` tree): no emitted package file may reference
  // react/jsx-runtime. dist/tests is excluded — the compiled test bundles
  // themselves carry the literal (this assertion's own source).
  const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "tests") continue;
        walk(path);
      } else if (/\.(js|cjs)$/.test(entry.name)) {
        if (readFileSync(path, "utf8").includes("react/jsx-runtime")) offenders.push(path);
      }
    }
  };
  walk(join(distDir, "dist"));
  deepEqual(offenders, [], "no dist artifact may reference react/jsx-runtime");
});

test("basic dialogue with options", () => {
  const dialogue = `
title: Start
---
Narrator: Hi
-> Opt A
    Narrator: A chosen
-> Opt B
    Narrator: B chosen
===
`;

  const ir = compileOk(dialogue);
  const runner = new Dialogue(ir, { startAt: "Start" });

  strictEqual(lineTexts(runner.continue())[0], "Hi");

  const optionsEvent = runner.continue().find(
    (e): e is Extract<DialogueEvent, { type: "options" }> => e.type === "options",
  );
  strictEqual(optionsEvent?.options.length, 2);
  runner.selectOption(0);

  const chosen = lineTexts(runner.continue());
  strictEqual(chosen.includes("A chosen"), true);
});
