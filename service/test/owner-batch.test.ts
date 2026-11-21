import { describe, expect, it } from "vitest";
import { makeEnv } from "./env";
import { ownerFetch, reviewerFetch, seedReviewer, seedSite } from "./helpers";

const json = async <T = any>(res: Response) => (await res.json()) as T; // eslint-disable-line @typescript-eslint/no-explicit-any
const png = new Uint8Array([137, 80, 78, 71, 9, 8, 7]);

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
  async function comment(token: string, body: string, shot = false) {
    const fd = new FormData();
    fd.set("data", JSON.stringify({ site: "greensprings", path: "/one", body, selector: "h1" }));
    if (shot) fd.set("screenshot", new File([png], "s", { type: "image/png" }));
    const res = await reviewerFetch(env, token, "/api/me/comments", {
      method: "POST", body: fd, headers: { Origin: "https://greensprings.life" },
    });
    expect(res.status).toBe(201);
    return (await json(res)).id as string;
  }
  return { env, a, b, comment };
}

describe("owner batch and status API", () => {
  it("batch returns only that reviewer's open comments, oldest first, with a tokenless url", async () => {
    const { env, a, b, comment } = await setup();
    const c1 = await comment(a.token, "first", true);
    await new Promise((r) => setTimeout(r, 5));
    const c2 = await comment(a.token, "second");
    const c3 = await comment(a.token, "done one");
    await comment(b.token, "other reviewer");
    await ownerFetch(env, `/api/owner/comments/${c3}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });

    const res = await ownerFetch(env, `/api/owner/batch?reviewer=${a.id}&site=greensprings`);
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.reviewer).toEqual({ id: a.id, name: "Chris" });
    expect(out.site.slug).toBe("greensprings");
    expect(out.comments.map((c: any) => c.id)).toEqual([c1, c2]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(out.comments[0].page).toEqual({ path: "/one", title: "One", url: "https://greensprings.life/one" });
    expect(out.comments[0].has_screenshot).toBe(true);
    expect(out.comments[1].has_screenshot).toBe(false);
    expect(JSON.stringify(out)).not.toContain("ttf");

    expect((await ownerFetch(env, `/api/owner/batch?reviewer=nope&site=greensprings`)).status).toBe(404);
    expect((await ownerFetch(env, `/api/owner/batch?reviewer=${a.id}&site=nope`)).status).toBe(404);
  });

  it("PATCH updates status, pr_url and status_changed_at, and flags the reviewer's page as updated", async () => {
    const { env, a, comment } = await setup();
    const id = await comment(a.token, "fix");
    await env.DB.prepare("UPDATE assignments SET last_opened_at = ?").bind("2000-01-01T00:00:00.000Z").run();
    await env.DB.prepare("UPDATE comments SET status_changed_at = ? WHERE id = ?").bind("1999-01-01T00:00:00.000Z", id).run();
    const isUpdated = async () => (await json(await reviewerFetch(env, a.token, "/api/me"))).assignments[0].is_updated;
    expect(await isUpdated()).toBe(false);

    let res = await ownerFetch(env, `/api/owner/comments/${id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
    expect(res.status).toBe(200);
    const first = await json(res);
    expect(first.status).toBe("in_progress");
    expect(first.status_changed_at > "2000").toBe(true);
    expect(await isUpdated()).toBe(true);

    res = await ownerFetch(env, `/api/owner/comments/${id}`, {
      method: "PATCH", body: JSON.stringify({ status: "done", pr_url: "https://github.com/x/y/pull/1" }),
    });
    const second = await json(res);
    expect(second.status).toBe("done");
    expect(second.pr_url).toBe("https://github.com/x/y/pull/1");

    // Same status: note/pr_url update, timestamp unchanged.
    res = await ownerFetch(env, `/api/owner/comments/${id}`, { method: "PATCH", body: JSON.stringify({ status: "done", note: "n" }) });
    const third = await json(res);
    expect(third.note).toBe("n");
    expect(third.pr_url).toBe("https://github.com/x/y/pull/1");
    expect(third.status_changed_at).toBe(second.status_changed_at);
  });

  it("validates status, requires a note for later/kept, 404s unknown ids", async () => {
    const { env, a, comment } = await setup();
    const id = await comment(a.token, "fix");
    const patch = (cid: string, body: unknown) =>
      ownerFetch(env, `/api/owner/comments/${cid}`, { method: "PATCH", body: JSON.stringify(body) });
    expect((await patch(id, { status: "kept" })).status).toBe(400);
    expect((await patch(id, { status: "kept", note: "  " })).status).toBe(400);
    expect((await patch(id, { status: "bogus" })).status).toBe(400);
    expect((await patch(id, {})).status).toBe(400);
    expect((await patch(id, { status: "later", note: "next sprint" })).status).toBe(200);
    expect((await patch("missing", { status: "done" })).status).toBe(404);
  });

  it("serves the screenshot bytes to the owner, 404 when none", async () => {
    const { env, a, comment } = await setup();
    const withShot = await comment(a.token, "s", true);
    const without = await comment(a.token, "n");
    const res = await ownerFetch(env, `/api/owner/comments/${withShot}/screenshot`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect((await ownerFetch(env, `/api/owner/comments/${without}/screenshot`)).status).toBe(404);
    expect((await ownerFetch(env, `/api/owner/comments/zzz/screenshot`)).status).toBe(404);
  });
});
