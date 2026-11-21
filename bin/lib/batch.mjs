import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { slug } from "./reviewers.mjs";

const EXT = { "image/webp": "webp", "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png" };

export function extFor(type) {
  return EXT[String(type ?? "").split(";")[0].trim().toLowerCase()] ?? "png";
}

export function stamp(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

export function defaultDir(cwd, batch, now) {
  return join(cwd, ".tap-to-fix", `${batch.site.slug}-${slug(batch.reviewer.name)}-${stamp(now)}`);
}

/** The most recently written batch dir under cwd/.tap-to-fix, or null. */
export function newestBatchDir(cwd) {
  const root = join(cwd, ".tap-to-fix");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .map((n) => join(root, n))
    .filter((d) => existsSync(join(d, "batch.json")))
    .map((d) => ({ d, t: statSync(join(d, "batch.json")).mtimeMs }))
    .sort((a, b) => a.t - b.t || (a.d < b.d ? -1 : 1));
  return dirs.length ? dirs[dirs.length - 1].d : null;
}

/**
 * Write DIR/batch.json, DIR/shots/<id>.<ext> and DIR/queue.md.
 * shots: { [commentId]: { bytes: Uint8Array, type } } (absent = missing).
 * Returns the batch as written (comments carry screenshot_path or screenshot: "missing").
 */
export function writeBatch(dir, batch, shots) {
  const abs = resolve(dir);
  mkdirSync(join(abs, "shots"), { recursive: true });
  const { screenshots: _drop, ...rest } = batch;
  const comments = rest.comments.map((c) => {
    const { screenshot_path: _p, screenshot: _s, ...base } = c;
    const shot = shots[c.id];
    if (!shot) return { ...base, screenshot: "missing" };
    const rel = `shots/${c.id}.${extFor(shot.type)}`;
    writeFileSync(join(abs, rel), shot.bytes);
    return { ...base, screenshot_path: rel };
  });
  const out = { ...rest, comments };
  writeFileSync(join(abs, "batch.json"), JSON.stringify(out, null, 2) + "\n");
  writeFileSync(join(abs, "queue.md"), queueMarkdown(out, abs));
  return out;
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function queueMarkdown(batch, dir) {
  const abs = resolve(dir);
  const lines = [`# Fix queue: ${batch.reviewer.name} on ${batch.site.name}`, ""];
  batch.comments.forEach((c, i) => {
    const q = String(c.body ?? "").split("\n").map((l) => "   > " + l).join("\n");
    const shot = c.screenshot_path ? join(abs, c.screenshot_path) : "missing";
    const viewport = c.viewport_w && c.viewport_h ? `${c.viewport_w}x${c.viewport_h}` : "unknown viewport";
    lines.push(
      `${i + 1}. ${oneLine(c.page.title) || c.page.path} — ${c.page.url}`,
      q,
      `   - Element text: ${oneLine(c.element_text) || "(none)"}`,
      `   - Selector: ${oneLine(c.selector) || "(none)"}`,
      `   - Device: ${oneLine(c.device) || "unknown"}, ${viewport}`,
      `   - Screenshot: ${shot}`,
      `   - Comment id: ${c.id}`,
      "",
    );
  });
  return lines.join("\n");
}

/** Reads an offline batch file (plan 1 batch + screenshots map) into { batch, shots }. */
export function readBatchFile(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!raw || !raw.reviewer || !raw.site || !Array.isArray(raw.comments)) {
    throw new Error("Not a tap-to-fix batch file: " + file);
  }
  const shots = {};
  for (const [id, s] of Object.entries(raw.screenshots ?? {})) {
    if (s && typeof s.base64 === "string") shots[id] = { bytes: Buffer.from(s.base64, "base64"), type: s.type };
  }
  return { batch: raw, shots };
}
