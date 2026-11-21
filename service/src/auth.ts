import { createMiddleware } from "hono/factory";
import type { Env } from "./env";
import { hashToken } from "./ids";

export type AppBindings = {
  Bindings: Env;
  Variables: { reviewer: { id: string; name: string } };
};

function bearer(header: string | undefined): string | null {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  return m ? m[1] : null;
}

/** Constant-time compare of two strings via their SHA-256 digests (equal length). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const requireOwner = createMiddleware<AppBindings>(async (c, next) => {
  const presented = bearer(c.req.header("Authorization"));
  if (!presented || !(await safeEqual(presented, c.env.OWNER_TOKEN))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

export const requireReviewer = createMiddleware<AppBindings>(async (c, next) => {
  const token = bearer(c.req.header("Authorization")) ?? c.req.query("ttf") ?? null;
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const row = await c.env.DB.prepare(
    "SELECT id, name FROM reviewers WHERE token_hash = ? AND revoked_at IS NULL",
  )
    .bind(await hashToken(token))
    .first<{ id: string; name: string }>();
  if (!row) return c.json({ error: "Unauthorized" }, 401);
  c.set("reviewer", { id: row.id, name: row.name });
  await next();
});
