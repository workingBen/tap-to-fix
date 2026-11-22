// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "../../client/loader";

function setup(search: string, siteAttr: string | null = "acme") {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/page" + search);
  const s = document.createElement("script");
  s.type = "text/plain"; // never fetched
  s.src = "https://svc.example.com/t.js";
  if (siteAttr !== null) s.setAttribute("data-site", siteAttr);
  document.head.appendChild(s);
  const start = vi.fn();
  const load = vi.fn(async (_u: string) => ({ start }));
  return { load, start };
}

describe("loader boot", () => {
  beforeEach(() => sessionStorage.clear());

  it("no token: returns false, loads nothing, adds nothing, stores nothing", () => {
    const { load } = setup("");
    const before = document.documentElement.outerHTML;
    expect(boot(document, window, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(document.documentElement.outerHTML).toBe(before);
    expect(sessionStorage.length).toBe(0);
  });

  it("query token: stripped from the address bar but never used (the site's server already logged it)", () => {
    const { load } = setup("?ttf=abc&x=1#h");
    expect(boot(document, window, load)).toBe(false);
    expect(sessionStorage.getItem("ttf:token")).toBeNull();
    expect(location.search + location.hash).toBe("?x=1#h");
    expect(load).not.toHaveBeenCalled();
  });

  it("fragment token: read from #ttf=, stripped, other hash and query parts kept", async () => {
    const { load, start } = setup("?q=1#ttf=abc&x=1");
    expect(boot(document, window, load)).toBe(true);
    expect(sessionStorage.getItem("ttf:token")).toBe("abc");
    expect(location.pathname + location.search + location.hash).toBe("/page?q=1#x=1");
    await Promise.resolve();
    await Promise.resolve();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ token: "abc" }));
  });

  it("fragment token alone leaves no empty # or ?", () => {
    const { load } = setup("#ttf=abc");
    expect(boot(document, window, load)).toBe(true);
    expect(location.href).toBe(location.origin + "/page");
  });

  it("a plain anchor is left exactly as it was", () => {
    const { load } = setup("?a=b+c#section-2");
    sessionStorage.setItem("ttf:token", "stored");
    expect(boot(document, window, load)).toBe(true);
    expect(location.search + location.hash).toBe("?a=b+c#section-2");
  });

  it("the fragment wins over the query, and both are stripped", () => {
    const { load } = setup("?ttf=old#ttf=new");
    expect(boot(document, window, load)).toBe(true);
    expect(sessionStorage.getItem("ttf:token")).toBe("new");
    expect(location.search + location.hash).toBe("");
  });

  for (const search of ["?ttf=", "#ttf=", "?ttf=&x=1#ttf="]) {
    it(`empty token (${search}) counts as no token and is stripped`, () => {
      const { load } = setup(search);
      expect(boot(document, window, load)).toBe(false);
      expect(load).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
      expect(location.search + location.hash).not.toContain("ttf");
    });
  }

  it("empty token falls back to the one saved earlier in the visit", () => {
    const { load } = setup("#ttf=");
    sessionStorage.setItem("ttf:token", "stored");
    expect(boot(document, window, load)).toBe(true);
    expect(sessionStorage.getItem("ttf:token")).toBe("stored");
  });

  it("falls back to the token in sessionStorage", () => {
    const { load } = setup("");
    sessionStorage.setItem("ttf:token", "stored");
    expect(boot(document, window, load)).toBe(true);
    expect(load).toHaveBeenCalledWith("https://svc.example.com/overlay.js");
  });

  it("missing data-site: returns false", () => {
    const { load } = setup("?ttf=abc", null);
    expect(boot(document, window, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("works when storage throws, using the URL token for this page", () => {
    const { load } = setup("#ttf=abc");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(boot(document, window, load)).toBe(true);
    spy.mockRestore();
    get.mockRestore();
  });
});
