import { Hono } from "hono";
import type { Context } from "hono";
import { requireOwner, type AppBindings } from "../auth";
import { hashToken, newId, newToken } from "../ids";

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

export default owner;
