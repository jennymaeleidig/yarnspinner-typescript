// SPDX-License-Identifier: CC0-1.0
// The browser demo as acceptance harness: the demo builds
// end-to-end through the real plugin — package name resolved through the
// published surface (no source aliasing), shared content compiled by the
// plugin's direct-import contract — and the built bundle proves it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEMO_CONFIG = join(ROOT, "examples", "browser", "vite.config.ts");
const DIST_DEMO = join(ROOT, "dist-demo");

test("the browser demo builds end-to-end through the real plugin", () => {
  // The published-surface build: `vite build` with the demo's config — the
  // same command `npm run demo:build` runs. Plugin-compiled content and the
  // package's dist both flow through one bundle.
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--config",
      DEMO_CONFIG,
    ],
    {
      cwd: ROOT,
      stdio: "pipe",
    },
  );
  assert.ok(
    existsSync(join(DIST_DEMO, "index.html")),
    "the build produced index.html",
  );
  const assets = readdirSync(join(DIST_DEMO, "assets"));
  const bundle = assets.find((f) => f.endsWith(".js"));
  assert.ok(bundle, "the build produced a JS bundle");
  const js = readFileSync(join(DIST_DEMO, "assets", bundle), "utf8");

  // The dialogue runs the shared content: the compiled program (a runLine
  // instruction from the crossroads opening) is baked into the bundle —
  // proof the plugin's direct-import contract produced it.
  assert.ok(js.includes("runLine"), "a compiled program rides the bundle");
  assert.ok(
    js.includes("mysterious traveler") && js.includes("Calibrations"),
    "shared-content text is baked in (compiled at build time, not fetched)",
  );

  // No source aliasing: the bundle was built from dist, not src — a src-path
  // import would leave the alias's literal path or compile-time src markers.
  assert.ok(
    !js.includes("examples/src"),
    "no src tree references leak into the bundle",
  );
});
