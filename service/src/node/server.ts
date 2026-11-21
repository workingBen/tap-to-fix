// Local dev server on Node (workerd cannot run on older macOS). Not bundled into the Worker.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import app from "../index";
import type { Env } from "../env";
import { createD1 } from "./d1-sqlite";
import { createR2 } from "./r2-memory";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function ownerToken(): string {
  // An explicit environment variable wins (the e2e harness relies on this), then .dev.vars.
  if (process.env.OWNER_TOKEN) return process.env.OWNER_TOKEN;
  const varsFile = join(root, ".dev.vars");
  if (existsSync(varsFile)) {
    for (const line of readFileSync(varsFile, "utf8").split("\n")) {
      const m = line.match(/^\s*OWNER_TOKEN\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return "";
}

const token = ownerToken();
if (!token) {
  console.error("OWNER_TOKEN is not set. Put OWNER_TOKEN=... in service/.dev.vars or the environment.");
  process.exit(1);
}

// TTF_DB_PATH lets the e2e harness use a throwaway database; the default is unchanged.
const dbPath = process.env.TTF_DB_PATH || join(root, ".local", "dev.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
const db = createD1(dbPath);

await db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
const applied = new Set(
  (await db.prepare("SELECT name FROM _migrations").all<{ name: string }>()).results.map((r) => r.name),
);
const dir = join(root, "migrations");
for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(name)) continue;
  await db.exec(readFileSync(join(dir, name), "utf8"));
  await db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").bind(name, new Date().toISOString()).run();
  console.log("applied migration", name);
}

const env: Env = { DB: db, SHOTS: createR2(), OWNER_TOKEN: token };
const port = Number(process.env.PORT ?? 8787);
// Static client files (public/t.js, public/overlay.js) first, then the API app.
const outer = new Hono();
outer.use("/*.js", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", "*");
});
outer.use("*", serveStatic({ root: "./public" }));
outer.all("*", (c) => app.fetch(c.req.raw, env));
serve({ fetch: outer.fetch, port }, () => {
  console.log(`tap-to-fix service listening on http://localhost:${port}`);
});
