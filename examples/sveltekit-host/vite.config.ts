import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit()],
	css: {
		// No PostCSS config exists for this host; pinning an empty one stops
		// PostCSS from searching up the directory tree (which breaks in
		// sandboxes that deny reads above the repo root — the ticket-52 lesson).
		postcss: { plugins: [] },
	},
});
