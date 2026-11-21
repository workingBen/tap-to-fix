import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { requireReviewer, type AppBindings } from "../src/auth";
import { makeEnv } from "./env";
import { call } from "./env";
import { ownerFetch } from "./helpers";
import type { Env } from "../src/env";

const probe = new Hono<AppBindings>();
probe.get("/probe", requireReviewer, (c) => c.json({ id: c.get("reviewer").id }));
const asReviewer = (env: Env, token: string) =>
  probe.fetch(new Request("http://x/probe", { headers: { Authorization: "Bearer " + token } }), env);

const post = (env: Env, path: string, body?: unknown) =>
  ownerFetch(env, path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

const site = { slug: "gs", name: "Greensprings", origin: "https://greensprings.life", repo: "workingBen/longevity-tracker" };

type Reviewer = { id: string; name: string; token: string };
const json = async <T = any>(res: Response) => (await res.json()) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("owner sites", () => {
  it("creates a site then lists it", async () => {
    const env = makeEnv();
    const res = await post(env, "/api/owner/sites", site);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject(site);
    const list = await json<unknown[] & Record<string, unknown>[]>(await ownerFetch(env, "/api/owner/sites"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject(site);
  });

  it("rejects a duplicate slug with 409", async () => {
    const env = makeEnv();
    await post(env, "/api/owner/sites", site);
    expect((await post(env, "/api/owner/sites", site)).status).toBe(409);
  });

  it("rejects an origin that is not https", async () => {
    const env = makeEnv();
    for (const origin of ["greensprings.life", "http://greensprings.life", "https://greensprings.life/path"]) {
      expect((await post(env, "/api/owner/sites", { ...site, origin })).status).toBe(400);
    }
  });

  it("allows http://localhost with a port", async () => {
    const env = makeEnv();
    const res = await post(env, "/api/owner/sites", { ...site, origin: "http://localhost:3000" });
    expect(res.status).toBe(201);
  });

  it("rejects missing fields", async () => {
    const env = makeEnv();
    expect((await post(env, "/api/owner/sites", { slug: "x" })).status).toBe(400);
  });
});

describe("owner reviewers", () => {
  it("creates a reviewer whose 43-char token passes requireReviewer", async () => {
    const env = makeEnv();
    const res = await post(env, "/api/owner/reviewers", { name: "Chris" });
    expect(res.status).toBe(201);
    const r = await json<Reviewer>(res);
    expect(r.name).toBe("Chris");
    expect(r.token).toHaveLength(43);
    const ok = await asReviewer(env, r.token);
    expect(ok.status).toBe(200);
    expect((await json<{ id: string }>(ok)).id).toBe(r.id);
  });

  it("reissue kills the old token and the new one works", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Chris" }));
    const res = await post(env, `/api/owner/reviewers/${r.id}/reissue`);
    expect(res.status).toBe(200);
    const again = await json<Reviewer>(res);
    expect(again.id).toBe(r.id);
    expect(again.token).not.toBe(r.token);
    expect((await asReviewer(env, r.token)).status).toBe(401);
    expect((await asReviewer(env, again.token)).status).toBe(200);
  });

  it("revoke returns 204 and the token stops working", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Chris" }));
    expect((await post(env, `/api/owner/reviewers/${r.id}/revoke`)).status).toBe(204);
    expect((await asReviewer(env, r.token)).status).toBe(401);
  });

  it("returns 404 for an unknown reviewer id", async () => {
    const env = makeEnv();
    expect((await post(env, "/api/owner/reviewers/nope/reissue")).status).toBe(404);
    expect((await post(env, "/api/owner/reviewers/nope/revoke")).status).toBe(404);
  });

  it("requires a name", async () => {
    expect((await post(makeEnv(), "/api/owner/reviewers", {})).status).toBe(400);
  });
});

describe("owner auth", () => {
  it("every route is 401 without the owner token", async () => {
    const env = makeEnv();
    const routes: [string, string][] = [
      ["POST", "/api/owner/sites"],
      ["GET", "/api/owner/sites"],
      ["POST", "/api/owner/reviewers"],
      ["POST", "/api/owner/reviewers/x/reissue"],
      ["POST", "/api/owner/reviewers/x/revoke"],
    ];
    for (const [method, path] of routes) {
      const res = await call(path, { method, body: method === "POST" ? "{}" : undefined }, env);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
