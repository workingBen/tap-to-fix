// Bundles the browser code into public/. Run: node scripts/build-client.mjs [--watch]
import { context, build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const common = { absWorkingDir: root, bundle: true, minify: true, target: "es2020", logLevel: "info" };
const targets = [
  { ...common, entryPoints: ["client/loader-entry.ts"], outfile: "public/t.js", format: "iife" },
  { ...common, entryPoints: ["client/overlay/index.ts"], outfile: "public/overlay.js", format: "esm" },
];

// Cross-origin import() of overlay.js needs CORS; Workers assets honor public/_headers.
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public", "_headers"), "/*.js\n  Access-Control-Allow-Origin: *\n");

if (process.argv.includes("--watch")) {
  for (const t of targets) await (await context(t)).watch();
} else {
  await Promise.all(targets.map((t) => build(t)));
}
