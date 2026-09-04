// SPDX-License-Identifier: CC0-1.0
// The project-side compile step: a .yarnproject file on disk in, the
// emitted ESM text out. Runs on the Node side of the bundler (build time):
// loadYarnProject resolves source globs and reads .yarn sources through the
// Node file system, loadLocalisations reads the declared strings CSVs —
// nothing of that reaches the emitted module, which is pure data (the
// program plus the localisation surface the runtime consumes). No Vite
// types cross this module; a webpack loader reuses it verbatim.
//
// Same diagnostics contract as compileYarnModule: partition by final
// severity, the host decides the sink. The project file's own
// compilerOptions.diagnosticsSeverity flows through loadProject into
// compile(); the plugin option can layer more.

import { dirname } from "node:path";
import {
  loadYarnProject,
  nodeProjectFs,
} from "yarn-spinner-runner-ts/node";
import { loadLocalisations } from "yarn-spinner-runner-ts";
import type { DiagnosticSeverity } from "yarn-spinner-runner-ts";
import { partitionDiagnostics, type CompileYarnOptions, type CompiledYarnModule } from "./compileModule.js";

export function compileYarnProjectModule(
  projectFilePath: string,
  opts: CompileYarnOptions = {},
): CompiledYarnModule {
  const { project, stringTable, program, diagnostics } = loadYarnProject(
    projectFilePath,
    { declarations: opts.declarations },
  );
  // Severity precedence, applied as one final pass over the returned
  // diagnostics: the project file's own map first, then the plugin's
  // top-level option, then the compilerOptions passthrough (most specific
  // wins). The loader applies the project's map internally; this re-pass
  // layers the plugin's values over it.
  const severity: Record<string, DiagnosticSeverity> = {
    ...project?.compilerOptions?.diagnosticsSeverity,
    ...opts.diagnosticsSeverity,
  };
  for (const d of diagnostics) {
    const override = severity[d.code];
    if (override) d.severity = override;
  }
  const localisation = loadLocalisations({ project, stringTable }, nodeProjectFs(dirname(projectFilePath)));
  const { errors, warnings } = partitionDiagnostics([...diagnostics, ...localisation.diagnostics]);
  const code =
    `// ${projectFilePath} — loaded at build time by yarn-spinner-vite-plugin\n` +
    `export default ${JSON.stringify({
      program,
      projectName: project?.projectName,
      baseLanguage: project?.baseLanguage ?? "en",
      baseTable: localisation.baseTable,
      translations: localisation.translations,
      assets: localisation.assets,
      diagnostics: localisation.diagnostics,
    })};\n`;
  return { code, errors, warnings };
}
