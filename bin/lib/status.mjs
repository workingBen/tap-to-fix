import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, NetworkError } from "./api.mjs";

const file = (dir) => join(dir, "pending-status.jsonl");
export const LOG = "status-log.jsonl";

/** Append to DIR/status-log.jsonl: every change sent or queued (never a rejected one). */
function logStatus(dir, entry) {
  if (!dir || !existsSync(dir)) return;
  appendFileSync(join(dir, LOG), JSON.stringify(entry) + "\n");
}

const STATUSES = ["open", "in_progress", "done", "later", "kept"];

/**
 * API errors that can never succeed on retry: the line is moved to rejected-status.jsonl.
 * Everything else (401, 403, 408, 429, 5xx, network) is transient or fixable: the line stays queued.
 */
export const PERMANENT_STATUSES = new Set([400, 404, 409, 422]);
export const isPermanent = (e) => e instanceof ApiError && PERMANENT_STATUSES.has(e.status);

function whyKept(e) {
  if (e instanceof NetworkError) return "network unreachable";
  if (e.status === 401) return "owner token rejected — re-run /tap-to-fix:setup";
  return `service answered ${e.status} (${e.message})`;
}

/** Throws a plain Error before anything is sent or queued. */
export function validateStatus({ status, pr, note }) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status "${status}". Use one of: ${STATUSES.join(", ")}.`);
  if ((status === "later" || status === "kept") && !(note && note.trim())) {
    throw new Error("A note is required for later and kept (use --note TEXT).");
  }
  if (pr !== undefined && !/^https?:\/\/\S+$/i.test(pr)) throw new Error("--pr must be an http(s) URL.");
}

/** PATCH one status. Offline: queue in DIR/pending-status.jsonl. Returns { queued, result }. */
export async function setStatus({ api, dir, id, status, pr, note, now = new Date() }) {
  validateStatus({ status, pr, note });
  const body = { status };
  if (note !== undefined) body.note = note;
  if (pr !== undefined) body.pr_url = pr;
  const at = now.toISOString();
  let result;
  try {
    result = await api.patch(id, body);
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    if (!dir) throw new Error(e.message + ". No batch folder to queue into; pass --dir DIR.");
    appendFileSync(file(dir), JSON.stringify({ id, body, at }) + "\n");
    logStatus(dir, { id, ...body, state: "queued", at });
    return { queued: true, message: e.message };
  }
  logStatus(dir, { id, ...body, state: "sent", at });
  return { queued: false, result };
}

/**
 * Send queued lines in order. A transient failure (see isPermanent) keeps that line and everything after it;
 * a permanent API error moves the line, with the reason, to rejected-status.jsonl.
 */
export async function flushPending(dir, api, now = new Date()) {
  const path = file(dir);
  const res = { sent: 0, dropped: [], remaining: 0, stopped: null };
  if (!existsSync(path)) return res;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const keep = [];
  const reject = (entry) => {
    res.dropped.push(entry);
    appendFileSync(join(dir, "rejected-status.jsonl"), JSON.stringify({ ...entry, rejected_at: now.toISOString() }) + "\n");
  };
  for (const line of lines) {
    if (res.stopped) {
      keep.push(line);
      continue;
    }
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      reject({ line, reason: "unreadable line" });
      continue;
    }
    try {
      await api.patch(item.id, item.body);
      res.sent++;
      logStatus(dir, { id: item.id, ...item.body, state: "sent", at: now.toISOString(), queued_at: item.at });
    } catch (e) {
      if (isPermanent(e)) reject({ id: item.id, line, reason: `${e.status} ${e.message}` });
      else if (e instanceof NetworkError || e instanceof ApiError) {
        res.stopped = whyKept(e);
        keep.push(line);
      } else throw e;
    }
  }
  writeFileSync(path, keep.map((l) => l + "\n").join(""));
  res.remaining = keep.length;
  return res;
}
