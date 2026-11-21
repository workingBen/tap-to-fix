import { describe, expect, it } from "vitest";
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

  it("has the schema tables", async () => {
    const env = makeEnv();
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of ["sites", "reviewers", "assignments", "comments"]) expect(names).toContain(t);
  });
});
