// SPDX-License-Identifier: CC0-1.0
/**
 * Node file system for the YarnProject loader: the default {@link YarnProjectFileSystem} implementation plus
 * a one-call `loadYarnProject(path)` convenience.
 *
 * This module is the ONLY place the loader's I/O touches Node `fs` — the
 * loader core (`yarnProject.ts`) never imports it (coding standard §2). It
 * is exported from the `./node` subpath rather than the main entry so
 * browser bundlers pulling in `yarn-spinner-runner-ts` never see `node:fs`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { loadProject, failedResult } from "./yarnProject.js";
import type { LoadProjectResult, YarnProjectFileSystem } from "./yarnProject.js";
import type { CompileOptions } from "./compileSource.js";

/**
 * Directory names the default walker never descends into — dependencies and
 * VCS metadata are never Yarn sources (asserted by the loader tests).
 */
const SKIP_DIRS = ["node_modules", ".git"];

/** A {@link YarnProjectFileSystem} over a real directory on disk. */
export function nodeProjectFs(projectDir: string): YarnProjectFileSystem {
  const skip = new Set(SKIP_DIRS);
  const walk = (dir: string, prefix: string, out: string[]): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      // statSync (not the dirent) so symlinks resolve like their target.
      if (!statSync(full).isFile()) {
        if (!skip.has(entry)) walk(full, rel, out);
      } else {
        out.push(rel);
      }
    }
  };
  return {
    listFiles(): string[] {
      const out: string[] = [];
      walk(projectDir, "", out);
      return out.sort();
    },
    read(path: string): string | null {
      try {
        return readFileSync(join(projectDir, path), "utf8");
      } catch {
        return null;
      }
    },
  };
}

/**
 * Load an upstream-style `.yarnproject` from disk and compile it — the
 * Node entry point of the loader. The project directory is the `.yarnproject`
 * file's directory; `sourceFiles`/`excludeFiles` and localisation paths
 * resolve relative to it, exactly as upstream's tools resolve them.
 *
 * `relative()` normalizes to platform separators; the loader's glob layer
 * normalizes both sides to POSIX, so schema-style patterns (a `**` segment
 * over a `*.yarn` leaf) behave identically on Windows.
 */
export function loadYarnProject(
  projectFilePath: string,
  compileOpts: CompileOptions = {},
): LoadProjectResult {
  let project: string;
  try {
    project = readFileSync(projectFilePath, "utf8");
  } catch (e) {
    // §3 collect-don't-throw even at the Node boundary: an unreadable
    // project file is a YP0001 diagnostic, not an exception.
    return failedResult([
      {
        code: "YP0001",
        severity: "error",
        message: `Project file could not be read: ${e instanceof Error ? e.message : String(e)}`,
        file: projectFilePath,
      },
    ]);
  }
  const projectDir = dirname(projectFilePath);
  return loadProject({
    project,
    fileSystem: nodeProjectFs(projectDir),
    projectFile: relative(projectDir, projectFilePath).replace(/\\/g, "/"),
    ...compileOpts,
  });
}
