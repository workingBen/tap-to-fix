import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { makeEnv } from "./env";
import { newId, newToken, hashToken } from "../src/ids";
import { requireOwner, requireReviewer, type AppBindings } from "../src/auth";

function testApp() {
  const app = new Hono<AppBindings>();
  app.get("/owner", requireOwner, (c) => c.json({ ok: true }));
  app.get("/me", requireReviewer, (c) => c.json(c.get("reviewer")));
  return app;
}

async function seedReviewer(env: ReturnType<typeof makeEnv>, token: string) {
  await env.DB.prepare(
    "INSERT INTO reviewers (id, name, token_hash, revoked_at, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("r1", "Alexis", await hashToken(token), null, "2026-11-20T00:00:00Z")
    .run();
}

describe("ids", () => {
  it("newId is 21 URL-safe chars", () => {
    expect(newId()).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(newId()).not.toBe(newId());
  });
  it("newToken is 43 chars and unique", () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
  });
  it("hashToken is SHA-256 hex", async () => {
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("requireOwner", () => {
  const app = testApp();
  const env = makeEnv();
  const get = (h?: Record<string, string>) =>
    app.fetch(new Request("http://x/owner", { headers: h }), env);
  it("401 without header", async () => expect((await get()).status).toBe(401));
  it("401 with wrong token", async () =>
    expect((await get({ Authorization: "Bearer nope" })).status).toBe(401));
  it("200 with the owner token", async () =>
    expect((await get({ Authorization: "Bearer test-owner-token" })).status).toBe(200));
});

describe("requireReviewer", () => {
  const app = testApp();
  const token = "reviewer-token-1";
  const get = (env: ReturnType<typeof makeEnv>, path: string, h?: Record<string, string>) =>
    app.fetch(new Request("http://x" + path, { headers: h }), env);

  it("401 for an unknown token", async () => {
    const env = makeEnv();
    await seedReviewer(env, token);
    expect((await get(env, "/me", { Authorization: "Bearer other" })).status).toBe(401);
    expect((await get(env, "/me")).status).toBe(401);
  });
  it("200 via header and sets reviewer", async () => {
    const env = makeEnv();
    await seedReviewer(env, token);
    const res = await get(env, "/me", { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "r1", name: "Alexis", token });
  });
  it("200 via ?ttf=", async () => {
    const env = makeEnv();
    await seedReviewer(env, token);
    expect((await get(env, `/me?ttf=${token}`)).status).toBe(200);
  });
  it("401 after revoke", async () => {
    const env = makeEnv();
    await seedReviewer(env, token);
    await env.DB.prepare("UPDATE reviewers SET revoked_at = ? WHERE id = ?")
      .bind("2026-11-20T01:00:00Z", "r1")
      .run();
    expect((await get(env, "/me", { Authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await get(env, `/me?ttf=${token}`)).status).toBe(401);
  });
});
