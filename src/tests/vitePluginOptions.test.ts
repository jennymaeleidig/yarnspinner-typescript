// SPDX-License-Identifier: CC0-1.0
// The plugin's option surface as implemented: a pinned .yarnproject compiles
// .yarn imports with project context (no upward discovery), definitions feed
// build-time signature checking (.ysls.json-shaped, file or inline),
// compiler-options passthrough reaches the job, severity precedence puts the
// plugin's map over the project file's own, and include/exclude filters
// layer over extension matching.
import { test } from "node:test";
import { ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { yarnSpinnerVitePlugin } from "yarn-spinner-vite-plugin";
import { callHook, importEmitted, viteCtx } from "./pluginHarness.js";

const STORY = `title: Start
---
You found {roll_dice(3)} gold.
===
`;

const plugin = yarnSpinnerVitePlugin();

const YSLS = {
  version: 1,
  commands: [
    { yarnName: "roll_dice", parameters: [{ name: "n", type: "number" }] },
  ],
  functions: [],
};

/** A temp dir with story.yarn (+ optional project + ysls file); returns [dir, cleanup]. */
const fixture = (files: Record<string, string>): [string, () => void] => {
  const dir = mkdtempSync(join(tmpdir(), "yarn-opts-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return [dir, () => rmSync(dir, { recursive: true, force: true })];
};

test("a pinned .yarn import compiles with the project's context", async () => {
  const [dir, cleanup] = fixture({
    "story.yarn": STORY,
    "project.yarnproject": JSON.stringify({
      projectFileVersion: 4,
      projectName: "Pinned",
      sourceFiles: ["**/*.yarn"],
      baseLanguage: "en",
    }),
  });
  try {
    const pinned = yarnSpinnerVitePlugin({
      project: join(dir, "project.yarnproject"),
    });
    const code = await callHook(
      pinned.load,
      viteCtx(),
      join(dir, "story.yarn"),
    );
    const mod = await importEmitted(code as string);
    strictEqual(
      mod.default.baseLanguage,
      "en",
      "project context reached the pinned import",
    );
    strictEqual(mod.default.projectName, "Pinned");

    // Unpinned imports remain standalone: the same .yarn, no project option —
    // no upward discovery, just the bare Program.
    const standalone = await callHook(
      plugin.load,
      viteCtx(),
      join(dir, "story.yarn"),
    );
    const bare = await importEmitted(standalone as string);
    ok(!("baseLanguage" in bare.default), "standalone import stays bare");
  } finally {
    cleanup();
  }
});

test("inline-object definitions reach the compilation job", async () => {
  const [dir, cleanup] = fixture({ "story.yarn": STORY });
  try {
    const declared = yarnSpinnerVitePlugin({
      definitions: [YSLS],
    });
    const good = await callHook(
      declared.load,
      viteCtx(),
      join(dir, "story.yarn"),
    );
    ok(
      typeof good === "string",
      "a declared function passes signature checking",
    );

    const badStory = fixture({
      "story.yarn": STORY.replace("roll_dice(3)", 'roll_dice("high")'),
    })[0];
    try {
      const err = (await (
        callHook(
          declared.load,
          viteCtx(),
          join(badStory, "story.yarn"),
        ) as Promise<unknown>
      ).then(
        () => null,
        (e: { message?: string } | undefined) => e,
      )) as { message?: string } | null;
      ok(
        err && /YS0050|YS0014/.test(err.message ?? ""),
        `the expected diagnostic fails the build: ${JSON.stringify(err)}`,
      );
    } finally {
      rmSync(badStory, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
});

test(".ysls.json file definitions behave identically to inline objects", async () => {
  const [dir, cleanup] = fixture({
    "story.yarn": STORY,
    "Commands.ysls.json": JSON.stringify(YSLS),
  });
  try {
    const fromFile = yarnSpinnerVitePlugin({
      definitions: [join(dir, "Commands.ysls.json")],
    });
    const good = await callHook(
      fromFile.load,
      viteCtx(),
      join(dir, "story.yarn"),
    );
    ok(
      typeof good === "string",
      "file definitions pass signature checking like inline ones",
    );
  } finally {
    cleanup();
  }
});

test("a malformed .ysls.json fails plugin creation naming the file, not a raw SyntaxError", () => {
  const [dir, cleanup] = fixture({ "Commands.ysls.json": "{ not json" });
  try {
    throws(
      () =>
        yarnSpinnerVitePlugin({
          definitions: [join(dir, "Commands.ysls.json")],
        }),
      /Commands\.ysls\.json/,
      "the error identifies the definitions file",
    );
  } finally {
    cleanup();
  }
});

test("an unreadable pinned project fails the load naming the file", async () => {
  const [dir, cleanup] = fixture({ "story.yarn": STORY });
  try {
    const pinned = yarnSpinnerVitePlugin({
      project: join(dir, "missing.yarnproject"),
    });
    const err = (await (
      callHook(
        pinned.load,
        viteCtx(),
        join(dir, "story.yarn"),
      ) as Promise<unknown>
    ).then(
      () => null,
      (e: { message?: string } | undefined) => e,
    )) as { message?: string } | null;
    ok(
      err && (err.message ?? "").includes("missing.yarnproject"),
      `error names the file, got ${JSON.stringify(err)}`,
    );
  } finally {
    cleanup();
  }
});

test("include/exclude filters layer over extension matching", async () => {
  const [dir, cleanup] = fixture({
    "story.yarn": STORY,
    "vendor/other.yarn": STORY,
  });
  try {
    const onlySrc = yarnSpinnerVitePlugin({ include: ["src/**"] });
    strictEqual(
      await callHook(onlySrc.load, viteCtx(), join(dir, "story.yarn")),
      undefined,
      "outside include: not loaded",
    );
    const notVendor = yarnSpinnerVitePlugin({ exclude: ["vendor/**"] });
    ok(
      typeof (await callHook(
        notVendor.load,
        viteCtx(),
        join(dir, "story.yarn"),
      )) === "string",
    );
    strictEqual(
      await callHook(
        notVendor.load,
        viteCtx(),
        join(dir, "vendor", "other.yarn"),
      ),
      undefined,
      "excluded: not loaded",
    );
    // Extension matching still gates everything: non-.yarn files never load.
    strictEqual(
      await callHook(notVendor.load, viteCtx(), join(dir, "notes.txt")),
      undefined,
    );
  } finally {
    cleanup();
  }
});

test("compiler-options passthrough reaches the compilation job", async () => {
  const [dir, cleanup] = fixture({ "broken.yarn": "title: Start\n===\n" });
  try {
    const downgraded = yarnSpinnerVitePlugin({
      compilerOptions: { diagnosticsSeverity: { YS0004: "warning" } },
    });
    const warnings: unknown[] = [];
    const code = await callHook(
      downgraded.load,
      { warn: (m: unknown) => warnings.push(m) },
      join(dir, "broken.yarn"),
    );
    ok(
      typeof code === "string",
      "the override reaches the job without a project",
    );
    ok(warnings.some((w) => String(w).includes("YS0004")));
  } finally {
    cleanup();
  }
});

test("severity precedence: the plugin's map wins over the project file's own", async () => {
  // The project downgrades the empty-node error to a warning; the plugin's
  // maps layer back over it — top-level and compilerOptions passthrough — so
  // the load fails. Precedence: project file < top-level < compilerOptions.
  const project = {
    projectFileVersion: 4,
    projectName: "Severity",
    sourceFiles: ["broken.yarn"],
    baseLanguage: "en",
    compilerOptions: { diagnosticsSeverity: { YS0004: "warning" } },
  };
  {
    const [dir, cleanup] = fixture({
      "broken.yarn": "title: Start\n===\n",
      "project.yarnproject": JSON.stringify(project),
    });
    const err = await (
      callHook(
        yarnSpinnerVitePlugin().load,
        viteCtx(),
        join(dir, "project.yarnproject"),
      ) as Promise<unknown>
    ).then(
      () => null,
      (e: unknown) => e,
    );
    cleanup();
    ok(err === null, `project's own map downgrades on its own: ${err}`);
  }
  {
    const [dir, cleanup] = fixture({
      "broken.yarn": "title: Start\n===\n",
      "project.yarnproject": JSON.stringify(project),
    });
    for (const opts of [
      { diagnosticsSeverity: { YS0004: "error" } },
      { compilerOptions: { diagnosticsSeverity: { YS0004: "error" } } },
    ] as const) {
      const e = await (
        callHook(
          yarnSpinnerVitePlugin(opts).load,
          viteCtx(),
          join(dir, "project.yarnproject"),
        ) as Promise<unknown>
      ).then(
        () => null,
        (e: unknown) => e,
      );
      ok(
        e && String((e as { message?: string }).message).includes("YS0004"),
        `plugin's map wins: ${e}`,
      );
    }
    cleanup();
  }
});
