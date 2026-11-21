import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, NetworkError } from "./api.mjs";

const file = (dir) => join(dir, "pending-status.jsonl");

/** PATCH one status. Offline: queue in DIR/pending-status.jsonl. Returns { queued, result }. */
export async function setStatus({ api, dir, id, status, pr, note, now = new Date() }) {
  const body = { status };
  if (note !== undefined) body.note = note;
  if (pr !== undefined) body.pr_url = pr;
  try {
    return { queued: false, result: await api.patch(id, body) };
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    if (!dir) throw new Error(e.message + ". No batch folder to queue into; pass --dir DIR.");
    appendFileSync(file(dir), JSON.stringify({ id, body, at: now.toISOString() }) + "\n");
    return { queued: true, message: e.message };
  }
}

/** Send queued lines in order. Network failure keeps that line and everything after it; an API error drops the line. */
export async function flushPending(dir, api) {
  const path = file(dir);
  const res = { sent: 0, dropped: [], remaining: 0 };
  if (!existsSync(path)) return res;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const keep = [];
  let offline = false;
  for (const line of lines) {
    if (offline) {
      keep.push(line);
      continue;
    }
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      res.dropped.push({ line, reason: "unreadable line" });
      continue;
    }
    try {
      await api.patch(item.id, item.body);
      res.sent++;
    } catch (e) {
      if (e instanceof NetworkError) {
        offline = true;
        keep.push(line);
      } else if (e instanceof ApiError) {
        res.dropped.push({ id: item.id, reason: `${e.status} ${e.message}` });
      } else throw e;
    }
  }
  writeFileSync(path, keep.map((l) => l + "\n").join(""));
  res.remaining = keep.length;
  return res;
}
