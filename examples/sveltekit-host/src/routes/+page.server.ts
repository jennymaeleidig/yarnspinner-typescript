import { join } from "node:path";

import { loadYarnProject } from "yarn-spinner-runner-ts/node";

/**
 * The SvelteKit host's server load: the
 * YarnProject loader runs here — the injected file-access seam
 * (`nodeProjectFs`, driven by `loadYarnProject`) earning its keep — and the
 * only thing crossing the load boundary to the page is the compiled program,
 * a plain serializable object (ADR 0001), plus loader context. The
 * `.server.ts` suffix keeps every Node import out of the client bundle: the
 * client gets data, never file access.
 *
 * With `prerender = true` (+layout.js, adapter-static) this runs once at
 * build time; the static page ships the opening pull's SSR output.
 */
export function load() {
  // `vite dev`/`vite build` run from the host directory (the sveltekit:*
  // npm targets cd here — the standard SvelteKit workflow), so the shared
  // demo content dir (`examples/content/`) resolves one level up.
  const projectPath = join(
    process.cwd(),
    "..",
    "content",
    "project.yarnproject",
  );
  const result = loadYarnProject(projectPath);

  if (result.program === null) {
    // Error diagnostics from the loader: legible failure, never a throw (§3).
    return { ok: false as const, diagnostics: result.diagnostics };
  }
  return {
    ok: true as const,
    program: result.program,
    projectName: result.project?.projectName ?? null,
    sources: result.sources,
    diagnostics: result.diagnostics,
  };
}
