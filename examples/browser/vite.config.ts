import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";

export default defineConfig({
  plugins: [react(), yarnSpinnerVitePlugin()],
  root: "examples/browser",
  css: {
    // No PostCSS config exists for this demo; pinning an empty one stops
    // PostCSS from searching up the directory tree (which breaks in
    // sandboxes that deny reads above the repo root).
    postcss: { plugins: [] },
  },
  // No source aliasing: the package name resolves through the published
  // surface (dist/ + the react subpath via the workspace), and content
  // imports compile through the plugin below.
  build: {
    outDir: "../../dist-demo",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
