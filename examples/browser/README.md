# Browser Demo

Interactive browser demos of yarnspinner-typescript, built with Vite. The demo
is the acceptance harness for the package's public surface: if it builds and
runs against the published API (dist/, the package root) through the plugin,
the consumption story works.

The demo is vanilla TypeScript — it constructs `Dialogue` from the package
root, reads `Transcript` raw, and renders text with a light hand-written
mimic of the Try Yarn Spinner site's dark theme (`dialogue.css`). No
framework, no view layer.

## Running the Demos

1. Install dependencies (if not already done):

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run demo
   ```

   This will start a Vite dev server at `http://localhost:3000` and open it in your browser.

3. Build for production:

   ```bash
   npm run demo:build
   ```

   The built files will be in `dist-demo/`.

## The Demos

The entry point (`main.ts`) hosts two tabs:

- **Crossroads** (`crossroadsDemo.ts`) — the crossroads project
  (`../content/crossroads/crossroads.yarnproject`, compiled at build time by
  yarnspinner-vite-plugin) on the pull-based runtime: lines, option
  selection, and a manual continue button over the Try BranchingDialogue
  sample, with a full state log (node, delivered events, stopping point,
  variable snapshot) under the transcript.

- **Calibrations** (`calibrationsDemo.ts`) — the Try Yarn Spinner showcase
  story (`../content/calibrations/calibrations.yarnproject`): markup, enums,
  functions, commands, and a saliency-driven node group, byte for byte from
  `try.yarnspinner.dev/samples/Calibrations.yarn`.

Content loads via direct import — no inline template strings, no manual
compile calls. The build is asserted end-to-end by
`src/tests/browserDemo.test.ts`.

## Customization

Edit the `.yarn` files under `examples/content/*/` to change the stories,
and the demo modules for their presentation.
