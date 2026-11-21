// Static fixture site on :4173 and a no-CORS image host on :4174. Run: node e2e/fixture-server.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("./fixture/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".jpg": "image/jpeg" };
const SITE_PORT = Number(process.env.FIXTURE_PORT ?? 4173);
const IMAGE_PORT = Number(process.env.IMAGE_PORT ?? 4174);

async function send(res, file) {
  try {
    const body = await readFile(join(dir, file));
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

const site = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const file = normalize(path === "/" ? "index.html" : path.slice(1));
  if (file.startsWith("..")) return send(res, "missing");
  return send(res, file);
});

// Deliberately sends no Access-Control-Allow-Origin header.
const images = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  return send(res, path === "/photo.jpg" ? "photo.jpg" : "missing");
});

site.listen(SITE_PORT, () => images.listen(IMAGE_PORT, () => console.log(`fixture on ${SITE_PORT}, images on ${IMAGE_PORT}`)));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
