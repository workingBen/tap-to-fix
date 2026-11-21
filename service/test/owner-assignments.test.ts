import { describe, expect, it } from "vitest";
import { makeEnv } from "./env";
import { ownerFetch, seedReviewer, seedSite } from "./helpers";
import { newId } from "../src/ids";
import type { Env } from "../src/env";

const post = (env: Env, path: string, body?: unknown) =>
  ownerFetch(env, path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = any>(res: Response) => (await res.json()) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

async function seedComment(env: Env, assignmentId: string, status: string, extra: { pr_url?: string | null; screenshot_key?: string | null } = {}) {
  const id = newId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO comments (id, assignment_id, body, status, pr_url, screenshot_key, created_at, status_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, assignmentId, "body", status, extra.pr_url ?? null, extra.screenshot_key ?? null, now, now)
    .run();
  return id;
}

async function setup() {
  const env = makeEnv();
  const site = await seedSite(env);
  const reviewer = await seedReviewer(env, "Chris");
  return { env, site, reviewer };
}

describe("assignments", () => {
  it("creates an assignment", async () => {
    const { env, site, reviewer } = await setup();
    const res = await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: reviewer.id, path: "/digital-detox", title: "Detox page" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ site: site.slug, reviewer_id: reviewer.id, path: "/digital-detox", title: "Detox page" });
  });

  it("returns the existing assignment for the same triple", async () => {
    const { env, site, reviewer } = await setup();
    const body = { site: site.slug, reviewer_id: reviewer.id, path: "/a", title: "A" };
    const first = await json(await post(env, "/api/owner/assignments", body));
    const again = await post(env, "/api/owner/assignments", body);
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe(first.id);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM assignments").first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it("404s an unknown site or reviewer and 400s a bad path", async () => {
    const { env, site, reviewer } = await setup();
    expect((await post(env, "/api/owner/assignments", { site: "nope", reviewer_id: reviewer.id, path: "/a", title: "A" })).status).toBe(404);
    expect((await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: "nope", path: "/a", title: "A" })).status).toBe(404);
    expect((await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: reviewer.id, path: "a", title: "A" })).status).toBe(400);
    expect((await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: reviewer.id, path: "/a" })).status).toBe(400);
  });

  it("400s a path containing ? or #", async () => {
    const { env, site, reviewer } = await setup();
    for (const path of ["/a?x=1", "/a#top"]) {
      expect((await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: reviewer.id, path, title: "A" })).status).toBe(400);
    }
  });

  it("creates the lookup indexes", async () => {
    const { env } = await setup();
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toContain("idx_comments_assignment");
    expect(names).toContain("idx_assignments_reviewer");
  });

  it("deletes an assignment with its comments and screenshots", async () => {
    const { env, site, reviewer } = await setup();
    const a = await json(await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: reviewer.id, path: "/a", title: "A" }));
    await env.SHOTS.put("shots/one", new Uint8Array([1, 2, 3]));
    await seedComment(env, a.id, "open", { screenshot_key: "shots/one" });
    await seedComment(env, a.id, "done");
    const res = await ownerFetch(env, `/api/owner/assignments/${a.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await env.SHOTS.get("shots/one")).toBeNull();
    const n = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM comments) AS c, (SELECT COUNT(*) FROM assignments) AS a").first<{ c: number; a: number }>();
    expect(n).toEqual({ c: 0, a: 0 });
    expect((await ownerFetch(env, `/api/owner/assignments/${a.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("overview", () => {
  it("rolls up counts, status and pr urls", async () => {
    const { env, site, reviewer } = await setup();
    const other = await seedReviewer(env, "Dana");
    const a1 = await json(await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: reviewer.id, path: "/a", title: "A" }));
    const a2 = await json(await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: reviewer.id, path: "/b", title: "B" }));
    const a3 = await json(await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: other.id, path: "/c", title: "C" }));
    await seedComment(env, a1.id, "open");
    await seedComment(env, a1.id, "in_progress", { pr_url: "https://github.com/x/y/pull/1" });
    await seedComment(env, a1.id, "done", { pr_url: "https://github.com/x/y/pull/1" });
    await seedComment(env, a2.id, "done", { pr_url: "https://github.com/x/y/pull/2" });
    await seedComment(env, a2.id, "kept");
    await seedComment(env, a3.id, "in_progress");
    await post(env, `/api/owner/reviewers/${other.id}/revoke`);

    const res = await ownerFetch(env, "/api/owner/overview");
    expect(res.status).toBe(200);
    const ov = await json(res);

    const rc = ov.reviewers.find((r: any) => r.id === reviewer.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    const dana = ov.reviewers.find((r: any) => r.id === other.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(rc).toEqual({ id: reviewer.id, name: "Chris", revoked: false, unsettled_count: 2, ready_count: 1 });
    expect(dana).toMatchObject({ revoked: true, unsettled_count: 1, ready_count: 0 });

    const by = (id: string) => ov.assignments.find((x: any) => x.id === id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(by(a1.id)).toMatchObject({
      site: site.slug, path: "/a", title: "A", reviewer: { id: reviewer.id, name: "Chris" },
      status: "open", counts: { open: 1, in_progress: 1, settled: 1 },
      pr_urls: ["https://github.com/x/y/pull/1"],
    });
    expect(by(a2.id)).toMatchObject({ status: "done", counts: { open: 0, in_progress: 0, settled: 2 }, pr_urls: ["https://github.com/x/y/pull/2"] });
    expect(by(a3.id)).toMatchObject({ status: "in_progress", pr_urls: [] });
  });

  it("reports not_started for an assignment with no comments", async () => {
    const { env, site, reviewer } = await setup();
    const a = await json(await post(env, "/api/owner/assignments", { site: site.slug, reviewer_id: reviewer.id, path: "/a", title: "A" }));
    const ov = await json(await ownerFetch(env, "/api/owner/overview"));
    expect(ov.assignments[0]).toMatchObject({ id: a.id, status: "not_started", counts: { open: 0, in_progress: 0, settled: 0 } });
  });
});
