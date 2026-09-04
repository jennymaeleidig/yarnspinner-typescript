// SPDX-License-Identifier: CC0-1.0
/**
 * Diagnostic-definition golden loop (the conformance harness): every code the compiler registers must fire on
 * its own vendored 3.2.2 example script — the Definitions/*.md `examples`
 * are upstream's own executable spec for each YSxxxx code. Codes the
 * compiler deliberately does not emit (deferred / languageserver-generated)
 * are pinned as absent from the registry.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../compile/compileSource.js";
import { DIAGNOSTIC_REGISTRY } from "../compile/diagnostics.js";
import { loadDiagnosticDefinitions } from "./upstream/diagnosticDefinitions.js";

const definitions = loadDiagnosticDefinitions();

test("every registered code's vendored examples emit that exact code", () => {
  const registered = new Set(Object.keys(DIAGNOSTIC_REGISTRY));
  let checked = 0;
  for (const def of definitions) {
    if (!registered.has(def.code)) continue;
    // YS0041 InternalError guards compiler invariants — unreachable by
    // content, so upstream's definition ships no example to pin.
    if (def.code === "YS0041") continue;
    assert.ok(
      def.scripts.length > 0,
      `${def.code} is registered but its vendored definition has no examples to pin`,
    );
    for (const [index, script] of def.scripts.entries()) {
      const { diagnostics } = compile([{ name: `${def.code}-example-${index}.yarn`, source: script }]);
      assert.ok(
        diagnostics.some((d) => d.code === def.code),
        `${def.code} (${def.name}) example #${index} did not emit its code — got [${diagnostics
          .map((d) => `${d.code}: ${d.message}`)
          .join("; ")}]\nscript:\n${script}`,
      );
      checked++;
    }
  }
  assert.ok(checked >= 30, `expected to pin most of the registry, pinned ${checked}`);
});

test("languageserver-generated codes are never compiler-emitted (registry)", () => {
  for (const def of definitions) {
    if (def.generatedIn) {
      assert.ok(
        !(def.code in DIAGNOSTIC_REGISTRY),
        `${def.code} is generated_in: ${def.generatedIn} — the compiler must not register it`,
      );
    }
  }
});

test("registered default severities match the vendored definitions", () => {
  for (const def of definitions) {
    const descriptor = DIAGNOSTIC_REGISTRY[def.code];
    if (!descriptor || !def.defaultSeverity) continue;
    assert.equal(
      descriptor.defaultSeverity,
      def.defaultSeverity,
      `${def.code} severity drift between the registry and the vendored definition`,
    );
  }
});
