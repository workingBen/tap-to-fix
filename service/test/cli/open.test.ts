import { describe, expect, it } from "vitest";
import app from "../../src/index";
import { makeEnv } from "../env";
import { seedReviewer, seedSite } from "../helpers";
import { newId } from "../../src/ids";
import type { Env } from "../../src/env";
// @ts-expect-error plain .mjs, not type-checked
import { main } from "../../../bin/lib/commands.mjs";
// @ts-expect-error plain .mjs, not type-checked
import { age, snippet } from "../../../bin/lib/open.mjs";

const NOW = new Date("2026-11-21T12:00:00Z");

async function seedAssignment(env: Env, siteSlug: string, reviewerId: string, path: string) {
  const id = newId();
  await env.DB.prepare("INSERT INTO assignments (id, site_slug, reviewer_id, path, title, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, siteSlug, reviewerId, path, "Title " + path, new Date().toISOString())
    .run();
  return id;
}

async function seedComment(env: Env, assignmentId: string, body: string, status: string, at: string) {
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO comments (id, assignment_id, body, status, viewport_w, viewport_h, device, created_at, status_changed_at) VALUES (?, ?, ?, ?, 390, 844, 'phone', ?, ?)",
  )
    .bind(id, assignmentId, body, status, at, at)
    .run();
  return id;
}

function ctxFor(env: Env) {
  const out: string[] = [];
  const err: string[] = [];
  const ctx = {
    env: { TTF_SERVICE: "http://svc", TTF_OWNER_TOKEN: env.OWNER_TOKEN },
    home: "/nonexistent",
    now: () => NOW,
    fetchImpl: (req: Request) => app.fetch(req, env),
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  };
  return { ctx, out, err };
}

async function world() {
  const env = makeEnv();
  await seedSite(env);
  await seedSite(env, { slug: "bonus-decade", name: "Bonus Decade", origin: "https://bonusdecade.com" });
  const alexis = await seedReviewer(env, "Alexis Rivera");
  const ben = await seedReviewer(env, "Ben Pellow");
  const rAbout = await seedAssignment(env, "greensprings", alexis.id, "/about");
  const rHome = await seedAssignment(env, "greensprings", alexis.id, "/");
  const rBonus = await seedAssignment(env, "bonus-decade", alexis.id, "/pricing");
  const bAbout = await seedAssignment(env, "greensprings", ben.id, "/about");
  await seedComment(env, rAbout, "The heading is far too small on a phone and the line wraps badly under the photo", "open", "2026-11-21T09:00:00Z");
  await seedComment(env, rAbout, "Wrong color", "in_progress", "2026-11-19T12:00:00Z");
  await seedComment(env, rAbout, "Already fixed", "done", "2026-11-18T12:00:00Z");
  await seedComment(env, rHome, "Logo\nis blurry", "open", "2026-11-21T11:55:00Z");
  await seedComment(env, rBonus, "Typo in the price", "open", "2026-11-20T12:00:00Z");
  await seedComment(env, bAbout, "Saved for later", "later", "2026-11-20T12:00:00Z");
  return { env, alexis, ben };
}

describe("ttf open helpers", () => {
  it("ages in plain words", () => {
    expect(age("2026-11-21T11:59:40Z", NOW)).toBe("just now");
    expect(age("2026-11-21T11:55:00Z", NOW)).toBe("5 min ago");
    expect(age("2026-11-21T09:00:00Z", NOW)).toBe("3 h ago");
    expect(age("2026-11-20T12:00:00Z", NOW)).toBe("1 day ago");
    expect(age("2026-11-07T12:00:00Z", NOW)).toBe("14 days ago");
    expect(age("not a date", NOW)).toBe("");
  });

  it("snippets one line of about 60 characters, without control characters", () => {
    expect(snippet("Logo\nis\tblurry")).toBe("Logo is blurry");
    const long = snippet("a".repeat(100));
    expect(long.length).toBe(60);
    expect(long.endsWith("…")).toBe(true);
    expect(snippet("bell\u0007 and \u001b[31mred")).toBe("bell and [31mred");
  });
});

