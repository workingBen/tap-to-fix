import { describe, expect, it, vi } from "vitest";
import { openToken, sealToken } from "../src/linkcrypt";
import { makeEnv, TEST_LINK_KEY } from "./env";
import { ownerFetch, reviewerFetch, seedReviewer } from "./helpers";
import { call } from "./env";
import type { Env } from "../src/env";

const post = (env: Env, path: string, body?: unknown) =>
  ownerFetch(env, path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = any>(res: Response) => (await res.json()) as T; // eslint-disable-line @typescript-eslint/no-explicit-any
type Reviewer = { id: string; name: string; token: string };

describe("linkcrypt", () => {
  it("seals and opens a token with the same key and reviewer id", async () => {
    const sealed = await sealToken(TEST_LINK_KEY, "r1", "tok-abc");
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("tok-abc");
    expect(await openToken(TEST_LINK_KEY, "r1", sealed!)).toBe("tok-abc");
  });

  it("uses a fresh IV each time", async () => {
    expect(await sealToken(TEST_LINK_KEY, "r1", "t")).not.toBe(await sealToken(TEST_LINK_KEY, "r1", "t"));
  });

  it("will not open under another reviewer id, another key, or tampered text", async () => {
    const sealed = (await sealToken(TEST_LINK_KEY, "r1", "tok"))!;
    expect(await openToken(TEST_LINK_KEY, "r2", sealed)).toBeNull();
    const other = "B".repeat(43);
    expect(await openToken(other, "r1", sealed)).toBeNull();
    // Change one character in the middle (the last ones can carry base64 padding bits), always to a different one.
    const i = 10;
    const flipped = sealed.slice(0, i) + (sealed[i] === "A" ? "B" : "A") + sealed.slice(i + 1);
    expect(flipped).not.toBe(sealed);
    expect(await openToken(TEST_LINK_KEY, "r1", flipped)).toBeNull();
    expect(await openToken(TEST_LINK_KEY, "r1", "garbage")).toBeNull();
  });

  it("a missing or malformed key seals nothing", async () => {
    expect(await sealToken(undefined, "r1", "t")).toBeNull();
    expect(await sealToken("", "r1", "t")).toBeNull();
    expect(await sealToken("too-short", "r1", "t")).toBeNull();
  });
});

describe("GET /api/owner/reviewers/:id/link", () => {
  it("returns the reviewer link made on create, and it signs the reviewer in", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Alexis" }));
    const res = await ownerFetch(env, `/api/owner/reviewers/${r.id}/link`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ url: `http://x/r/#ttf=${r.token}` });
    expect((await reviewerFetch(env, r.token, "/api/me")).status).toBe(200);
  });

  it("returns the new link after a reissue", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Alexis" }));
    const again = await json<Reviewer>(await post(env, `/api/owner/reviewers/${r.id}/reissue`));
    const { url } = await json<{ url: string }>(await ownerFetch(env, `/api/owner/reviewers/${r.id}/link`));
    expect(url).toBe(`http://x/r/#ttf=${again.token}`);
    expect(url).not.toContain(r.token);
  });

  it("stores only the sealed token, never the token itself", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Alexis" }));
    const row = await env.DB.prepare("SELECT * FROM reviewers WHERE id = ?").bind(r.id).first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(r.token);
    expect(String(row!.token_enc)).toMatch(/^v1:/);
  });

  it("a reviewer made before links were stored: 409 not_stored", async () => {
    const env = makeEnv();
    const old = await seedReviewer(env, "Old");
    const res = await ownerFetch(env, `/api/owner/reviewers/${old.id}/link`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not_stored" });
  });

  it("a turned-off link is not handed out, and New link brings it back", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Alexis" }));
    await post(env, `/api/owner/reviewers/${r.id}/revoke`);
    const res = await ownerFetch(env, `/api/owner/reviewers/${r.id}/link`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "revoked" });
    const row = await env.DB.prepare("SELECT token_enc FROM reviewers WHERE id = ?").bind(r.id).first<{ token_enc: string | null }>();
    expect(row!.token_enc).toBeNull();
    const again = await json<Reviewer>(await post(env, `/api/owner/reviewers/${r.id}/reissue`));
    expect(await json(await ownerFetch(env, `/api/owner/reviewers/${r.id}/link`))).toEqual({ url: `http://x/r/#ttf=${again.token}` });
  });

  it("a key that changed since the link was stored: 409 not_stored", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Alexis" }));
    const rotated = { ...env, LINK_KEY: "C".repeat(43) };
    const res = await ownerFetch(rotated, `/api/owner/reviewers/${r.id}/link`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not_stored" });
  });

  it("no LINK_KEY on the service: create still works, the link answers 503 no_key", async () => {
    const env = { ...makeEnv(), LINK_KEY: undefined };
    const created = await post(env, "/api/owner/reviewers", { name: "Alexis" });
    expect(created.status).toBe(201);
    const r = await json<Reviewer>(created);
    const res = await ownerFetch(env, `/api/owner/reviewers/${r.id}/link`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "no_key" });
  });

  it("unknown reviewer: 404", async () => {
    expect((await ownerFetch(makeEnv(), "/api/owner/reviewers/nope/link")).status).toBe(404);
  });

  it("needs the owner token: a reviewer token or none gets 401", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Alexis" }));
    expect((await call(`/api/owner/reviewers/${r.id}/link`, {}, env)).status).toBe(401);
    expect((await reviewerFetch(env, r.token, `/api/owner/reviewers/${r.id}/link`)).status).toBe(401);
  });

  it("the overview and the reviewer's own dashboard never carry a token or the sealed text", async () => {
    const env = makeEnv();
    const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Alexis" }));
    const row = await env.DB.prepare("SELECT token_enc FROM reviewers WHERE id = ?").bind(r.id).first<{ token_enc: string }>();
    for (const res of [await ownerFetch(env, "/api/owner/overview"), await reviewerFetch(env, r.token, "/api/me")]) {
      const text = await res.text();
      expect(text).not.toContain(r.token);
      expect(text).not.toContain(row!.token_enc);
      expect(text).not.toContain("token_enc");
    }
  });

  it("nothing is logged while making, reissuing and fetching links", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const env = makeEnv();
      const r = await json<Reviewer>(await post(env, "/api/owner/reviewers", { name: "Alexis" }));
      await post(env, `/api/owner/reviewers/${r.id}/reissue`);
      await ownerFetch(env, `/api/owner/reviewers/${r.id}/link`);
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
