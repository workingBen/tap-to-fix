// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, escapeHtml, progressRing, readToken } from "../../client/dash/common";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/r/");
});

describe("readToken", () => {
  it("prefers the hash and stores it", () => {
    window.localStorage.setItem("k", "old");
    window.location.hash = "#ttf=abc";
    expect(readToken(window, "ttf", "k")).toBe("abc");
    expect(window.localStorage.getItem("k")).toBe("abc");
  });
  it("falls back to storage", () => {
    window.localStorage.setItem("k", "kept");
    expect(readToken(window, "ttf", "k")).toBe("kept");
  });
  it("returns null with nothing", () => {
    expect(readToken(window, "owner", "k")).toBeNull();
  });
  it("still returns the hash token when storage throws", () => {
    window.location.hash = "#owner=xyz";
    const fake = {
      location: window.location,
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    } as unknown as Window;
    expect(readToken(fake, "owner", "k")).toBe("xyz");
  });
});

describe("escapeHtml", () => {
  it("escapes & < > \" '", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("progressRing", () => {
  it("has no arc at 0", () => {
    const s = progressRing(0);
    expect(s).not.toContain("<path");
    expect(s).toContain('aria-label="0% settled"');
  });
  it("is a full circle at 1", () => {
    const s = progressRing(1);
    expect(s).not.toContain("<path");
    expect(s.match(/<circle/g)?.length).toBe(2);
    expect(s).toContain("var(--acc)");
  });
  it("labels the percentage", () => {
    const s = progressRing(0.5);
    expect(s).toContain('aria-label="50% settled"');
    expect(s).toContain("<path");
  });
});

describe("api", () => {
  it("sends Bearer and JSON, returns data", async () => {
    const f = vi.fn(async () => new Response('{"a":1}', { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await api<{ a: number }>("tok", "/api/me", { method: "POST", json: { x: 1 } });
    expect(r).toEqual({ ok: true, data: { a: 1 } });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok");
    expect(init.body).toBe('{"x":1}');
  });
  it("reports status on failure and 0 on network error", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    expect(await api("t", "/x")).toEqual({ ok: false, status: 401 });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("net");
    });
    expect(await api("t", "/x")).toEqual({ ok: false, status: 0 });
  });
  it("passes on the service's error message and code", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":"Made before","code":"not_stored"}', { status: 409 }));
    expect(await api("t", "/x")).toEqual({ ok: false, status: 409, error: "Made before", code: "not_stored" });
  });
});
