import { describe, expect, it } from "vitest";
import { makeEnv } from "./env";
import { ownerFetch, reviewerFetch, seedReviewer, seedSite } from "./helpers";
import { MAX_SCREENSHOT_BYTES } from "../src/limits";
import type { Env } from "../src/env";

const json = async <T = any>(res: Response) => (await res.json()) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

async function setup() {
  const env = makeEnv();
  await seedSite(env);
  const a = await seedReviewer(env, "Chris");
  const b = await seedReviewer(env, "Dana");
  for (const r of [a, b]) {
    await ownerFetch(env, "/api/owner/assignments", {
      method: "POST",
      body: JSON.stringify({ site: "greensprings", reviewer_id: r.id, path: "/one", title: "One" }),
    });
  }
  return { env, a, b };
}

function form(data: unknown, file?: { bytes: Uint8Array; type: string; name?: string }) {
  const fd = new FormData();
  fd.set("data", JSON.stringify(data));
  if (file) fd.set("screenshot", new File([file.bytes], file.name ?? "s", { type: file.type }));
  return fd;
}

function post(env: Env, token: string, fd: FormData, headers: Record<string, string> = {}) {
  return reviewerFetch(env, token, "/api/me/comments", { method: "POST", body: fd, headers });
}

const base = { site: "greensprings", path: "/one", body: "Fix this" };
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

describe("POST /api/me/comments", () => {
  it("saves a comment with a small PNG and stores it in R2", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form({ ...base, selector: "h1" }, { bytes: png, type: "image/png" }));
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.screenshot).toBe("saved");
    const obj = await env.SHOTS.get(`shots/greensprings/${out.id}.png`);
    expect(obj).not.toBeNull();
    const row = await env.DB.prepare("SELECT screenshot_key, status, status_changed_at, created_at FROM comments WHERE id = ?")
      .bind(out.id)
      .first<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(row.screenshot_key).toBe(`shots/greensprings/${out.id}.png`);
    expect(row.status).toBe("open");
    expect(row.status_changed_at).toBeNull();
  });

  it("a reviewer's own new comment does not flag the page as updated", async () => {
    const { env, a } = await setup();
    const mine = (await json(await reviewerFetch(env, a.token, "/api/me"))).assignments[0];
    await reviewerFetch(env, a.token, `/api/me/assignments/${mine.id}/opened`, { method: "POST" });
    await new Promise((r) => setTimeout(r, 5));
    expect((await post(env, a.token, form(base))).status).toBe(201);
    const after = (await json(await reviewerFetch(env, a.token, "/api/me"))).assignments[0];
    expect(after.is_updated).toBe(false);
  });

  it("reports none without a file", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form(base));
    expect(res.status).toBe(201);
    expect((await json(res)).screenshot).toBe("none");
  });

  it("drops an oversize screenshot but keeps the comment", async () => {
    const { env, a } = await setup();
    const big = new Uint8Array(MAX_SCREENSHOT_BYTES + 1);
    const res = await post(env, a.token, form(base, { bytes: big, type: "image/png" }));
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.screenshot).toBe("dropped");
    expect(await env.SHOTS.head(`shots/greensprings/${out.id}.png`)).toBeNull();
    const row = await env.DB.prepare("SELECT screenshot_key FROM comments WHERE id = ?").bind(out.id).first<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(row).not.toBeNull();
    expect(row.screenshot_key).toBeNull();
  });

  it("drops a non-image file but keeps the comment", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form(base, { bytes: new TextEncoder().encode("hi"), type: "text/plain" }));
    expect(res.status).toBe(201);
    expect((await json(res)).screenshot).toBe("dropped");
  });

  it("403 when another registered site's origin posts to this site's assignment", async () => {
    const { env, a } = await setup();
    await seedSite(env, { slug: "other", name: "Other", origin: "https://other.example", repo: "x/y" });
    const res = await post(env, a.token, form(base), { Origin: "https://other.example" });
    expect(res.status).toBe(403);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("drops the screenshot but saves the comment when R2 put throws", async () => {
    const { env, a } = await setup();
    env.SHOTS.put = async () => {
      throw new Error("r2 down");
    };
    const res = await post(env, a.token, form(base, { bytes: png, type: "image/png" }));
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.screenshot).toBe("dropped");
    const row = await env.DB.prepare("SELECT screenshot_key FROM comments WHERE id = ?").bind(out.id).first<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(row).not.toBeNull();
    expect(row.screenshot_key).toBeNull();
  });

  it("drops a zero-byte screenshot but saves the comment", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form(base, { bytes: new Uint8Array(0), type: "image/png" }));
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.screenshot).toBe("dropped");
    const row = await env.DB.prepare("SELECT screenshot_key FROM comments WHERE id = ?").bind(out.id).first<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(row.screenshot_key).toBeNull();
  });

  it("403 for an unassigned path", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form({ ...base, path: "/nope" }));
    expect(res.status).toBe(403);
  });

  it("403 and no CORS header for a foreign Origin", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form(base), { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("allows the registered origin and echoes it", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form(base), { Origin: "https://greensprings.life" });
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://greensprings.life");
  });

  it("400 for an empty body", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form({ ...base, body: "   " }));
    expect(res.status).toBe(400);
  });
});

describe("CORS preflight", () => {
  it("answers OPTIONS for a registered origin with Authorization allowed", async () => {
    const { env } = await setup();
    const res = await reviewerFetch(env, "unused", "/api/me/comments", {
      method: "OPTIONS",
      headers: {
        Origin: "https://greensprings.life",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://greensprings.life");
    expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("authorization");
  });

  it("gives an unregistered origin no allow header", async () => {
    const { env } = await setup();
    const res = await reviewerFetch(env, "unused", "/api/me/comments", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("GET /api/me/pages/comments", () => {
  it("lists only this reviewer's comments on the path; 404 if unassigned", async () => {
    const { env, a, b } = await setup();
    await post(env, a.token, form({ ...base, body: "mine" }));
    await post(env, b.token, form({ ...base, body: "theirs" }));
    const res = await reviewerFetch(env, a.token, "/api/me/pages/comments?site=greensprings&path=/one");
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.assignment_id).toBeTruthy();
    expect(out.comments.map((c: any) => c.body)).toEqual(["mine"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const miss = await reviewerFetch(env, a.token, "/api/me/pages/comments?site=greensprings&path=/nope");
    expect(miss.status).toBe(404);
  });
});

describe("GET /api/me/comments/:id/screenshot", () => {
  it("serves the owner's image and 404s for another reviewer", async () => {
    const { env, a, b } = await setup();
    const out = await json(await post(env, a.token, form(base, { bytes: png, type: "image/png" })));
    const ok = await reviewerFetch(env, a.token, `/api/me/comments/${out.id}/screenshot`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/png");
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(png);
    const other = await reviewerFetch(env, b.token, `/api/me/comments/${out.id}/screenshot`);
    expect(other.status).toBe(404);
  });

  it("404s when the comment has no screenshot", async () => {
    const { env, a } = await setup();
    const out = await json(await post(env, a.token, form(base)));
    const res = await reviewerFetch(env, a.token, `/api/me/comments/${out.id}/screenshot`);
    expect(res.status).toBe(404);
  });
});
