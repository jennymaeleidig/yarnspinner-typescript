/**
 * Test-side compile through the public collect-don't-throw seam
 * (deepening-wave ticket 09): the library hands back diagnostics and a
 * possibly-null program (the recorded keep-it-observable divergence); a
 * test that only wants a working program asserts that precondition
 * explicitly instead of reaching for the retired throwing AST seam.
 *
 * Tests that pin diagnostic behaviour use `compileSource` directly.
 */

import { compileSource } from "../index.js";
import type { Program } from "../compile/program.js";

export function compileOk(source: string, opts?: Parameters<typeof compileSource>[1]): Program {
  const { program, diagnostics } = compileSource(source, opts);
  if (!program || diagnostics.some((d) => d.severity === "error")) {
    const codes = diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`).join("; ");
    throw new Error(`unexpected compile failure (${codes || "no diagnostics"})`);
  }
  return program;
}
