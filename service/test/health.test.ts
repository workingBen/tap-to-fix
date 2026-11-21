import { describe, expect, it, vi } from "vitest";
import { ownerFetch } from "./helpers";
import { call, makeEnv } from "./env";

describe("scaffold", () => {
  it("answers GET /api/health", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns errors as {error}", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("logs the error and returns a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const env = makeEnv();
      env.DB.prepare = () => {
        throw new Error("boom");
      };
      const res = await ownerFetch(env, "/api/owner/sites");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal error" });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("has the schema tables", async () => {
    const env = makeEnv();
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of ["sites", "reviewers", "assignments", "comments"]) expect(names).toContain(t);
  });
});
