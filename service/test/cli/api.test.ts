import { describe, expect, it } from "vitest";
import app from "../../src/index";
import { makeEnv } from "../env";
import { seedReviewer, seedSite } from "../helpers";
// @ts-expect-error plain .mjs, not type-checked
import { ApiError, NetworkError, client } from "../../../bin/lib/api.mjs";
// @ts-expect-error plain .mjs, not type-checked
import { AmbiguousReviewer, UnknownReviewer } from "../../../bin/lib/reviewers.mjs";
// @ts-expect-error plain .mjs, not type-checked
import { commands, main } from "../../../bin/lib/commands.mjs";

function setup() {
  const env = makeEnv();
  const fetchImpl = (req: Request) => app.fetch(req, env);
  return { env, fetchImpl, cfg: { service: "http://svc", owner_token: env.OWNER_TOKEN } };
}

describe("api client", () => {
  it("returns the overview", async () => {
    const { env, fetchImpl, cfg } = setup();
    const { id } = await seedReviewer(env, "Alexis Rivera");
    const o = await client(cfg, fetchImpl).overview();
    expect(o.reviewers[0]).toMatchObject({ id, name: "Alexis Rivera" });
  });
  it("lists sites and reports 404 screenshots as null", async () => {
    const { env, fetchImpl, cfg } = setup();
    await seedSite(env);
    const c = client(cfg, fetchImpl);
    expect(Array.isArray(await c.sites())).toBe(true);
    expect(await c.screenshot("nope")).toBeNull();
  });
  it("throws ApiError with the service message on a wrong token", async () => {
    const { fetchImpl, cfg } = setup();
    await expect(client({ ...cfg, owner_token: "wrong" }, fetchImpl).overview()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
    await expect(client({ ...cfg, owner_token: "wrong" }, fetchImpl).overview()).rejects.toBeInstanceOf(ApiError);
  });
  it("carries the 400 error text", async () => {
    const { fetchImpl, cfg } = setup();
    await expect(client(cfg, fetchImpl).patch("x", { status: "bogus" })).rejects.toMatchObject({
      status: 400,
      message: "Unknown status",
    });
  });
  it("throws NetworkError without leaking the token", async () => {
    const cfg = { service: "http://svc", owner_token: "secret-token" };
    const e = await client(cfg, async () => {
      throw new TypeError("fetch failed secret-token");
    })
      .overview()
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NetworkError);
    expect((e as Error).message).not.toContain("secret-token");
  });
  it("redacts the token from ApiError messages and rejects non-JSON 2xx", async () => {
    const cfg = { service: "http://svc", owner_token: "secret-token" };
    const bad = await client(cfg, async () => Response.json({ error: "bad secret-token" }, { status: 400 }))
      .overview()
      .catch((x: unknown) => x);
    expect((bad as Error).message).not.toContain("secret-token");
    const html = await client(cfg, async () => new Response("<html>", { status: 200 }))
      .overview()
      .catch((x: unknown) => x);
    expect(html).toBeInstanceOf(ApiError);
  });
});

describe("ttf reviewers", () => {
  it("prints reviewer lines and never the token", async () => {
    const { env, fetchImpl, cfg } = setup();
    await seedReviewer(env, "Alexis Rivera");
    const out: string[] = [];
    const err: string[] = [];
    const ctx = {
      env: { TTF_SERVICE: cfg.service, TTF_OWNER_TOKEN: cfg.owner_token },
      home: "/nonexistent",
      fetchImpl,
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
    };
    expect(await main(["reviewers"], ctx)).toBe(0);
    expect(out[0]).toMatch(/^Alexis Rivera · alexis-rivera · .+ · open 0$/);
    expect(out.join() + err.join()).not.toContain(cfg.owner_token);
    expect(Object.keys(commands)).toContain("reviewers");
  });

  it("exits 2 for ambiguous and unknown reviewers, 1 for other errors", async () => {
    const { fetchImpl, cfg } = setup();
    const err: string[] = [];
    const ctx = {
      env: { TTF_SERVICE: cfg.service, TTF_OWNER_TOKEN: cfg.owner_token },
      home: "/nonexistent",
      fetchImpl,
      out: () => {},
      err: (s: string) => err.push(s),
    };
    // Throwing commands are mapped by main; exercise via a temporary table entry.
    commands.t_amb = { usage: "", summary: "", run: async () => { throw new AmbiguousReviewer("r", [{ id: "1", name: "R A" }]); } };
    commands.t_unk = { usage: "", summary: "", run: async () => { throw new UnknownReviewer("r"); } };
    expect(await main(["t_amb"], ctx)).toBe(2);
    expect(await main(["t_unk"], ctx)).toBe(2);
    delete commands.t_amb;
    delete commands.t_unk;
    expect(await main(["nope"], ctx)).toBe(1);
    expect(await main(["reviewers"], { ...ctx, env: {}, home: "/nonexistent" })).toBe(1);
    expect(await main(["reviewers"], { ...ctx, env: { ...ctx.env, TTF_OWNER_TOKEN: "wrong" } })).toBe(1);
  });
});

describe("a rejected owner token", () => {
  it("batch, status, reviewers and flush all say to re-run setup and exit 1", async () => {
    const { env, fetchImpl, cfg } = setup();
    await seedReviewer(env, "Alexis Rivera");
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = mkdtempSync(join(tmpdir(), "ttf-401-"));
    const dir = join(home, "d");
    mkdirSync(dir);
    writeFileSync(join(dir, "pending-status.jsonl"), JSON.stringify({ id: "c1", body: { status: "done" }, at: "2026-11-20T00:00:00Z" }) + "\n");
    try {
      for (const argv of [["batch", "alexis", "site"], ["status", "c1", "done"], ["reviewers"], ["flush", "--dir", dir]]) {
        const out: string[] = [];
        const err: string[] = [];
        const ctx = {
          env: { TTF_SERVICE: cfg.service, TTF_OWNER_TOKEN: "wrong", TTF_HOME: home },
          home: "/nonexistent",
          fetchImpl,
          out: (x: string) => out.push(x),
          err: (x: string) => err.push(x),
        };
        expect(await main(argv, ctx), argv.join(" ")).toBe(1);
        expect(out.join("\n") + err.join("\n"), argv.join(" ")).toContain("owner token rejected — re-run /tap-to-fix:setup");
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
