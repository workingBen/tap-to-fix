import { Hono } from "hono";
import { requireReviewer, type AppBindings } from "../auth";
import { assignmentStatus, isSettled, isUpdated, progress, type Status } from "../rollup";

const me = new Hono<AppBindings>();
me.use("*", requireReviewer);

type AssignmentRow = {
  id: string;
  path: string;
  title: string;
  last_opened_at: string | null;
  site_slug: string;
  site_name: string;
  site_origin: string;
};

me.get("/", async (c) => {
  const reviewer = c.get("reviewer");
  const { results: assignments } = await c.env.DB.prepare(
    `SELECT a.id, a.path, a.title, a.last_opened_at,
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

  const byAssignment = new Map<string, typeof comments>();
  for (const cm of comments) {
    const list = byAssignment.get(cm.assignment_id) ?? [];
    list.push(cm);
    byAssignment.set(cm.assignment_id, list);
  }

  return c.json({
    name: reviewer.name,
    assignments: assignments.map((a) => {
      const list = byAssignment.get(a.id) ?? [];
      const statuses = list.map((cm) => cm.status);
      return {
        id: a.id,
        site: { slug: a.site_slug, name: a.site_name, origin: a.site_origin },
        path: a.path,
        title: a.title,
        url: a.site_origin + a.path + "?ttf=" + reviewer.token,
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
      };
    }),
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

export default me;
