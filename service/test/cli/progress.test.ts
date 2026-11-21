import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../../src/index";
import { makeEnv } from "../env";
import { seedReviewer, seedSite } from "../helpers";
import { newId } from "../../src/ids";
import type { Env } from "../../src/env";
// @ts-expect-error plain .mjs, not type-checked
import { main } from "../../../bin/lib/commands.mjs";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function seedComments(env: Env, siteSlug: string, reviewerId: string, bodies: string[]) {
  const aid = newId();
  await env.DB.prepare("INSERT INTO assignments (id, site_slug, reviewer_id, path, title, created_at) VALUES (?, ?, ?, '/about', 'About', ?)")
    .bind(aid, siteSlug, reviewerId, new Date().toISOString())
    .run();
  const ids: string[] = [];
  for (const [i, body] of bodies.entries()) {
    const id = newId();
    const at = `2026-11-0${i + 1}T00:00:00Z`;
    await env.DB.prepare("INSERT INTO comments (id, assignment_id, body, status, created_at, status_changed_at) VALUES (?, ?, ?, 'open', ?, ?)")
      .bind(id, aid, body, at, at)
      .run();
    ids.push(id);
  }
  return ids;
}

async function world() {
  const env = makeEnv();
  const site = await seedSite(env);
  const reviewer = await seedReviewer(env, "Alexis Rivera");
  const ids = await seedComments(env, site.slug, reviewer.id, ["Too small", "Wrong color", "Typo here", "Broken link"]);
  const home = mkdtempSync(join(tmpdir(), "ttf-progress-"));
  tmps.push(home);
  const out: string[] = [];
  const err: string[] = [];
  let online = true;
  const ctx = {
    env: { TTF_SERVICE: "http://svc", TTF_OWNER_TOKEN: env.OWNER_TOKEN, TTF_HOME: home },
    home: "/nonexistent",
    now: () => new Date(2026, 10, 20, 9, 5),
    fetchImpl: async (req: Request) => {
      if (!online) throw new TypeError("fetch failed");
      return app.fetch(req, env);
    },
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  };
  expect(await main(["batch", "alexis", site.slug], ctx)).toBe(0);
  const dir = out[0];
  out.length = 0;
  return { env, site, reviewer, ids, home, dir, out, err, ctx, setOnline: (v: boolean) => (online = v) };
}

const line = (out: string[], id: string) => out.find((l) => l.startsWith(id + " · "));

describe("ttf progress", () => {
  it("prints the folder, the queue and every comment's last known status, offline", async () => {
    const w = await world();
    const [a, b, c, d] = w.ids;
    expect(await main(["status", a, "in_progress"], w.ctx)).toBe(0);
    expect(await main(["status", a, "done", "--pr", "https://github.com/x/y/pull/9"], w.ctx)).toBe(0);
    expect(await main(["status", b, "later", "--note", "Next month"], w.ctx)).toBe(0);
    w.setOnline(false);
    expect(await main(["status", c, "in_progress"], w.ctx)).toBe(0); // queued offline
    w.out.length = 0;

    expect(await main(["progress", "alexis", w.site.slug], w.ctx)).toBe(0); // still offline: no network needed
    expect(w.out[0]).toBe(`Folder: ${w.dir}`);
    expect(w.out[1]).toBe(`Queue: ${join(w.dir, "queue.md")}`);
    expect(line(w.out, a)).toMatch(/· done · final · https:\/\/github\.com\/x\/y\/pull\/9 · \/about · Too small$/);
    expect(line(w.out, b)).toMatch(/· later · final · note: Next month · /);
    expect(line(w.out, c)).toMatch(/· in_progress · not final · queued offline · /);
    expect(line(w.out, d)).toMatch(/· open · not final · \/about · Broken link$/);
    expect(w.out.at(-1)).toBe("4 comments, 2 not final.");
    expect(w.out.join("\n")).not.toContain(w.env.OWNER_TOKEN);
  });

  it("status-log.jsonl records sent and queued changes; flush logs the send", async () => {
    const w = await world();
    const [a] = w.ids;
    w.setOnline(false);
    await main(["status", a, "kept", "--note", "Intended"], w.ctx);
    w.setOnline(true);
    expect(await main(["flush"], w.ctx)).toBe(0);
    const log = readFileSync(join(w.dir, "status-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.map((e) => [e.id, e.status, e.state])).toEqual([
      [a, "kept", "queued"],
      [a, "kept", "sent"],
    ]);
    w.out.length = 0;
    await main(["progress", "alexis", w.site.slug], w.ctx);
    expect(line(w.out, a)).toMatch(/· kept · final · note: Intended · /);
  });

  it("a queued change that flush rejected does not count", async () => {
    const w = await world();
    const [a] = w.ids;
    await main(["status", a, "in_progress"], w.ctx);
    w.setOnline(false);
    await main(["status", a, "done"], w.ctx);
    w.setOnline(true);
    await w.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(a).run(); // the flush gets a 404
    expect(await main(["flush"], w.ctx)).toBe(0);
    w.out.length = 0;
    await main(["progress", "alexis", w.site.slug], w.ctx);
    expect(line(w.out, a)).toMatch(/· in_progress · not final · /);
  });

  it("uses the newest folder for that reviewer and site", async () => {
    const w = await world();
    const newer = join(w.home, "batches", "greensprings-alexis-rivera-20261121-0900");
    mkdirSync(newer);
    const batch = JSON.parse(readFileSync(join(w.dir, "batch.json"), "utf8"));
    writeFileSync(join(newer, "batch.json"), JSON.stringify({ ...batch, comments: batch.comments.slice(0, 1) }));
    utimesSync(join(w.dir, "batch.json"), new Date(2026, 10, 20), new Date(2026, 10, 20));
    utimesSync(join(newer, "batch.json"), new Date(2026, 10, 21), new Date(2026, 10, 21));
    await main(["progress", "alexis-rivera", w.site.slug], w.ctx);
    expect(w.out[0]).toBe(`Folder: ${newer}`);
    expect(w.out.at(-1)).toBe("1 comment, 1 not final.");
  });

  it("exits 2 for an ambiguous reviewer and 1 when no folder matches", async () => {
    const w = await world();
    const other = await seedReviewer(w.env, "Alexis Smith");
    await seedComments(w.env, w.site.slug, other.id, ["Hi"]);
    w.ctx.now = () => new Date(2026, 10, 20, 9, 6);
    expect(await main(["batch", other.id, w.site.slug], w.ctx)).toBe(0);
    expect(await main(["progress", "alexis", w.site.slug], w.ctx)).toBe(2);
    expect(w.err.join("\n")).toContain("alexis-smith");
    expect(await main(["progress", "alexis", "no-such-site"], w.ctx)).toBe(1);
    expect(w.err.at(-1)).toContain("No batch folder");
    expect(await main(["progress", "alexis"], w.ctx)).toBe(1);
  });
});
