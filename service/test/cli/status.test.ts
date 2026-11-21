import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../../src/index";
import { makeEnv } from "../env";
import { seedReviewer, seedSite } from "../helpers";
import { newId } from "../../src/ids";
// @ts-expect-error plain .mjs, not type-checked
import { main } from "../../../bin/lib/commands.mjs";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function world() {
  const env = makeEnv();
  const site = await seedSite(env);
  const reviewer = await seedReviewer(env, "Alexis Rivera");
  const aid = newId();
  await env.DB.prepare("INSERT INTO assignments (id, site_slug, reviewer_id, path, title, created_at) VALUES (?, ?, ?, '/a', 'A', ?)")
    .bind(aid, site.slug, reviewer.id, new Date().toISOString())
    .run();
  const id = newId();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO comments (id, assignment_id, body, status, created_at, status_changed_at) VALUES (?, ?, 'b', 'open', ?, ?)")
    .bind(id, aid, now, now)
    .run();
  const cwd = mkdtempSync(join(tmpdir(), "ttf-status-"));
  tmps.push(cwd);
  const dir = join(cwd, ".tap-to-fix", "greensprings-alexis-rivera-20261120-0905");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "batch.json"), "{}");
  const out: string[] = [];
  const err: string[] = [];
  let online = true;
  const ctx = {
    env: { TTF_SERVICE: "http://svc", TTF_OWNER_TOKEN: env.OWNER_TOKEN },
    home: "/nonexistent",
    cwd,
    fetchImpl: async (req: Request) => {
      if (!online) throw new TypeError("fetch failed " + env.OWNER_TOKEN);
      return app.fetch(req, env);
    },
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  };
  const batchStatus = async () => {
    const res = await app.fetch(
      new Request(`http://svc/api/owner/batch?reviewer=${reviewer.id}&site=greensprings&status=open,in_progress,done,later,kept`, {
        headers: { Authorization: "Bearer " + env.OWNER_TOKEN },
      }),
      env,
    );
    return ((await res.json()) as { comments: { id: string; status: string }[] }).comments.find((c: { id: string }) => c.id === id);
  };
  return { env, id, dir, out, err, ctx, batchStatus, setOnline: (v: boolean) => (online = v) };
}

