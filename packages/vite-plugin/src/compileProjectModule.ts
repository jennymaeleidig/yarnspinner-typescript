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
// severity, the host decides the sink. Severity precedence is the loader's
// (loadProject composes the project file's own
// compilerOptions.diagnosticsSeverity under the host option per-code); the
// plugin layers no pass of its own.

import { dirname } from "node:path";
import { loadYarnProject, nodeProjectFs } from "yarnspinner-typescript/node";
import { loadLocalisations } from "yarnspinner-typescript";
import {
  partitionDiagnostics,
  type CompileYarnOptions,
  type CompiledYarnModule,
} from "./compileModule.js";

export function compileYarnProjectModule(
  projectFilePath: string,
  opts: CompileYarnOptions = {},
): CompiledYarnModule {
  const { project, stringTable, program, diagnostics } = loadYarnProject(
    projectFilePath,
    {
      declarations: opts.declarations,
      diagnosticsSeverity: opts.diagnosticsSeverity,
    },
  );
  // Severity precedence lives in loadProject: the project file's own map
  // first, then the host-supplied option per-code (most specific wins) —
  // one layering implementation, applied by the shared pass inside
  // compile(). The plugin adds no pass of its own.
  const localisation = loadLocalisations(
    { project, stringTable },
    nodeProjectFs(dirname(projectFilePath)),
  );
  const { errors, warnings } = partitionDiagnostics([
    ...diagnostics,
    ...localisation.diagnostics,
  ]);
  const code =
    `// ${projectFilePath} — loaded at build time by yarnspinner-vite-plugin\n` +
    `export default ${JSON.stringify({
      program,
      projectName: project?.projectName,
      // `baseLanguage` is a required project field (YP0003 fails the build
      // when absent), so no default is invented here: a load that reaches
      // the emitted module always had the field.
      baseLanguage: project?.baseLanguage,
      baseTable: localisation.baseTable,
      translations: localisation.translations,
      assets: localisation.assets,
      diagnostics: localisation.diagnostics,
    })};\n`;
  return { code, errors, warnings };
}
