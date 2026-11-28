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

  it("refuses a ?ttf= token", async () => {
    const { env, a } = await setup();
    await assign(env, a.id, "/one");
    const res = await (await import("./env")).call("/api/me?ttf=" + a.token, {}, env);
    expect(res.status).toBe(401);
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

describe("Finished (POST / DELETE /api/me/assignments/:id/finished)", () => {
  it("marks a page finished, keeps the first time, and Re-review clears it", async () => {
    const { env, a } = await setup();
    const id = await assign(env, a.id, "/one");
    const get = async () => (await json(await reviewerFetch(env, a.token, "/api/me"))).assignments[0];
    expect(await get()).toMatchObject({ finished: false, finished_at: null });

    expect((await reviewerFetch(env, a.token, `/api/me/assignments/${id}/finished`, { method: "POST" })).status).toBe(204);
    const first = await get();
    expect(first.finished).toBe(true);
    expect(first.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // A second tap (two tabs, a retry) does not move the time.
    await new Promise((r) => setTimeout(r, 5));
    await reviewerFetch(env, a.token, `/api/me/assignments/${id}/finished`, { method: "POST" });
    expect((await get()).finished_at).toBe(first.finished_at);

    expect((await reviewerFetch(env, a.token, `/api/me/assignments/${id}/finished`, { method: "DELETE" })).status).toBe(204);
    expect(await get()).toMatchObject({ finished: false, finished_at: null });
  });

  it("returns 404 for another reviewer's page and leaves it alone", async () => {
    const { env, a, b } = await setup();
    const id = await assign(env, a.id, "/one");
    expect((await reviewerFetch(env, b.token, `/api/me/assignments/${id}/finished`, { method: "POST" })).status).toBe(404);
    await reviewerFetch(env, a.token, `/api/me/assignments/${id}/finished`, { method: "POST" });
    expect((await reviewerFetch(env, b.token, `/api/me/assignments/${id}/finished`, { method: "DELETE" })).status).toBe(404);
    const row = await env.DB.prepare("SELECT finished_at FROM assignments WHERE id = ?").bind(id).first<{ finished_at: string | null }>();
    expect(row?.finished_at).not.toBeNull();
  });

  it("returns 404 for an unknown id", async () => {
    const { env, a } = await setup();
    expect((await reviewerFetch(env, a.token, "/api/me/assignments/nope/finished", { method: "POST" })).status).toBe(404);
    expect((await reviewerFetch(env, a.token, "/api/me/assignments/nope/finished", { method: "DELETE" })).status).toBe(404);
  });
});

describe("Since you last looked (fixed summary and POST /api/me/acknowledge)", () => {
  const T1 = "2020-01-01T00:00:00.000Z";
  const T2 = "2020-01-02T00:00:00.000Z";
  const T3 = "2020-01-03T00:00:00.000Z";
  const me = async (env: Env, token: string) => json(await reviewerFetch(env, token, "/api/me"));
  const ack = (env: Env, token: string, body?: object) =>
    reviewerFetch(env, token, "/api/me/acknowledge", { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });

  it("counts settled comments per page, says which pages are finished, and leaves out open ones", async () => {
    const { env, a, b } = await setup();
    const one = await assign(env, a.id, "/one", "One");
    const two = await assign(env, a.id, "/two", "Two");
    const three = await assign(env, a.id, "/three", "Three");
    const theirs = await assign(env, b.id, "/one", "Theirs");
    await seedComment(env, one, "done", T1);
    await seedComment(env, one, "kept", T2);
    await seedComment(env, one, "open", T3);
    await seedComment(env, two, "later", T1);
    await seedComment(env, three, "in_progress", T3);
    await seedComment(env, theirs, "done", T3);
    await reviewerFetch(env, a.token, `/api/me/assignments/${two}/finished`, { method: "POST" });

    const body = await me(env, a.token);
    expect(body.fixed).toEqual({
      through: T2,
      pages: [
        { id: one, title: "One", fixed: 2, finished: false },
        { id: two, title: "Two", fixed: 1, finished: true },
      ],
    });
  });

  it("Got it hides what it covered; a comment fixed later shows on its own", async () => {
    const { env, a } = await setup();
    const one = await assign(env, a.id, "/one", "One");
    await seedComment(env, one, "done", T1);
    await seedComment(env, one, "done", T2);
    expect((await me(env, a.token)).fixed.through).toBe(T2);

    expect((await ack(env, a.token, { through: T2 })).status).toBe(204);
    expect((await me(env, a.token)).fixed).toEqual({ through: null, pages: [] });

    // Fixed after the notice was built (or after Got it): it shows next time.
    await seedComment(env, one, "done", T3);
    expect((await me(env, a.token)).fixed).toEqual({ through: T3, pages: [{ id: one, title: "One", fixed: 1, finished: false }] });
  });

  it("never moves the time backward, and with no body uses now", async () => {
    const { env, a } = await setup();
    const one = await assign(env, a.id, "/one", "One");
    await seedComment(env, one, "done", T2);
    await ack(env, a.token, { through: T2 });
    await ack(env, a.token, { through: T1 }); // an older tab's Got it
    expect((await me(env, a.token)).fixed.pages).toEqual([]);

    await seedComment(env, one, "done", "2999-01-01T00:00:00.000Z");
    await ack(env, a.token);
    const row = await env.DB.prepare("SELECT acknowledged_at FROM reviewers WHERE id = ?").bind(a.id).first<{ acknowledged_at: string }>();
    expect(row!.acknowledged_at < "2999").toBe(true);
    expect(row!.acknowledged_at > T2).toBe(true);
  });

  it("a through time in the future is held to now", async () => {
    const { env, a } = await setup();
    await ack(env, a.token, { through: "2999-01-01T00:00:00.000Z" });
    const row = await env.DB.prepare("SELECT acknowledged_at FROM reviewers WHERE id = ?").bind(a.id).first<{ acknowledged_at: string }>();
    expect(row!.acknowledged_at < "2999").toBe(true);
  });

  it("is per reviewer", async () => {
    const { env, a, b } = await setup();
    const mine = await assign(env, a.id, "/one", "One");
    const theirs = await assign(env, b.id, "/one", "One");
    await seedComment(env, mine, "done", T1);
    await seedComment(env, theirs, "done", T1);
    await ack(env, a.token, { through: T1 });
    expect((await me(env, a.token)).fixed.pages).toEqual([]);
    expect((await me(env, b.token)).fixed.pages).toHaveLength(1);
  });

  it("refuses a bad time and needs a token", async () => {
    const { env, a } = await setup();
    expect((await ack(env, a.token, { through: "yesterday" })).status).toBe(400);
    expect((await ack(env, a.token, { through: 5 })).status).toBe(400);
    const bad = await reviewerFetch(env, a.token, "/api/me/acknowledge", { method: "POST", body: "{nope" });
    expect(bad.status).toBe(400);
    expect((await (await import("./env")).call("/api/me/acknowledge", { method: "POST" }, env)).status).toBe(401);
  });
});