describe("ttf open", () => {
  it("lists unsettled comments by reviewer, site and page, with the command to run", async () => {
    const w = await world();
    const { ctx, out, err } = ctxFor(w.env);
    expect(await main(["open"], ctx)).toBe(0);
    expect(err).toEqual([]);
    const text = out.join("\n");
    expect(text).toBe(
      [
        "Alexis Rivera · Greensprings (greensprings) · 3 waiting",
        "  /about",
        "    in progress  2 days ago   Wrong color",
        "    open         3 h ago      The heading is far too small on a phone and the line wraps …",
        "  /",
        "    open         5 min ago    Logo is blurry",
        "  Run: /tap-to-fix:fix alexis greensprings",
        "",
        "Alexis Rivera · Bonus Decade (bonus-decade) · 1 waiting",
        "  /pricing",
        "    open         1 day ago    Typo in the price",
        "  Run: /tap-to-fix:fix alexis bonus-decade",
        "",
        "4 comments waiting in 2 batches.",
      ].join("\n"),
    );
    expect(text).not.toContain("Already fixed");
    expect(text).not.toContain("Saved for later");
    expect(text).not.toContain(w.env.OWNER_TOKEN);
  });

  it("puts the batch with the most comments first", async () => {
    const w = await world();
    const bHome = await seedAssignment(w.env, "bonus-decade", w.ben.id, "/");
    for (let i = 0; i < 5; i++) await seedComment(w.env, bHome, "Ben note " + i, "open", "2026-11-21T10:00:00Z");
    const { ctx, out } = ctxFor(w.env);
    expect(await main(["open"], ctx)).toBe(0);
    const headers = out.filter((l) => / waiting$/.test(l));
    expect(headers).toEqual([
      "Ben Pellow · Bonus Decade (bonus-decade) · 5 waiting",
      "Alexis Rivera · Greensprings (greensprings) · 3 waiting",
      "Alexis Rivera · Bonus Decade (bonus-decade) · 1 waiting",
    ]);
    expect(out).toContain("  Run: /tap-to-fix:fix ben bonus-decade");
  });

  it("filters to one reviewer", async () => {
    const w = await world();
    const bHome = await seedAssignment(w.env, "bonus-decade", w.ben.id, "/");
    await seedComment(w.env, bHome, "Ben note", "open", "2026-11-21T10:00:00Z");
    const { ctx, out } = ctxFor(w.env);
    expect(await main(["open", "ben"], ctx)).toBe(0);
    expect(out[0]).toBe("Ben Pellow · Bonus Decade (bonus-decade) · 1 waiting");
    expect(out.join("\n")).not.toContain("Alexis");
    expect(out[out.length - 1]).toBe("1 comment waiting in 1 batch.");
  });

  it("says Nothing waiting when everything is settled", async () => {
    const env = makeEnv();
    await seedSite(env);
    const r = await seedReviewer(env, "Alexis Rivera");
    const a = await seedAssignment(env, "greensprings", r.id, "/about");
    await seedComment(env, a, "Done one", "done", "2026-11-20T12:00:00Z");
    await seedComment(env, a, "Kept one", "kept", "2026-11-20T12:00:00Z");
    const { ctx, out } = ctxFor(env);
    expect(await main(["open"], ctx)).toBe(0);
    expect(out).toEqual(["Nothing waiting: every comment is settled."]);
    const one = ctxFor(env);
    expect(await main(["open", "alexis"], one.ctx)).toBe(0);
    expect(one.out).toEqual(["Nothing waiting for Alexis Rivera."]);
  });

  it("exits 2 for an unknown reviewer and 1 without a config", async () => {
    const w = await world();
    const { ctx, err } = ctxFor(w.env);
    expect(await main(["open", "zed"], ctx)).toBe(2);
    expect(err.join("\n")).toContain("zed");
    const bare = ctxFor(w.env);
    expect(await main(["open"], { ...bare.ctx, env: {} })).toBe(1);
  });
});
