import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../../src/index";
import { makeEnv } from "../env";
import { seedReviewer, seedSite } from "../helpers";
import { newId } from "../../src/ids";
import type { Env } from "../../src/env";
// @ts-expect-error plain .mjs, not type-checked
import { main } from "../../../bin/lib/commands.mjs";
// @ts-expect-error plain .mjs, not type-checked
import { queueMarkdown } from "../../../bin/lib/batch.mjs";

const tmps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ttf-batch-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

async function seedAssignment(env: Env, siteSlug: string, reviewerId: string) {
  const id = newId();
  await env.DB.prepare("INSERT INTO assignments (id, site_slug, reviewer_id, path, title, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, siteSlug, reviewerId, "/about", "About us", new Date().toISOString())
    .run();
  return id;
}

async function seedComment(env: Env, assignmentId: string, body: string, shot: "yes" | "none" | "dangling", at: string) {
  const id = newId();
  const key = shot === "none" ? null : `shots/${id}.png`;
  if (shot === "yes") await env.SHOTS.put(key!, PNG, { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare(
    "INSERT INTO comments (id, assignment_id, body, status, selector, element_text, viewport_w, viewport_h, device, screenshot_key, created_at, status_changed_at) VALUES (?, ?, ?, 'open', ?, ?, 390, 844, 'phone', ?, ?, ?)",
  )
    .bind(id, assignmentId, body, "main > h1", "Welcome", key, at, at)
    .run();
  return id;
}

async function world() {
  const env = makeEnv();
  const site = await seedSite(env);
  const reviewer = await seedReviewer(env, "Alexis Rivera");
  const a = await seedAssignment(env, site.slug, reviewer.id);
  const c1 = await seedComment(env, a, "Too small", "yes", "2026-11-01T00:00:00Z");
  const c2 = await seedComment(env, a, "Wrong color", "yes", "2026-11-02T00:00:00Z");
  const out: string[] = [];
  const err: string[] = [];
  const cwd = tmp();
  const ctx = {
    env: { TTF_SERVICE: "http://svc", TTF_OWNER_TOKEN: env.OWNER_TOKEN, TTF_HOME: join(cwd, "ttf-home") },
    home: "/nonexistent",
    now: () => new Date(2026, 10, 20, 9, 5),
    fetchImpl: (req: Request) => app.fetch(req, env),
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  };
  return { env, site, reviewer, c1, c2, out, err, ctx, cwd };
}

describe("ttf batch", () => {
  it("writes batch.json, screenshots and queue.md", async () => {
    const w = await world();
    const dir = join(w.cwd, "out");
    expect(await main(["batch", "alexis", "greensprings", "--out", dir], w.ctx)).toBe(0);
    expect(w.out).toEqual([dir, "2 items"]);
    const batch = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"));
    expect(batch.comments).toHaveLength(2);
    expect(batch.comments[0].screenshot_path).toBe(`shots/${w.c1}.png`);
    expect(readdirSync(join(dir, "shots")).sort()).toEqual([`${w.c1}.png`, `${w.c2}.png`].sort());
    expect(new Uint8Array(readFileSync(join(dir, "shots", `${w.c1}.png`)))).toEqual(PNG);
    const q = readFileSync(join(dir, "queue.md"), "utf8");
    expect(q).toContain(w.c1);
    expect(q).toContain(w.c2);
    expect(q).toContain("> Too small");
    expect(q).toContain("https://greensprings.life/about");
    expect(q).toContain("main > h1");
    expect(q).toContain("phone, 390x844");
    expect(q).toBe(queueMarkdown(batch, dir));
    expect(w.out.join() + w.err.join() + JSON.stringify(batch)).not.toContain(w.env.OWNER_TOKEN);
  });

  it("uses the default folder name, under TTF_HOME/batches", async () => {
    const w = await world();
    expect(await main(["batch", "alexis", "greensprings"], w.ctx)).toBe(0);
    expect(w.out[0]).toBe(join(w.cwd, "ttf-home", "batches", "greensprings-alexis-rivera-20261120-0905"));
  });

  it("defaults to ~/.tap-to-fix/batches without TTF_HOME", async () => {
    const w = await world();
    const ctx = { ...w.ctx, env: { TTF_SERVICE: "http://svc", TTF_OWNER_TOKEN: w.env.OWNER_TOKEN }, home: w.cwd };
    expect(await main(["batch", "alexis", "greensprings"], ctx)).toBe(0);
    expect(w.out[0]).toBe(join(w.cwd, ".tap-to-fix", "batches", "greensprings-alexis-rivera-20261120-0905"));
  });

  it("puts the comment id in each queue item's first line", async () => {
    const w = await world();
    const dir = join(w.cwd, "out");
    await main(["batch", "alexis", "greensprings", "--out", dir], w.ctx);
    const items = readFileSync(join(dir, "queue.md"), "utf8").split("\n").filter((l) => /^\d+\. /.test(l));
    expect(items).toEqual([expect.stringMatching(new RegExp(`^1\\. \\[ttf ${w.c1}\\] `)), expect.stringMatching(new RegExp(`^2\\. \\[ttf ${w.c2}\\] `))]);
  });

  it("marks a screenshot that 404s as missing and still exits 0", async () => {
    const w = await world();
    await w.env.SHOTS.delete(`shots/${w.c2}.png`);
    const dir = join(w.cwd, "out");
    expect(await main(["batch", "alexis", "greensprings", "--out", dir], w.ctx)).toBe(0);
    const batch = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"));
    const second = batch.comments.find((c: { id: string }) => c.id === w.c2);
    expect(second.screenshot).toBe("missing");
    expect(second.screenshot_path).toBeUndefined();
    expect(existsSync(join(dir, "shots", `${w.c2}.png`))).toBe(false);
    expect(w.out[1]).toBe("2 items (1 screenshot missing)");
  });

  it("--from an offline file produces identical output", async () => {
    const w = await world();
    const dir = join(w.cwd, "out");
    await main(["batch", "alexis", "greensprings", "--out", dir], w.ctx);
    const online = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"));
    const queueOnline = readFileSync(join(dir, "queue.md"), "utf8");

    const file = join(w.cwd, "offline.json");
    const raw = (await (
      await app.fetch(
        new Request(`http://svc/api/owner/batch?reviewer=${w.reviewer.id}&site=greensprings`, {
          headers: { Authorization: "Bearer " + w.env.OWNER_TOKEN },
        }),
        w.env,
      )
    ).json()) as Record<string, unknown>;
    const b64 = Buffer.from(PNG).toString("base64");
    writeFileSync(file, JSON.stringify({ ...raw, screenshots: { [w.c1]: { type: "image/png", base64: b64 }, [w.c2]: { type: "image/png", base64: b64 } } }));

    rmSync(dir, { recursive: true });
    const offline = { ...w.ctx, fetchImpl: async () => { throw new TypeError("offline"); }, env: {} };
    expect(await main(["batch", "--from", file, "--out", dir], offline)).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"))).toEqual(online);
    expect(readFileSync(join(dir, "queue.md"), "utf8")).toBe(queueOnline);
    expect(new Uint8Array(readFileSync(join(dir, "shots", `${w.c2}.png`)))).toEqual(PNG);
  });

  it("--from a file with omitted screenshots marks them missing and says how many were left out", async () => {
    const w = await world();
    const file = join(w.cwd, "capped.json");
    const raw = (await (
      await app.fetch(
        new Request(`http://svc/api/owner/batch?reviewer=${w.reviewer.id}&site=greensprings`, { headers: { Authorization: "Bearer " + w.env.OWNER_TOKEN } }),
        w.env,
      )
    ).json()) as { comments: Record<string, unknown>[] };
    const comments = raw.comments.map((c) => ({ ...c, screenshot_omitted: "file size limit" }));
    writeFileSync(file, JSON.stringify({ ...raw, comments, screenshots_omitted: 2, screenshots: {} }));
    const dir = join(w.cwd, "capped");
    w.out.length = 0;
    expect(await main(["batch", "--from", file, "--out", dir], w.ctx)).toBe(0);
    const written = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8"));
    expect(written.comments.every((c: { screenshot: string }) => c.screenshot === "missing")).toBe(true);
    expect(w.out.some((l: string) => /^2 screenshots were left out of the file .*ttf batch once you are online/.test(l))).toBe(true);
  });

  it("exits 2 for an unknown reviewer and 1 without enough arguments", async () => {
    const w = await world();
    expect(await main(["batch", "nobody", "greensprings"], w.ctx)).toBe(2);
    expect(await main(["batch", "alexis"], w.ctx)).toBe(1);
  });

  it("passes --status to the service", async () => {
    const w = await world();
    await w.env.DB.prepare("UPDATE comments SET status = 'done' WHERE id = ?").bind(w.c1).run();
    const dir = join(w.cwd, "out");
    await main(["batch", "alexis", "greensprings", "--out", dir], w.ctx);
    expect(JSON.parse(readFileSync(join(dir, "batch.json"), "utf8")).comments.map((c: { id: string }) => c.id)).toEqual([w.c2]);
    await main(["batch", "alexis", "greensprings", "--out", dir, "--status", "open,done"], w.ctx);
    expect(JSON.parse(readFileSync(join(dir, "batch.json"), "utf8")).comments).toHaveLength(2);
  });

  it("rejects an unsafe comment id in a --from file and warns about --status", async () => {
    const w = await world();
    const file = join(w.cwd, "bad.json");
    writeFileSync(
      file,
      JSON.stringify({ reviewer: { id: "r", name: "R" }, site: { slug: "s", name: "S", origin: "https://x" }, comments: [{ id: "../evil", page: { path: "/", title: "t", url: "u" }, body: "b" }], screenshots: { "../evil": { type: "image/png", base64: "AA==" } } }),
    );
    expect(await main(["batch", "--from", file, "--out", join(w.cwd, "o2"), "--status", "open"], w.ctx)).toBe(1);
    expect(w.err.join()).toContain("Unsafe comment id");
    expect(w.err.join()).toContain("--status is ignored");
    expect(existsSync(join(w.cwd, "evil.png"))).toBe(false);
  });
});
