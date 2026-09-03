// adapter-static: every route is prerendered — `vite build` runs the
// +page.server.ts load (the YarnProject loader) server-side at build time
// and bakes the server-rendered dialogue output into the static HTML.
export const prerender = true;
