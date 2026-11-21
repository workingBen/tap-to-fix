import { describe, expect, it } from "vitest";
import app from "../../src/index";
import { makeEnv } from "../env";
import { seedReviewer, seedSite } from "../helpers";
// @ts-expect-error plain .mjs, not type-checked
import { ApiError, NetworkError, client } from "../../../bin/lib/api.mjs";
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
  });
});

describe("ttf reviewers", () => {
  it("prints lines, never the token, and exits 2 for unknown commands' reviewers", async () => {
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
});
