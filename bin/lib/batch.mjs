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

/**
 * Where batch folders live: TTF_HOME/batches when set, else ~/.tap-to-fix/batches.
 * Outside any checkout, so a batch is never committed and every worktree finds it.
 */
export function batchRoot({ env = {}, home }) {
  return env.TTF_HOME ? join(resolve(env.TTF_HOME), "batches") : join(home, ".tap-to-fix", "batches");
}

export function defaultDir(root, batch, now) {
  return join(root, `${batch.site.slug}-${slug(batch.reviewer.name)}-${stamp(now)}`);
}

/** Every batch dir directly under root (see batchRoot), oldest first. */
export function batchDirs(root) {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root)
    .map((n) => join(root, n))
    .filter((d) => existsSync(join(d, "batch.json")))
    .map((d) => ({ d, t: statSync(join(d, "batch.json")).mtimeMs }))
    .sort((a, b) => a.t - b.t || (a.d < b.d ? -1 : 1))
    .map((x) => x.d);
}

/** The most recently written batch dir under root, or null. */
export function newestBatchDir(root) {
  const dirs = batchDirs(root);
  return dirs.length ? dirs[dirs.length - 1] : null;
}

/** The newest batch dir whose batch.json contains this comment id; else the newest dir. */
export function dirForComment(root, id) {
  const dirs = batchDirs(root);
  for (let i = dirs.length - 1; i >= 0; i--) {
    try {
      const b = JSON.parse(readFileSync(join(dirs[i], "batch.json"), "utf8"));
      if (b.comments?.some((c) => c.id === id)) return dirs[i];
    } catch {
      // unreadable batch.json: skip
    }
  }
  return dirs.length ? dirs[dirs.length - 1] : null;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Write DIR/batch.json, DIR/shots/<id>.<ext> and DIR/queue.md.
 * shots: { [commentId]: { bytes: Uint8Array, type } } (absent = missing).
 * Returns the batch as written (comments carry screenshot_path or screenshot: "missing").
 */
export function writeBatch(dir, batch, shots) {
  const abs = resolve(dir);
  mkdirSync(join(abs, "shots"), { recursive: true });
  const { screenshots: _drop, ...rest } = batch;
  for (const c of rest.comments) {
    if (!SAFE_ID.test(String(c.id))) throw new Error("Unsafe comment id in batch: " + JSON.stringify(String(c.id).slice(0, 40)));
  }
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
      `${i + 1}. [ttf ${c.id}] ${oneLine(c.page.title) || c.page.path} — ${c.page.url}`,
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
