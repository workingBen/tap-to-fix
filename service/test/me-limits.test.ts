import { afterEach, describe, expect, it } from "vitest";
import { makeEnv } from "./env";
import { ownerFetch, reviewerFetch, seedReviewer, seedSite } from "./helpers";
import {
  COMMENTS_PER_DAY,
  COMMENTS_PER_MINUTE,
  MAX_COMMENT_CHARS,
  MAX_COMMENT_REQUEST_BYTES,
  MAX_FIELD_CHARS,
  commentLimits,
} from "../src/limits";
import type { Env } from "../src/env";

const json = async <T = any>(res: Response) => (await res.json()) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

async function setup() {
  const env = makeEnv();
  await seedSite(env);
  const a = await seedReviewer(env, "Chris");
  const b = await seedReviewer(env, "Dana");
  const assignment: Record<string, string> = {};
  for (const r of [a, b]) {
    const res = await ownerFetch(env, "/api/owner/assignments", {
      method: "POST",
      body: JSON.stringify({ site: "greensprings", reviewer_id: r.id, path: "/one", title: "One" }),
    });
    assignment[r.id] = (await json(res)).id;
  }
  return { env, a, b, assignment };
}

function form(data: unknown, file?: { bytes: Uint8Array; type: string }) {
  const fd = new FormData();
  fd.set("data", JSON.stringify(data));
  if (file) fd.set("screenshot", new File([file.bytes], "s", { type: file.type }));
  return fd;
}

function post(env: Env, token: string, fd: FormData, headers: Record<string, string> = { Origin: "https://greensprings.life" }) {
  return reviewerFetch(env, token, "/api/me/comments", { method: "POST", body: fd, headers });
}

async function count(env: Env) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>())!.n;
}

async function backdate(env: Env, assignmentId: string, n: number, msAgo: number) {
  const at = new Date(Date.now() - msAgo).toISOString();
  for (let i = 0; i < n; i++) {
    await env.DB.prepare("INSERT INTO comments (id, assignment_id, body, created_at) VALUES (?, ?, 'old', ?)")
      .bind(`old-${msAgo}-${i}`, assignmentId, at)
      .run();
  }
}

const base = { site: "greensprings", path: "/one", body: "Fix this" };
const defaults = { ...commentLimits };
afterEach(() => Object.assign(commentLimits, defaults));

describe("comment size caps", () => {
  it("accepts a body of exactly the maximum length", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form({ ...base, body: "x".repeat(MAX_COMMENT_CHARS) }));
    expect(res.status).toBe(201);
  });

  it("413 for a body one character over, and saves nothing", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form({ ...base, body: "x".repeat(MAX_COMMENT_CHARS + 1) }));
    expect(res.status).toBe(413);
    expect((await json(res)).error).toBe(`Comment is too long (${MAX_COMMENT_CHARS} characters at most)`);
    expect(await count(env)).toBe(0);
  });

  it("413 for a request larger than the whole-request ceiling", async () => {
    const { env, a } = await setup();
    const huge = new Uint8Array(MAX_COMMENT_REQUEST_BYTES + 1);
    const res = await post(env, a.token, form(base, { bytes: huge, type: "image/png" }));
    expect(res.status).toBe(413);
    expect((await json(res)).error).toBe("Request is too large");
    expect(await count(env)).toBe(0);
  });

  it("413 with a Content-Length over the ceiling, before reading the body", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form(base), { "Content-Length": String(MAX_COMMENT_REQUEST_BYTES + 1) });
    expect(res.status).toBe(413);
  });

  it("a 413 still carries the CORS header, so the comment layer can read it", async () => {
    const { env, a } = await setup();
    const res = await post(env, a.token, form({ ...base, body: "x".repeat(MAX_COMMENT_CHARS + 1) }), {
      Origin: "https://greensprings.life",
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://greensprings.life");
  });

  it("keeps the comment but drops location fields longer than the cap", async () => {
    const { env, a } = await setup();
    const long = "y".repeat(MAX_FIELD_CHARS + 1);
    const res = await post(env, a.token, form({ ...base, selector: long, element_text: long, device: long }));
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT selector, element_text, device FROM comments WHERE id = ?")
      .bind((await json(res)).id)
      .first();
    expect(row).toEqual({ selector: null, element_text: null, device: null });
  });

  it("keeps location fields at the cap", async () => {
    const { env, a } = await setup();
    const ok = "y".repeat(MAX_FIELD_CHARS);
    const res = await post(env, a.token, form({ ...base, selector: ok }));
    const row = await env.DB.prepare("SELECT selector FROM comments WHERE id = ?").bind((await json(res)).id).first<{ selector: string }>();
    expect(row!.selector).toBe(ok);
  });
});

describe("comment rate limits", () => {
  it("defaults are generous for a person and small for a script", () => {
    expect(COMMENTS_PER_MINUTE).toBe(20);
    expect(COMMENTS_PER_DAY).toBe(300);
  });

  it("429 with Retry-After once a reviewer passes the per-minute limit; others are unaffected", async () => {
    commentLimits.perMinute = 3;
    const { env, a, b } = await setup();
    for (let i = 0; i < 3; i++) expect((await post(env, a.token, form(base))).status).toBe(201);
    const res = await post(env, a.token, form(base), { Origin: "https://greensprings.life" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://greensprings.life");
    expect((await json(res)).error).toBe("Too many comments. Wait a minute and try again.");
    expect(await count(env)).toBe(3);
    expect((await post(env, b.token, form(base))).status).toBe(201);
  });

  it("comments older than a minute do not count toward the per-minute limit", async () => {
    commentLimits.perMinute = 2;
    const { env, a, assignment } = await setup();
    await backdate(env, assignment[a.id], 5, 2 * 60_000);
    expect((await post(env, a.token, form(base))).status).toBe(201);
  });

  it("429 once a reviewer passes the per-day limit", async () => {
    commentLimits.perDay = 4;
    const { env, a, assignment } = await setup();
    await backdate(env, assignment[a.id], 4, 60 * 60_000);
    const res = await post(env, a.token, form(base));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect((await json(res)).error).toBe("Too many comments today. Try again tomorrow.");
  });

  it("comments older than a day do not count", async () => {
    commentLimits.perDay = 2;
    const { env, a, assignment } = await setup();
    await backdate(env, assignment[a.id], 5, 25 * 60 * 60_000);
    expect((await post(env, a.token, form(base))).status).toBe(201);
  });
});
