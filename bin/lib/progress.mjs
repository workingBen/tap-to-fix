import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { batchDirs } from "./batch.mjs";
import { resolveReviewer } from "./reviewers.mjs";
import { LOG } from "./status.mjs";

export const FINAL = new Set(["done", "later", "kept"]);

const readJsonl = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
    : [];

function readBatch(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * The newest batch folder under root for this reviewer + site, and each comment's last known status:
 * the last status sent, or queued and still waiting in pending-status.jsonl (a rejected change does not count).
 * Throws AmbiguousReviewer / UnknownReviewer like the online commands; a plain Error when no folder matches.
 */
export function progress(root, reviewerArg, siteSlug) {
  const found = batchDirs(root)
    .map((dir) => ({ dir, batch: readBatch(dir) }))
    .filter((x) => x.batch?.site?.slug === siteSlug && x.batch?.reviewer?.id && Array.isArray(x.batch.comments));
  if (!found.length) throw new Error(`No batch folder for site "${siteSlug}" under ${root}. Run ttf batch first.`);
  const reviewers = [...new Map(found.map((x) => [x.batch.reviewer.id, x.batch.reviewer])).values()];
  const reviewer = resolveReviewer(reviewers, reviewerArg);
  const { dir, batch } = found.filter((x) => x.batch.reviewer.id === reviewer.id).at(-1);

  const pending = new Set(readJsonl(join(dir, "pending-status.jsonl")).map((p) => `${p.id}@${p.at}`));
  const last = new Map();
  for (const e of readJsonl(join(dir, LOG))) {
    if (e.state === "queued" && !pending.has(`${e.id}@${e.at}`)) continue;
    last.set(e.id, e);
  }
  const items = batch.comments.map((c) => {
    const e = last.get(c.id);
    const status = e?.status ?? c.status ?? "open";
    return {
      id: c.id,
      status,
      final: FINAL.has(status),
      queued: e?.state === "queued",
      note: e?.note,
      pr: e?.pr_url,
      page: c.page?.path ?? c.page?.url ?? "",
      body: String(c.body ?? "").replace(/\s+/g, " ").trim(),
    };
  });
  return { dir, queue: join(dir, "queue.md"), reviewer, site: batch.site, items };
}
