# yarn-spinner-vite-plugin

Import `.yarn` files as compiled Yarn Spinner 3.x programs at build time.

```js
// vite.config.ts
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";

export default {
  plugins: [yarnSpinnerVitePlugin()],
};
```

```ts
import program from "./story.yarn";
import { Dialogue } from "yarn-spinner-runner-ts";

const dialogue = new Dialogue(program, { startAt: "Start" });
```

Compiles at build time via the core compiler; the app bundle ships only the
runtime. Saving a `.yarn` file triggers a full page reload in dev. (Docs are
completed by the implementation effort's docs ticket.)
