import { describe, expect, it } from "vitest";
import { makeEnv } from "./env";
import { ownerFetch, reviewerFetch, seedReviewer, seedSite } from "./helpers";
import { newId } from "../src/ids";
import type { Env } from "../src/env";

const json = async <T = any>(res: Response) => (await res.json()) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

async function assign(env: Env, reviewerId: string, path: string, title = "Page") {
  const res = await ownerFetch(env, "/api/owner/assignments", {
    method: "POST",
    body: JSON.stringify({ site: "greensprings", reviewer_id: reviewerId, path, title }),
  });
  return (await json(res)).id as string;
}

async function seedComment(env: Env, assignmentId: string, status: string, changedAt = new Date().toISOString()) {
  await env.DB.prepare(
    "INSERT INTO comments (id, assignment_id, body, status, created_at, status_changed_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(newId(), assignmentId, "body", status, changedAt, changedAt)
    .run();
}

async function setup() {
  const env = makeEnv();
  await seedSite(env);
  const a = await seedReviewer(env, "Chris");
  const b = await seedReviewer(env, "Dana");
  return { env, a, b };
}

describe("GET /api/me", () => {
  it("returns only the reviewer's own assignments with site, counts and url", async () => {
    const { env, a, b } = await setup();
    const mine = await assign(env, a.id, "/one", "One");
    await assign(env, b.id, "/two", "Two");
    await seedComment(env, mine, "open");
    await seedComment(env, mine, "in_progress");
    await seedComment(env, mine, "done");
    await seedComment(env, mine, "kept");

    const res = await reviewerFetch(env, a.token, "/api/me");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.name).toBe("Chris");
    expect(body.assignments).toHaveLength(1);
    const asg = body.assignments[0];
    expect(asg.id).toBe(mine);
    expect(asg.site).toEqual({ slug: "greensprings", name: "Greensprings", origin: "https://greensprings.life" });
    expect(asg.path).toBe("/one");
    expect(asg.title).toBe("One");
    expect(asg.url).toBe("https://greensprings.life/one#ttf=" + a.token);
    expect(asg.status).toBe("open");
    expect(asg.progress).toBe(0.5);
    expect(asg.counts).toEqual({ total: 4, settled: 2, in_progress: 1, open: 1 });
  });

  it("builds the url from a ?ttf= token too", async () => {
    const { env, a } = await setup();
    await assign(env, a.id, "/one");
    const res = await (await import("./env")).call("/api/me?ttf=" + a.token, {}, env);
    expect((await json(res)).assignments[0].url).toBe("https://greensprings.life/one#ttf=" + a.token);
  });

  it("flags is_new until opened, and is_updated after a later status change", async () => {
    const { env, a } = await setup();
    const id = await assign(env, a.id, "/one");
    await seedComment(env, id, "open", "2020-01-01T00:00:00.000Z");
    const get = async () => (await json(await reviewerFetch(env, a.token, "/api/me"))).assignments[0];

    expect(await get()).toMatchObject({ is_new: true, is_updated: false });

    const opened = await reviewerFetch(env, a.token, `/api/me/assignments/${id}/opened`, { method: "POST" });
    expect(opened.status).toBe(204);
    expect(await get()).toMatchObject({ is_new: false, is_updated: false });

    await env.DB.prepare("UPDATE comments SET status = 'done', status_changed_at = ? WHERE assignment_id = ?")
      .bind("2999-01-01T00:00:00.000Z", id)
      .run();
    expect(await get()).toMatchObject({ is_new: false, is_updated: true });

    await env.DB.prepare("UPDATE assignments SET last_opened_at = ? WHERE id = ?")
      .bind("2000-01-01T00:00:00.000Z", id)
      .run();
    expect((await get()).is_updated).toBe(true);
    await reviewerFetch(env, a.token, `/api/me/assignments/${id}/opened`, { method: "POST" });
    // now (real clock) is still before 2999, so move the change back to make the reset observable
    await env.DB.prepare("UPDATE comments SET status_changed_at = ? WHERE assignment_id = ?")
      .bind("2020-01-01T00:00:00.000Z", id)
      .run();
    expect((await get()).is_updated).toBe(false);
  });

  it("rejects a missing token", async () => {
    const { env } = await setup();
    expect((await (await import("./env")).call("/api/me", {}, env)).status).toBe(401);
  });
});

describe("POST /api/me/assignments/:id/opened", () => {
  it("returns 404 for another reviewer's assignment and leaves it untouched", async () => {
    const { env, a, b } = await setup();
    const id = await assign(env, a.id, "/one");
    const res = await reviewerFetch(env, b.token, `/api/me/assignments/${id}/opened`, { method: "POST" });
    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT last_opened_at FROM assignments WHERE id = ?")
      .bind(id)
      .first<{ last_opened_at: string | null }>();
    expect(row?.last_opened_at).toBeNull();
  });

  it("returns 404 for an unknown id", async () => {
    const { env, a } = await setup();
    const res = await reviewerFetch(env, a.token, "/api/me/assignments/nope/opened", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
