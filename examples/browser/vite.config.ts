import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "examples/browser",
  css: {
    // No PostCSS config exists for this demo; pinning an empty one stops
    // PostCSS from searching up the directory tree (which breaks in
    // sandboxes that deny reads above the repo root).
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      "yarn-spinner-runner-ts": path.resolve(__dirname, "../src"),
    },
  },
  build: {
    outDir: "../../dist-demo",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});

