// Bundles the browser code into public/. Run: node scripts/build-client.mjs [--watch]
import { context, build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const common = { absWorkingDir: root, bundle: true, minify: true, target: "es2020", logLevel: "info" };
const targets = [
  { ...common, entryPoints: ["client/loader-entry.ts"], outfile: "public/t.js", format: "iife" },
  { ...common, entryPoints: ["client/overlay/index.ts"], outfile: "public/overlay.js", format: "esm" },
  { ...common, entryPoints: ["client/dash/reviewer.ts"], outfile: "public/r/app.js", format: "esm" },
  { ...common, entryPoints: ["client/dash/owner.ts"], outfile: "public/o/app.js", format: "esm" },
];

// Cross-origin import() of overlay.js needs CORS; Workers assets honor public/_headers.
mkdirSync(join(root, "public"), { recursive: true });
mkdirSync(join(root, "public", "r"), { recursive: true });
mkdirSync(join(root, "public", "o"), { recursive: true });
// Link previews (iMessage, Slack) want an absolute image URL. deploy.mjs passes the saved service
// URL; a plain https origin is the only thing accepted, else the path stays relative.
const origin = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(process.env.TTF_PUBLIC_URL ?? "") ? process.env.TTF_PUBLIC_URL : "";
const reviewerPage = readFileSync(join(root, "client/pages/r.html"), "utf8").replace("__OG_IMAGE__", `${origin}/r/og.jpg`);
writeFileSync(join(root, "public/r/index.html"), reviewerPage);
copyFileSync(join(root, "client/pages/og.jpg"), join(root, "public/r/og.jpg"));
copyFileSync(join(root, "client/pages/o.html"), join(root, "public/o/index.html"));
writeFileSync(
  join(root, "public", "_headers"),
  "/*\n  Referrer-Policy: no-referrer\n/*.js\n  Access-Control-Allow-Origin: *\n",
);

if (process.argv.includes("--watch")) {
  for (const t of targets) await (await context(t)).watch();
} else {
  await Promise.all(targets.map((t) => build(t)));
}
