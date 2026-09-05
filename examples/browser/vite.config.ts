// SPDX-License-Identifier: CC0-1.0
import { defineConfig } from "vite";
import { yarnSpinnerVitePlugin } from "yarnspinner-vite-plugin";

export default defineConfig({
  plugins: [yarnSpinnerVitePlugin()],
  root: "examples/browser",
  css: {
    // No PostCSS config exists for this demo; pinning an empty one stops
    // PostCSS from searching up the directory tree (which breaks in
    // sandboxes that deny reads above the repo root).
    postcss: { plugins: [] },
  },
  // No source aliasing: the package name resolves through the published
  // surface (dist/, the framework-agnostic root), and content imports
  // compile through the plugin below.
  build: {
    outDir: "../../dist-demo",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
