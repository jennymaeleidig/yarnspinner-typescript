// SPDX-License-Identifier: CC0-1.0
// Compile every examples/content/*/*.yarnproject the way the demos consume
// them (one project per story directory) and report diagnostics.
import { readdirSync } from "node:fs";
import { loadYarnProject } from "../dist/compile/nodeProjectFs.js";

const root = "examples/content";
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const r = await loadYarnProject(
    `${root}/${dir.name}/${dir.name}.yarnproject`,
  );
  const errors = r.diagnostics.filter((d) => d.severity === "error");
  console.log(
    `${dir.name}: ${errors.length} errors / ${r.diagnostics.length} diags; ` +
      `nodes: ${Object.keys(r.program?.nodes ?? {}).length}`,
  );
  for (const d of r.diagnostics.slice(0, 8)) {
    console.log(`  ${d.severity} ${d.code ?? ""} ${d.message}`);
  }
}
