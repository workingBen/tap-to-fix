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

  it("URL token: stored, stripped from the address bar, overlay loaded with config", async () => {
    const { load, start } = setup("?ttf=abc&x=1#h");
    expect(boot(document, window, load)).toBe(true);
    expect(sessionStorage.getItem("ttf:token")).toBe("abc");
    expect(location.search + location.hash).toBe("?x=1#h");
    expect(load).toHaveBeenCalledWith("https://svc.example.com/overlay.js");
    await Promise.resolve();
    await Promise.resolve();
    expect(start).toHaveBeenCalledWith({
      base: "https://svc.example.com",
      site: "acme",
      token: "abc",
      dashboardUrl: "https://svc.example.com/r/#ttf=abc",
    });
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
    const { load } = setup("?ttf=abc");
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
