import adapter from "@sveltejs/adapter-static";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Fully static output: `vite build` prerenders the page, which runs the
    // +page.server.ts load (the YarnProject loader) at build time and bakes
    // the server-rendered dialogue output into the HTML.
    adapter: adapter(),
  },
};

export default config;
