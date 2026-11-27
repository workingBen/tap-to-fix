import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { requireReviewer, type AppBindings } from "../auth";
import { newId } from "../ids";
import {
  MAX_COMMENT_CHARS,
  MAX_COMMENT_REQUEST_BYTES,
  MAX_FIELD_CHARS,
  MAX_SCREENSHOT_BYTES,
  commentLimits,
} from "../limits";
import { assignmentStatus, isSettled, isUpdated, progress, type Status } from "../rollup";

const me = new Hono<AppBindings>();

// CORS: echo the Origin only when it is some registered site's origin.
const cors = createMiddleware<AppBindings>(async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin) {
    c.header("Vary", "Origin");
    const known = await c.env.DB.prepare("SELECT 1 AS ok FROM sites WHERE origin = ?")
      .bind(origin)
      .first<{ ok: number }>();
    if (known) {
      c.header("Access-Control-Allow-Origin", origin);
      if (c.req.method === "OPTIONS") {
        c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
        c.header("Access-Control-Max-Age", "86400");
      }
    }
  }
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

me.use("*", cors);
me.use("*", requireReviewer);

const IMAGE_EXT: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

type AssignmentRow = {
  id: string;
  path: string;
  title: string;
  last_opened_at: string | null;
  finished_at: string | null;
  site_slug: string;
  site_name: string;
  site_origin: string;
};

me.get("/", async (c) => {
  const reviewer = c.get("reviewer");
  const { results: assignments } = await c.env.DB.prepare(
    `SELECT a.id, a.path, a.title, a.last_opened_at, a.finished_at,
            s.slug AS site_slug, s.name AS site_name, s.origin AS site_origin
       FROM assignments a JOIN sites s ON s.slug = a.site_slug
      WHERE a.reviewer_id = ?
      ORDER BY a.created_at, a.id`,
  )
    .bind(reviewer.id)
    .all<AssignmentRow>();
  const { results: comments } = await c.env.DB.prepare(
    `SELECT c.assignment_id, c.status, c.status_changed_at
       FROM comments c JOIN assignments a ON a.id = c.assignment_id
      WHERE a.reviewer_id = ?`,
  )
    .bind(reviewer.id)
    .all<{ assignment_id: string; status: Status; status_changed_at: string | null }>();

  const ack = await c.env.DB.prepare("SELECT acknowledged_at FROM reviewers WHERE id = ?")
    .bind(reviewer.id)
    .first<{ acknowledged_at: string | null }>();
  const acknowledgedAt = ack?.acknowledged_at ?? null;

  const byAssignment = new Map<string, typeof comments>();
  for (const cm of comments) {
    const list = byAssignment.get(cm.assignment_id) ?? [];
    list.push(cm);
    byAssignment.set(cm.assignment_id, list);
  }

  const rows = assignments.map((a) => {
    const list = byAssignment.get(a.id) ?? [];
    const statuses = list.map((cm) => cm.status);
    return {
      id: a.id,
      site: { slug: a.site_slug, name: a.site_name, origin: a.site_origin },
      path: a.path,
      title: a.title,
      url: a.site_origin + a.path + "#ttf=" + reviewer.token,
      status: assignmentStatus(statuses),
      progress: progress(statuses),
      counts: {
        total: statuses.length,
        settled: statuses.filter(isSettled).length,
        in_progress: statuses.filter((s) => s === "in_progress").length,
        open: statuses.filter((s) => s === "open").length,
      },
      is_new: a.last_opened_at === null,
      is_updated: isUpdated(
        a.last_opened_at,
        list.flatMap((cm) => (cm.status_changed_at ? [cm.status_changed_at] : [])),
      ),
      finished: a.finished_at !== null,
      finished_at: a.finished_at,
    };
  });
  // "Since you last looked": comments settled after the reviewer's last Got it, page by page.
  // `through` is the latest change counted, which Got it sends back, so a comment fixed while the
  // notice was on screen still shows next time.
  let through: string | null = null;
  const fixedPages: { id: string; title: string; fixed: number; finished: boolean }[] = [];
  for (const a of assignments) {
    const fixed = (byAssignment.get(a.id) ?? []).filter(
      (cm) => isSettled(cm.status) && cm.status_changed_at !== null && (acknowledgedAt === null || cm.status_changed_at > acknowledgedAt),
    );
    if (fixed.length === 0) continue;
    fixedPages.push({ id: a.id, title: a.title, fixed: fixed.length, finished: a.finished_at !== null });
    for (const cm of fixed) if (through === null || cm.status_changed_at! > through) through = cm.status_changed_at;
  }

  return c.json({
    name: reviewer.name,
    assignments: rows,
    fixed: { through, pages: fixedPages },
  });
});

