// SPDX-License-Identifier: CC0-1.0
// The bundler-agnostic compile step: no Vite types cross this module, so the
// future webpack loader (Next.js webpack mode / Turbopack rules) reuses it
// verbatim. Contract (ticket 03 grows the emitted module's named exports;
// ticket 04 the project path): .yarn source in, an ESM module string out
// whose default export is the compiled Program.
//
// Throws on compile failure — deliberate at this seam: a bundler plugin's
// job is to turn compile failure into build failure, and the collect-don't-
// throw standard scopes to the library, not the bundler boundary. Ticket 03
// shapes the throw into a RollupError with loc/frame.

import { compileSource } from "yarn-spinner-runner-ts";

export function compileYarnToModule(source: string, filename: string): string {
  const result = compileSource(source, { file: filename });
  const { program, diagnostics } = result;
  if (program === null) {
    const first = diagnostics[0];
    throw new Error(
      first
        ? `${filename}: ${first.message} (${first.code})`
        : `${filename}: compilation produced no program`,
    );
  }
  return (
    `// ${filename} — compiled at build time by yarn-spinner-vite-plugin\n` +
    `export default ${JSON.stringify(program)};\n`
  );
}
