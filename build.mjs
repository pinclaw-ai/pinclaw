import { build } from "esbuild";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Collect all .ts entry points (non-bundled, file-by-file transpile)
function collectTs(dir, base = "") {
  const entries = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const rel = base ? `${base}/${f}` : f;
    if (statSync(full).isDirectory()) {
      if (f === "node_modules" || f === "dist" || f === "test" || f === "acp")
        continue;
      entries.push(...collectTs(full, rel));
    } else if (
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".d.ts")
    ) {
      entries.push(rel);
    }
  }
  return entries;
}

const entryPoints = ["index.ts", ...collectTs("src").map((f) => `src/${f}`)];

await build({
  entryPoints,
  bundle: false,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist",
  sourcemap: true,
});
