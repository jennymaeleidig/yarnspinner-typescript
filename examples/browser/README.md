# Browser Demo

Interactive browser demos of yarn-spinner-runner-ts, built with Vite. The demo
is the acceptance harness for the React adapter: if it builds and runs against
the package's public API, the adapter works.

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

The entry point (`main.tsx`) hosts two tabs:

- **Dialogue** (`src/react/DialogueExample.tsx` from the package) — the
  visual-novel dialogue view over the pull-based runtime: click-to-continue
  lines, option selection, speaker names, scenes, and markup rendering.

- **Storylets** (`StoryletsDemo.tsx`) — a node-group/saliency demo: six
  storylets (one node group, each member gated by a `when:` header of varying
  complexity) drawn repeatedly under a switchable saliency strategy. Exercises
  `Dialogue.setSaliencyStrategy`, `getSaliencyOptionsForNodeGroup`,
  `hasSalientContent`, and the storage-backed view-count history (Reset
  clears it) through the public `Dialogue` API. The story's draw sequence per
  strategy is pinned by `src/tests/dialogue_view.test.tsx`.

## Customization

Edit `src/react/DialogueExample.tsx` to change the default Yarn script or
customize the dialogue UI.

Edit `src/react/DialogueView.tsx` to change the dialogue box styling and
behavior.

Edit `StoryletsDemo.tsx` to add storylets or change the strategy set.