me.post("/assignments/:id/opened", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE assignments SET last_opened_at = ? WHERE id = ? AND reviewer_id = ?",
  )
    .bind(new Date().toISOString(), c.req.param("id"), c.get("reviewer").id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});

/** "Review complete" on the list: the page moves to Finished. */
me.post("/assignments/:id/finished", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE assignments SET finished_at = COALESCE(finished_at, ?) WHERE id = ? AND reviewer_id = ?",
  )
    .bind(new Date().toISOString(), c.req.param("id"), c.get("reviewer").id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});

/** "Re-review": the page comes back out of Finished. */
me.delete("/assignments/:id/finished", async (c) => {
  const result = await c.env.DB.prepare("UPDATE assignments SET finished_at = NULL WHERE id = ? AND reviewer_id = ?")
    .bind(c.req.param("id"), c.get("reviewer").id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

/**
 * "Got it" on the notice. Body `{ through }`: the `fixed.through` time the notice was built from,
 * so anything fixed after it still shows next time. Without one, now. Never moves backward.
 */
me.post("/acknowledge", async (c) => {
  let through: unknown;
  try {
    const text = await c.req.text();
    through = text ? (JSON.parse(text) as { through?: unknown } | null)?.through : undefined;
  } catch {
    return c.json({ error: "Invalid data" }, 400);
  }
  const now = new Date().toISOString();
  if (through !== undefined && through !== null && (typeof through !== "string" || !ISO_TIME.test(through))) {
    return c.json({ error: "Invalid time" }, 400);
  }
  const at = typeof through === "string" && through < now ? through : now;
  await c.env.DB.prepare(
    `UPDATE reviewers SET acknowledged_at = ?
      WHERE id = ? AND (acknowledged_at IS NULL OR acknowledged_at < ?)`,
  )
    .bind(at, c.get("reviewer").id, at)
    .run();
  return c.body(null, 204);
});

me.get("/pages/comments", async (c) => {
  const site = c.req.query("site");
  const path = c.req.query("path");
  if (!site || !path) return c.json({ error: "Not found" }, 404);
  const reviewerId = c.get("reviewer").id;
  const assignment = await c.env.DB.prepare(
    "SELECT id FROM assignments WHERE site_slug = ? AND reviewer_id = ? AND path = ?",
  )
    .bind(site, reviewerId, path)
    .first<{ id: string }>();
  if (!assignment) return c.json({ error: "Not found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT id, body, status, note, pr_url, selector, element_text, element_x, element_y,
            page_x, page_y, created_at, client_id
       FROM comments WHERE assignment_id = ? ORDER BY created_at, id`,
  )
    .bind(assignment.id)
    .all();
  return c.json({ assignment_id: assignment.id, comments: results });
});

type CommentInput = {
  site?: unknown;
  path?: unknown;
  body?: unknown;
  selector?: unknown;
  element_text?: unknown;
  element_x?: unknown;
  element_y?: unknown;
  page_x?: unknown;
  page_y?: unknown;
  viewport_w?: unknown;
  viewport_h?: unknown;
  device?: unknown;
  client_id?: unknown;
};

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A location field, or null when it is missing or longer than the cap. */
const field = (v: unknown) => (typeof v === "string" && v.length <= MAX_FIELD_CHARS ? v : null);
/** The comment layer's own id for a comment (a UUID); anything else is ignored. */
const clientId = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null);

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Refuses a reviewer who has saved too many comments lately (see commentLimits in ../limits). */
const rateLimit = createMiddleware<AppBindings>(async (c, next) => {
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS day, COALESCE(SUM(c.created_at > ?), 0) AS minute
       FROM comments c JOIN assignments a ON a.id = c.assignment_id
      WHERE a.reviewer_id = ? AND c.created_at > ?`,
  )
    .bind(new Date(now - MINUTE_MS).toISOString(), c.get("reviewer").id, new Date(now - DAY_MS).toISOString())
    .first<{ day: number; minute: number }>();
  if ((row?.minute ?? 0) >= commentLimits.perMinute) {
    c.header("Retry-After", "60");
    return c.json({ error: "Too many comments. Wait a minute and try again." }, 429);
  }
  if ((row?.day ?? 0) >= commentLimits.perDay) {
    c.header("Retry-After", "3600");
    return c.json({ error: "Too many comments today. Try again tomorrow." }, 429);
  }
  await next();
});

const commentBodyLimit = bodyLimit({
  maxSize: MAX_COMMENT_REQUEST_BYTES,
  onError: (c) => c.json({ error: "Request is too large" }, 413),
});

me.post("/comments", rateLimit, commentBodyLimit, async (c) => {
  let form: Record<string, string | File | (string | File)[]>;
  try {
    form = await c.req.parseBody();
  } catch {
    return c.json({ error: "Invalid form data" }, 400);
  }
  let input: CommentInput;
  try {
    input = JSON.parse(typeof form.data === "string" ? form.data : "");
  } catch {
    return c.json({ error: "Invalid data" }, 400);
  }
  if (!input || typeof input !== "object") return c.json({ error: "Invalid data" }, 400);
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return c.json({ error: "Comment body is required" }, 400);
  if (body.length > MAX_COMMENT_CHARS) {
    return c.json({ error: `Comment is too long (${MAX_COMMENT_CHARS} characters at most)` }, 413);
  }
  const site = str(input.site);
  const path = str(input.path);
  if (!site || !path) return c.json({ error: "Not assigned" }, 403);

  const row = await c.env.DB.prepare(
    `SELECT a.id, s.origin FROM assignments a JOIN sites s ON s.slug = a.site_slug
      WHERE a.site_slug = ? AND a.reviewer_id = ? AND a.path = ?`,
  )
    .bind(site, c.get("reviewer").id, path)
    .first<{ id: string; origin: string }>();
  if (!row) return c.json({ error: "Not assigned" }, 403);
  const origin = c.req.header("Origin");
  // Browsers always send Origin on a cross-site POST; a request without one is not from the site.
  if (origin !== row.origin) return c.json({ error: "Wrong origin" }, 403);

  // Offline mode retries a comment until it hears back, so the same comment can arrive twice
  // (a reply lost on a weak connection, or two tabs sending it). The first one counts.
  const cid = clientId(input.client_id);
  const existing = async () =>
    cid
      ? await c.env.DB.prepare("SELECT id FROM comments WHERE assignment_id = ? AND client_id = ?")
          .bind(row.id, cid)
          .first<{ id: string }>()
      : null;
  const before = await existing();
  if (before) return c.json({ id: before.id, duplicate: true }, 200);

  const id = newId();
  const now = new Date().toISOString();

  // Screenshot problems never block the comment.
  let screenshot: "saved" | "none" | "dropped" = "none";
  let key: string | null = null;
  const file = form.screenshot;
  if (file instanceof File) {
    const ext = IMAGE_EXT[file.type];
    if (ext && file.size > 0 && file.size <= MAX_SCREENSHOT_BYTES) {
      try {
        const candidate = `shots/${site}/${id}.${ext}`;
        await c.env.SHOTS.put(candidate, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
        key = candidate;
        screenshot = "saved";
      } catch {
        screenshot = "dropped";
      }
    } else {
      screenshot = "dropped";
    }
  }

  const inserted = await c.env.DB.prepare(
    `INSERT INTO comments (id, assignment_id, body, status, selector, element_text, element_x, element_y,
                           page_x, page_y, viewport_w, viewport_h, device, screenshot_key, created_at, client_id)
     VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (assignment_id, client_id) DO NOTHING`,
  )
    .bind(
      id, row.id, body,
      field(input.selector), field(input.element_text), num(input.element_x), num(input.element_y),
      num(input.page_x), num(input.page_y), num(input.viewport_w), num(input.viewport_h),
      field(input.device), key, now, cid,
    )
    .run();
  if (!inserted.meta.changes) {
    // The same comment landed from another request while this one was uploading its screenshot.
    if (key) await c.env.SHOTS.delete(key).catch(() => {});
    const first = await existing();
    if (first) return c.json({ id: first.id, duplicate: true }, 200);
    return c.json({ error: "Could not save" }, 500);
  }
  return c.json({ id, screenshot }, 201);
});

me.get("/comments/:id/screenshot", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT c.screenshot_key FROM comments c JOIN assignments a ON a.id = c.assignment_id
      WHERE c.id = ? AND a.reviewer_id = ?`,
  )
    .bind(c.req.param("id"), c.get("reviewer").id)
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

export default me;
