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
 * The content directory is the app's own authored Yarn project: a root
 * `.yarnproject` plus one `.yarn` file, exactly the shape a real consumer
 * repo would carry.
 */
export default function Page() {
  // `next build`/`next dev` run from the repo root (see package.json's
  // host:build), so the content dir resolves relative to it.
  const projectPath = join(
    process.cwd(),
    "examples",
    "nextjs-host",
    "content",
    "project.yarnproject",
  );
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
