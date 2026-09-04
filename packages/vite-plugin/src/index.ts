// SPDX-License-Identifier: CC0-1.0
// The Vite plugin surface. Real-file ids are compiled in place (the mdx/svelte
// precedent) — no virtual modules, hence no resolveId: Vite hands the plugin
// the on-disk id and load answers it. Query-carrying ids bail so Vite core
// keeps ?raw/?url/?inline (formalized in ticket 03). Content edits to .yarn —
// and, once ticket 04 makes them modules, .yarnproject — full-reload in dev:
// a rebuilt Program means a rebuilt Dialogue, and variable storage resets
// regardless (map decision, ticket 03 of the wayfinder effort).

import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { compileYarnToModule } from "./compileModule.js";

const YARN_FILE = /\.yarn$/;
const CONTENT_FILE = /\.yarn(project)?$/;

export function yarnSpinnerVitePlugin(): Plugin {
  return {
    name: "yarn-spinner-vite-plugin",
    enforce: "pre",
    async load(id) {
      if (id.includes("?") || !YARN_FILE.test(id)) return;
      const source = await readFile(id, "utf8");
      return compileYarnToModule(source, id);
    },
    handleHotUpdate(ctx) {
      if (!CONTENT_FILE.test(ctx.file)) return;
      ctx.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
