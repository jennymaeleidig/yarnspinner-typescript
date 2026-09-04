import { join } from "node:path";

import { loadYarnProject } from "yarn-spinner-runner-ts/node";

import DialogueHost from "./DialogueHost";

/**
 * The Next.js host's server component: the
 * YarnProject loader runs here, server-side — the injected file-access seam
 * (`nodeProjectFs`, driven by `loadYarnProject`) earning its keep: the
 * loader core never touches Node APIs, and none of them reach the client.
 * The only thing crossing the RSC boundary to {@link DialogueHost} is the
 * compiled program — a plain serializable object (ADR 0001) — plus loader
 * context.
 *
 * The shared demo content (`examples/content/`) is the app's story source:
 * one `.yarnproject` plus `.yarn` files, exactly the shape a real consumer
 * repo would carry — and the same content every host loads.
 */
export default function Page() {
  // `next build`/`next dev` run from the repo root (see package.json's
  // host:build), so the shared content dir resolves relative to it.
  const projectPath = join(process.cwd(), "examples", "content", "project.yarnproject");
  const result = loadYarnProject(projectPath);

  if (result.program === null) {
    // Error diagnostics from the loader: legible failure, never a throw (§3).
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: 32 }}>
        <h1>Project failed to load</h1>
        <ul>
          {result.diagnostics.map((d, i) => (
            <li key={i}>
              {d.code}: {d.message}
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <DialogueHost
      program={result.program}
      projectName={result.project?.projectName}
      sources={result.sources}
      diagnostics={result.diagnostics}
    />
  );
}