describe("ttf status", () => {
  it("done --pr updates the comment", async () => {
    const w = await world();
    expect(await main(["status", w.id, "done", "--pr", "https://github.com/x/y/pull/1"], w.ctx)).toBe(0);
    expect((await w.batchStatus())?.status).toBe("done");
  });

  it("later without a note exits 1 with the API message", async () => {
    const w = await world();
    expect(await main(["status", w.id, "later"], w.ctx)).toBe(1);
    expect(w.err.join()).toContain("A note is required for later and kept");
    expect(await main(["status", w.id, "bogus"], w.ctx)).toBe(1);
    expect(await main(["status", w.id, "done", "--pr", "not-a-url"], w.ctx)).toBe(1);
    expect(await main(["status", w.id, "later", "--note", "next sprint"], w.ctx)).toBe(0);
    expect((await w.batchStatus())?.status).toBe("later");
  });

  it("queues offline in the newest batch dir, then flush sends it", async () => {
    const w = await world();
    w.setOnline(false);
    expect(await main(["status", w.id, "in_progress"], w.ctx)).toBe(0);
    expect(w.out[0]).toMatch(/^Queued \(offline\)/);
    const file = join(w.dir, "pending-status.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: w.id, body: { status: "in_progress" } });
    expect(typeof lines[0].at).toBe("string");
    expect(readFileSync(file, "utf8")).not.toContain(w.env.OWNER_TOKEN);
    expect(w.out.join() + w.err.join()).not.toContain(w.env.OWNER_TOKEN);

    // still offline: flush keeps the line
    expect(await main(["flush"], w.ctx)).toBe(1);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);

    w.setOnline(true);
    expect(await main(["flush", "--dir", w.dir], w.ctx)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("");
    expect((await w.batchStatus())?.status).toBe("in_progress");
  });

  it("flush reports and drops a 404, and keeps sending the rest in order", async () => {
    const w = await world();
    w.setOnline(false);
    await main(["status", "gone-id", "done", "--dir", w.dir], w.ctx);
    await main(["status", w.id, "done", "--dir", w.dir], w.ctx);
    w.setOnline(true);
    expect(await main(["flush", "--dir", w.dir], w.ctx)).toBe(0);
    expect(w.err.join()).toContain("Rejected gone-id: 404");
    const rej = readFileSync(join(w.dir, "rejected-status.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rej).toHaveLength(1);
    expect(rej[0]).toMatchObject({ id: "gone-id", reason: expect.stringContaining("404") });
    expect(readFileSync(join(w.dir, "pending-status.jsonl"), "utf8")).toBe("");
    expect((await w.batchStatus())?.status).toBe("done");
  });

  it("offline with no batch folder is an error, not a silent loss", async () => {
    const w = await world();
    w.setOnline(false);
    rmSync(w.dir, { recursive: true });
    expect(await main(["status", w.id, "done"], w.ctx)).toBe(1);
    expect(w.err.join()).toContain("--dir");
  });

  it("validates offline too: nothing is queued for an invalid change", async () => {
    const w = await world();
    w.setOnline(false);
    expect(await main(["status", w.id, "later"], w.ctx)).toBe(1);
    expect(await main(["status", w.id, "kept", "--note", "  "], w.ctx)).toBe(1);
    expect(existsSync(join(w.dir, "pending-status.jsonl"))).toBe(false);
  });

  it.each([
    [401, "owner token rejected"],
    [429, "429"],
    [503, "503"],
  ])("keeps queued lines when the service answers %i", async (code, why) => {
    const w = await world();
    w.setOnline(false);
    await main(["status", w.id, "done", "--dir", w.dir], w.ctx);
    await main(["status", w.id, "in_progress", "--dir", w.dir], w.ctx);
    const file = join(w.dir, "pending-status.jsonl");
    const before = readFileSync(file, "utf8");
    const ctx = { ...w.ctx, fetchImpl: async () => Response.json({ error: "nope" }, { status: code }) };
    expect(await main(["flush", "--dir", w.dir], ctx)).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(w.dir, "rejected-status.jsonl"))).toBe(false);
    expect(w.err.join()).toContain(why);
  });

  it("a mid-flush network failure keeps that line and the ones after it, in order", async () => {
    const w = await world();
    w.setOnline(false);
    for (const st of ["in_progress", "done", "in_progress"]) await main(["status", w.id, st, "--dir", w.dir], w.ctx);
    w.setOnline(true);
    let n = 0;
    const ctx = {
      ...w.ctx,
      fetchImpl: async (req: Request) => {
        if (++n > 1) throw new TypeError("down");
        return w.ctx.fetchImpl(req);
      },
    };
    expect(await main(["flush", "--dir", w.dir], ctx)).toBe(1);
    const left = readFileSync(join(w.dir, "pending-status.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).body.status);
    expect(left).toEqual(["done", "in_progress"]);
  });

  it("status queues into the dir holding the comment; flush with no --dir flushes every dir", async () => {
    const w = await world();
    const root = join(w.dir, "..");
    const newer = join(root, "other-20261121-0900");
    mkdirSync(newer);
    writeFileSync(join(newer, "batch.json"), JSON.stringify({ comments: [{ id: "zzz" }] }));
    writeFileSync(join(w.dir, "batch.json"), JSON.stringify({ comments: [{ id: w.id }] }));
    utimesSync(join(w.dir, "batch.json"), new Date(2026, 10, 20), new Date(2026, 10, 20));
    utimesSync(join(newer, "batch.json"), new Date(2026, 10, 21), new Date(2026, 10, 21));
    w.setOnline(false);
    await main(["status", w.id, "done"], w.ctx);
    expect(existsSync(join(w.dir, "pending-status.jsonl"))).toBe(true);
    expect(existsSync(join(newer, "pending-status.jsonl"))).toBe(false);
    await main(["status", "zzz", "done"], w.ctx); // unknown id: falls back to newest dir
    expect(existsSync(join(newer, "pending-status.jsonl"))).toBe(true);
    w.setOnline(true);
    w.out.length = 0;
    expect(await main(["flush"], w.ctx)).toBe(0); // zzz is a 404: rejected and recorded; nothing left
    expect(w.out.some((l) => l.startsWith(w.dir))).toBe(true);
    expect(w.out.some((l) => l.startsWith(newer))).toBe(true);
    expect((await w.batchStatus())?.status).toBe("done");
  });
});
