import { Hono } from "hono";
import type { Context } from "hono";
import { requireOwner, type AppBindings } from "../auth";
import { hashToken, newId, newToken } from "../ids";
import { batchFileLimits } from "../limits";
import { slug } from "../../client/dash/names";
import { assignmentStatus, isSettled, type Status } from "../rollup";

const owner = new Hono<AppBindings>();
owner.use("*", requireOwner);

type Json = Record<string, unknown>;

async function readBody(c: Context<AppBindings>): Promise<Json | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Json) : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** A bare origin: https://host[:port], or http://localhost[:port] for development. */
function validOrigin(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.origin !== value) return false;
  return u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost");
}

owner.post("/sites", async (c) => {
  const body = await readBody(c);
  const slug = str(body?.slug);
  const name = str(body?.name);
  const origin = str(body?.origin);
  const repo = str(body?.repo);
  if (!slug || !name || !origin || !repo) {
    return c.json({ error: "slug, name, origin and repo are required" }, 400);
  }
  if (!validOrigin(origin)) {
    return c.json({ error: "origin must be an https:// origin" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT slug FROM sites WHERE slug = ?")
    .bind(slug)
    .first();
  if (existing) return c.json({ error: "Site slug already exists" }, 409);
  const created_at = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO sites (slug, name, origin, repo, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(slug, name, origin, repo, created_at)
    .run();
  return c.json({ slug, name, origin, repo, created_at }, 201);
});

owner.get("/sites", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT slug, name, origin, repo, created_at FROM sites ORDER BY created_at, slug",
  ).all();
  return c.json(results);
});

owner.post("/reviewers", async (c) => {
  const body = await readBody(c);
  const name = str(body?.name);
  if (!name) return c.json({ error: "name is required" }, 400);
  const id = newId();
  const token = newToken();
  await c.env.DB.prepare(
    "INSERT INTO reviewers (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, name, await hashToken(token), new Date().toISOString())
    .run();
  return c.json({ id, name, token }, 201);
});

// Reissue replaces the stored hash, so the old token stops matching at once.
// It also clears revoked_at: issuing a fresh link restores access.
owner.post("/reviewers/:id/reissue", async (c) => {
  const row = await c.env.DB.prepare("SELECT id, name FROM reviewers WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: string; name: string }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const token = newToken();
  await c.env.DB.prepare("UPDATE reviewers SET token_hash = ?, revoked_at = NULL WHERE id = ?")
    .bind(await hashToken(token), row.id)
    .run();
  return c.json({ id: row.id, name: row.name, token });
});

owner.post("/reviewers/:id/revoke", async (c) => {
  const res = await c.env.DB.prepare(
    "UPDATE reviewers SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?",
  )
    .bind(new Date().toISOString(), c.req.param("id"))
    .run();
  if (!res.meta.changes) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});

owner.post("/assignments", async (c) => {
  const body = await readBody(c);
  const site = str(body?.site);
  const reviewerId = str(body?.reviewer_id);
  const path = str(body?.path);
  const title = str(body?.title);
  if (!site || !reviewerId || !path || !title) {
    return c.json({ error: "site, reviewer_id, path and title are required" }, 400);
  }
  if (!path.startsWith("/")) return c.json({ error: "path must start with /" }, 400);
  if (/[?#]/.test(path)) return c.json({ error: "path must not contain ? or #" }, 400);
  const siteRow = await c.env.DB.prepare("SELECT slug FROM sites WHERE slug = ?").bind(site).first();
  const reviewerRow = await c.env.DB.prepare("SELECT id FROM reviewers WHERE id = ?").bind(reviewerId).first();
  if (!siteRow || !reviewerRow) return c.json({ error: "Not found" }, 404);

  const cols = "id, site_slug, reviewer_id, path, title, last_opened_at, created_at";
  const shape = (r: Record<string, unknown>) => ({
    id: r.id, site: r.site_slug, reviewer_id: r.reviewer_id, path: r.path, title: r.title,
    last_opened_at: r.last_opened_at, created_at: r.created_at,
  });
  const existing = await c.env.DB.prepare(
    `SELECT ${cols} FROM assignments WHERE site_slug = ? AND reviewer_id = ? AND path = ?`,
  )
    .bind(site, reviewerId, path)
    .first<Record<string, unknown>>();
  if (existing) return c.json(shape(existing), 200);

  const id = newId();
  const created_at = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO assignments (id, site_slug, reviewer_id, path, title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, site, reviewerId, path, title, created_at)
    .run();
  return c.json({ id, site, reviewer_id: reviewerId, path, title, last_opened_at: null, created_at }, 201);
});

owner.delete("/assignments/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id FROM assignments WHERE id = ?").bind(id).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT screenshot_key FROM comments WHERE assignment_id = ? AND screenshot_key IS NOT NULL",
  )
    .bind(id)
    .all<{ screenshot_key: string }>();
  // No ON DELETE CASCADE in the schema: comments go first, in the same batch.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM comments WHERE assignment_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM assignments WHERE id = ?").bind(id),
  ]);
  const keys = results.map((r) => r.screenshot_key);
  if (keys.length) await c.env.SHOTS.delete(keys);
  return c.body(null, 204);
});

owner.get("/overview", async (c) => {
  const reviewerRows = await c.env.DB.prepare(
    "SELECT id, name, revoked_at FROM reviewers ORDER BY created_at, id",
  ).all<{ id: string; name: string; revoked_at: string | null }>();
  const assignmentRows = await c.env.DB.prepare(
    "SELECT id, site_slug, reviewer_id, path, title, created_at FROM assignments ORDER BY created_at DESC, id DESC",
  ).all<{ id: string; site_slug: string; reviewer_id: string; path: string; title: string; created_at: string }>();
  const commentRows = await c.env.DB.prepare(
    "SELECT assignment_id, status, pr_url FROM comments ORDER BY created_at, id",
  ).all<{ assignment_id: string; status: Status; pr_url: string | null }>();

  const byAssignment = new Map<string, { status: Status; pr_url: string | null }[]>();
  for (const cm of commentRows.results) {
    const list = byAssignment.get(cm.assignment_id) ?? [];
    list.push(cm);
    byAssignment.set(cm.assignment_id, list);
  }
  const reviewerName = new Map(reviewerRows.results.map((r) => [r.id, r.name]));
  const readyByReviewer = new Map<string, number>();
  const unsettledByReviewer = new Map<string, number>();

  const assignments = assignmentRows.results.map((a) => {
    const comments = byAssignment.get(a.id) ?? [];
    const statuses = comments.map((x) => x.status);
    const open = statuses.filter((s) => s === "open").length;
    readyByReviewer.set(a.reviewer_id, (readyByReviewer.get(a.reviewer_id) ?? 0) + open);
    const unsettled = statuses.length - statuses.filter(isSettled).length;
    unsettledByReviewer.set(a.reviewer_id, (unsettledByReviewer.get(a.reviewer_id) ?? 0) + unsettled);
    const pr_urls = [...new Set(comments.map((x) => x.pr_url).filter((u): u is string => !!u))];
    return {
      id: a.id,
      site: a.site_slug,
      path: a.path,
      title: a.title,
      created_at: a.created_at,
      reviewer: { id: a.reviewer_id, name: reviewerName.get(a.reviewer_id) ?? "" },
      status: assignmentStatus(statuses),
      counts: {
        open,
        in_progress: statuses.filter((s) => s === "in_progress").length,
        settled: statuses.filter(isSettled).length,
      },
      pr_urls,
    };
  });

  const reviewers = reviewerRows.results.map((r) => {
    const ready = readyByReviewer.get(r.id) ?? 0; // unsettled_count counts unsettled (open + in progress); ready_count only open
    return { id: r.id, name: r.name, revoked: r.revoked_at !== null, unsettled_count: unsettledByReviewer.get(r.id) ?? 0, ready_count: ready };
  });
  return c.json({ reviewers, assignments });
});

/** Base64 without Node's Buffer (not in Workers): btoa over chunks of the binary string. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x2000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000) as unknown as number[]);
  }
  return btoa(out);
}

const STATUSES: readonly Status[] = ["open", "in_progress", "done", "later", "kept"];

owner.get("/batch", async (c) => {
  const reviewerId = str(c.req.query("reviewer"));
  const siteSlug = str(c.req.query("site"));
  if (!reviewerId || !siteSlug) return c.json({ error: "reviewer and site are required" }, 400);
  const reviewer = await c.env.DB.prepare("SELECT id, name FROM reviewers WHERE id = ?")
    .bind(reviewerId)
    .first<{ id: string; name: string }>();
  const site = await c.env.DB.prepare("SELECT slug, name, origin, repo FROM sites WHERE slug = ?")
    .bind(siteSlug)
    .first<{ slug: string; name: string; origin: string; repo: string }>();
  if (!reviewer || !site) return c.json({ error: "Not found" }, 404);

  const statusParam = c.req.query("status");
  const wanted = statusParam === undefined ? ["open"] : statusParam.split(",").map((s) => s.trim());
  if (!wanted.every((s): s is Status => STATUSES.includes(s as Status))) {
    return c.json({ error: "Unknown status" }, 400);
  }
  const placeholders = wanted.map(() => "?").join(", ");

  const { results } = await c.env.DB.prepare(
    `SELECT c.id, a.path, a.title, c.body, c.status, c.selector, c.element_text, c.element_x, c.element_y,
            c.page_x, c.page_y, c.viewport_w, c.viewport_h, c.device,
            c.screenshot_key, c.screenshot_key IS NOT NULL AS has_screenshot, c.created_at
       FROM comments c JOIN assignments a ON a.id = c.assignment_id
      WHERE a.reviewer_id = ? AND a.site_slug = ? AND c.status IN (${placeholders})
      ORDER BY c.created_at, c.id`,
  )
    .bind(reviewer.id, site.slug, ...wanted)
    .all<Record<string, unknown>>();

  const batch = {
    reviewer,
    site,
    comments: results.map((r) => ({
      id: r.id,
      page: { path: r.path, title: r.title, url: site.origin + String(r.path) },
      body: r.body,
      status: r.status,
      selector: r.selector,
      element_text: r.element_text,
      element_x: r.element_x,
      element_y: r.element_y,
      page_x: r.page_x,
      page_y: r.page_y,
      viewport_w: r.viewport_w,
      viewport_h: r.viewport_h,
      device: r.device,
      has_screenshot: Boolean(r.has_screenshot),
      created_at: r.created_at,
    })),
  };
  if (c.req.query("format") !== "file") return c.json(batch);

  // Offline file for `ttf batch --from`: the batch plus screenshots as base64 while both limits hold.
  // Past a limit every comment stays in the file, marked screenshot_omitted (never lose a comment).
  const screenshots: Record<string, { type: string; base64: string }> = {};
  const omitted = new Set<string>();
  let embedded = 0;
  let bytes = 0;
  let full = false;
  for (const r of results) {
    if (typeof r.screenshot_key !== "string") continue;
    const id = String(r.id);
    if (full || embedded >= batchFileLimits.maxShots) {
      full = true;
      omitted.add(id);
      continue;
    }
    const obj = await c.env.SHOTS.get(r.screenshot_key);
    if (!obj) continue; // gone from R2: the CLI marks it missing
    if (bytes + obj.size > batchFileLimits.maxBytes) {
      full = true;
      omitted.add(id);
      continue;
    }
    bytes += obj.size;
    embedded++;
    screenshots[id] = {
      type: obj.httpMetadata?.contentType ?? "image/png",
      base64: toBase64(new Uint8Array(await obj.arrayBuffer())),
    };
  }
  const file = {
    ...batch,
    comments: batch.comments.map((cm) => (omitted.has(String(cm.id)) ? { ...cm, screenshot_omitted: "file size limit" } : cm)),
    ...(omitted.size ? { screenshots_omitted: omitted.size } : {}),
    screenshots,
  };
  const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, "-");
  const filename = `tap-to-fix-${safe(site.slug)}-${slug(reviewer.name) || "reviewer"}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`;
  return new Response(JSON.stringify(file), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

owner.patch("/comments/:id", async (c) => {
  const body = await readBody(c);
  const status = str(body?.status) as Status | null;
  if (!status || !STATUSES.includes(status)) return c.json({ error: "Unknown status" }, 400);
  const note = str(body?.note);
  const prUrl = str(body?.pr_url);
  const clearPrUrl = body !== null && body.pr_url === null;
  if ((status === "later" || status === "kept") && !note) {
    return c.json({ error: "A note is required for later and kept" }, 400);
  }
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT status, note, pr_url, status_changed_at FROM comments WHERE id = ?")
    .bind(id)
    .first<{ status: Status; note: string | null; pr_url: string | null; status_changed_at: string | null }>();
  if (!row) return c.json({ error: "Not found" }, 404);

  const changed = row.status !== status;
  await c.env.DB.prepare(
    "UPDATE comments SET status = ?, note = ?, pr_url = ?, status_changed_at = ? WHERE id = ?",
  )
    .bind(
      status,
      status === "later" || status === "kept" ? (note ?? row.note) : null,
      clearPrUrl ? null : (prUrl ?? row.pr_url),
      changed ? new Date().toISOString() : row.status_changed_at,
      id,
    )
    .run();
  const updated = await c.env.DB.prepare(
    "SELECT id, status, note, pr_url, status_changed_at FROM comments WHERE id = ?",
  )
    .bind(id)
    .first();
  return c.json(updated);
});

owner.get("/comments/:id/screenshot", async (c) => {
  const row = await c.env.DB.prepare("SELECT screenshot_key FROM comments WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ screenshot_key: string | null }>();
  if (!row?.screenshot_key) return c.json({ error: "Not found" }, 404);
  const obj = await c.env.SHOTS.get(row.screenshot_key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export default owner;
