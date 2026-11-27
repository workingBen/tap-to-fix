// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountOwner, renderOwner, reviewPageUrl, smsBody, smsHref, tokenOf, NOT_STORED_NOTE, type OwnerAssignment, type OwnerState, type Site } from "../../client/dash/owner";

const SITES: Site[] = [
  { slug: "greensprings", name: "Greensprings Longevity", origin: "https://greensprings.life", repo: "workingBen/longevity-tracker" },
  { slug: "bonus-decade", name: "Bonus Decade", origin: "https://bonusdecade.com", repo: "workingBen/longevity-tracker" },
];
const ALEXIS = { id: "r1", name: "Alexis Rivera", revoked: false, unsettled_count: 0, ready_count: 0 };
const CHRIS = { id: "r2", name: "Chris Tosswill", revoked: true, unsettled_count: 0, ready_count: 0 };
const URL1 = "https://ttf.example/r/#ttf=tok_abc-123";

function a(over: Partial<OwnerAssignment> = {}): OwnerAssignment {
  return {
    id: "a1", site: "greensprings", path: "/x", title: "X", created_at: "2026-11-01T00:00:00.000Z",
    reviewer: { id: "r1", name: "Alexis Rivera" }, status: "not_started", counts: { open: 0, in_progress: 0, settled: 0 }, pr_urls: [], ...over,
  };
}
function state(over: Partial<OwnerState> = {}): OwnerState {
  return { sites: SITES, overview: { reviewers: [ALEXIS, CHRIS], assignments: [] }, assignFor: null, flash: null, ...over };
}
const render = (over: Partial<OwnerState> = {}) => {
  const box = document.createElement("div");
  box.innerHTML = renderOwner(state(over));
  return box;
};

describe("the text message", () => {
  it("names the reviewer's sites, or none", () => {
    expect(smsBody(["Greensprings Longevity"], URL1)).toBe(`Here's your link to review pages for Greensprings Longevity: ${URL1}`);
    expect(smsBody(["Greensprings Longevity", "Bonus Decade"], URL1)).toBe(`Here's your link to review pages for Greensprings Longevity and Bonus Decade: ${URL1}`);
    expect(smsBody([], URL1)).toBe(`Here's your link to review pages: ${URL1}`);
  });

  it("is an sms:?&body= link that decodes back to the message, with # and spaces encoded", () => {
    const body = smsBody(["Greensprings Longevity"], URL1);
    const href = smsHref(body);
    expect(href.startsWith("sms:?&body=")).toBe(true);
    const enc = href.slice("sms:?&body=".length);
    expect(enc).not.toMatch(/[ #'&?]/);
    expect(enc).toContain("%23ttf%3D");
    expect(decodeURIComponent(enc)).toBe(body);
  });
});

describe("column header", () => {
  it("a column with its link on has Copy link in the header and Text link, New link and Turn off link under More", () => {
    const head = render().querySelector("[data-person=r1] .person-h")!;
    const outside = [...head.querySelectorAll("button")].filter((b) => !b.closest("details.more"));
    expect(outside.map((b) => b.textContent)).toEqual(["Copy link"]);
    expect(head.querySelector(".state")!.textContent).toBe("link on");
    const menu = head.querySelector("details.more .menu")!;
    expect([...menu.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Text link", "New link", "Turn off link"]);
    for (const b of head.querySelectorAll("button")) expect(b.querySelector("svg")).not.toBeNull();
  });

  it("a column whose link is off has only New link, in the header, and says Link off", () => {
    const head = render().querySelector("[data-person=r2] .person-h")!;
    expect([...head.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["New link"]);
    expect(head.querySelector("details.more")).toBeNull();
    expect(head.querySelector(".state")!.textContent).toBe("Link off");
  });

  it("the not-stored note sits in that reviewer's column, in plain words", () => {
    const box = render({ flash: { kind: "missing", id: "r1", name: "Alexis Rivera" } });
    const note = box.querySelector("[data-person=r1] [data-flash]")!;
    expect(note.textContent).toContain(NOT_STORED_NOTE);
    expect(NOT_STORED_NOTE).toBe("This link was made before links could be copied. Tap New link (under More) once to make one you can copy and text.");
    expect(note.querySelector("code")).toBeNull();
  });

  it("the new-link flash has Copy, a Text link that opens Messages, and says it can be copied again later", () => {
    const box = render({
      overview: { reviewers: [ALEXIS], assignments: [a()] },
      flash: { kind: "link", id: "r1", name: "Alexis Rivera", url: URL1 },
    });
    const flash = box.querySelector("[data-person=r1] [data-flash]")!;
    expect(flash.textContent).not.toContain("shown only now");
    expect(flash.textContent).toContain("Copy link");
    const text = flash.querySelector("a[data-sms]") as HTMLAnchorElement;
    expect(text.textContent).toBe("Text link");
    expect(text.getAttribute("href")).toBe(smsHref(smsBody(["Greensprings Longevity"], URL1)));
  });
});

describe("Copy link and Text link (mounted)", () => {
  type Hit = { path: string; method: string; auth: string | null };
  let hits: Hit[];
  let linkResponse: () => Response;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    history.replaceState(null, "", "/o/#owner=tok");
    hits = [];
    linkResponse = () => new Response(JSON.stringify({ url: URL1 }), { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        hits.push({ path, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("Authorization") });
        if (path.endsWith("/sites")) return new Response(JSON.stringify(SITES), { status: 200 });
        if (path === "/api/owner/reviewers/r1/link") return linkResponse();
        return new Response(
          JSON.stringify({ reviewers: [ALEXIS], assignments: [a(), a({ id: "a2", site: "bonus-decade" }), a({ id: "a3" })] }),
          { status: 200 },
        );
      }),
    );
    vi.stubGlobal("ClipboardItem", undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  const btn = (action: string) => document.querySelector(`[data-person=r1] [data-action=${action}]`) as HTMLButtonElement;
  const linkHits = () => hits.filter((h) => h.path.endsWith("/link"));

  it("the link is fetched on click, not on page load, with the owner token in the header", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mountOwner(window);
    expect(linkHits()).toHaveLength(0);
    btn("copy-link").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(URL1));
    expect(linkHits()).toEqual([{ path: "/api/owner/reviewers/r1/link", method: "GET", auth: "Bearer tok" }]);
    await vi.waitFor(() => expect(btn("copy-link").textContent).toBe("Copied"));
  });

  it("where the browser takes a pending clipboard item (Safari), the copy starts inside the tap", async () => {
    let item: { data: Record<string, Promise<Blob>> } | null = null;
    class FakeItem {
      constructor(public data: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeItem);
    const write = vi.fn(async (items: FakeItem[]) => {
      item = items[0];
      await items[0].data["text/plain"];
    });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, writeText } });
    await mountOwner(window);
    btn("copy-link").click();
    expect(write).toHaveBeenCalledTimes(1); // synchronously, before the fetch resolves
    await vi.waitFor(() => expect(btn("copy-link").textContent).toBe("Copied"));
    expect(await (await item!.data["text/plain"]).text()).toBe(URL1);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("when the clipboard is refused, the link is shown, selected, to copy by hand", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    await mountOwner(window);
    btn("copy-link").click();
    await vi.waitFor(() => expect(document.querySelector("[data-person=r1] [data-flash-url]")?.textContent).toBe(URL1));
    expect(window.getSelection()!.toString()).toBe(URL1);
  });

  it("a link made before links were kept: the plain note, and nothing copied", async () => {
    linkResponse = () => new Response('{"error":"x","code":"not_stored"}', { status: 409 });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mountOwner(window);
    btn("copy-link").click();
    await vi.waitFor(() => expect(document.querySelector("[data-person=r1] [data-flash]")?.textContent).toContain(NOT_STORED_NOTE));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("Text link opens an sms: link with the message, naming the reviewer's sites once each", async () => {
    const opened: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      opened.push(this.getAttribute("href") ?? "");
    });
    try {
      await mountOwner(window);
      btn("text-link").click();
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      expect(opened[0]).toBe(smsHref(smsBody(["Greensprings Longevity", "Bonus Decade"], URL1)));
      // The link stays on screen with its own Text link, in case Messages did not open.
      expect(document.querySelector("[data-person=r1] [data-flash] a[data-sms]")!.getAttribute("href")).toBe(opened[0]);
    } finally {
      click.mockRestore();
    }
  });

  it("Text link on a link made before links were kept: the note, no Messages", async () => {
    linkResponse = () => new Response('{"error":"x","code":"not_stored"}', { status: 409 });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await mountOwner(window);
      btn("text-link").click();
      await vi.waitFor(() => expect(document.querySelector("[data-person=r1] [data-flash]")?.textContent).toContain(NOT_STORED_NOTE));
      expect(click).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  });

  it("any other failure shows the service's message under the header", async () => {
    linkResponse = () => new Response('{"error":"Copying links isn\'t set up on this service yet. Run the deploy again.","code":"no_key"}', { status: 503 });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn() } });
    await mountOwner(window);
    btn("copy-link").click();
    await vi.waitFor(() => expect(document.querySelector("[data-person=r1] .person-err")?.textContent).toContain("Run the deploy again."));
  });
});

describe("Review link: the page in review mode as the reviewer", () => {
  it("puts the token in the fragment the way the loader reads it, keeping other fragment parts", () => {
    expect(reviewPageUrl("https://greensprings.life/x", "tok_abc-123")).toBe("https://greensprings.life/x#ttf=tok_abc-123");
    expect(reviewPageUrl("https://greensprings.life/x?q=1", "t")).toBe("https://greensprings.life/x?q=1#ttf=t");
    expect(reviewPageUrl("https://greensprings.life/x#faq&a=b", "t")).toBe("https://greensprings.life/x#faq&a=b&ttf=t");
    expect(reviewPageUrl("https://greensprings.life/x#ttf=old&faq", "t")).toBe("https://greensprings.life/x#faq&ttf=t");
  });

  it("reads the token from a reviewer link", () => {
    expect(tokenOf(URL1)).toBe("tok_abc-123");
    expect(tokenOf("https://ttf.example/r/#a=1&ttf=t2")).toBe("t2");
    expect(tokenOf("https://ttf.example/r/")).toBeNull();
    expect(tokenOf("https://ttf.example/r/#ttf=")).toBeNull();
  });

  const row = (box: HTMLElement, id = "a1") => box.querySelector(`[data-row=${id}]`)!;
  const links = (el: Element) => [...el.querySelectorAll(".lk .lnk")];

  it("each page row has Page then Review, both opening a new tab, with line icons", () => {
    const r = row(render({ overview: { reviewers: [ALEXIS, CHRIS], assignments: [a()] } }));
    expect(links(r).map((l) => l.textContent)).toEqual(["Page", "Review"]);
    for (const l of links(r)) {
      expect(l.tagName).toBe("A");
      expect(l.getAttribute("target")).toBe("_blank");
      expect(l.getAttribute("rel")).toBe("noopener noreferrer");
      expect(l.querySelector("svg")).not.toBeNull();
    }
  });

  it("before the token is fetched, Review points at the plain page and is not marked ready", () => {
    const review = row(render({ overview: { reviewers: [ALEXIS, CHRIS], assignments: [a()] } })).querySelector("a[data-review]")!;
    expect(review.getAttribute("href")).toBe("https://greensprings.life/x");
    expect(review.hasAttribute("data-ready")).toBe(false);
    expect(review.getAttribute("data-id")).toBe("r1");
  });

  it("once the token is known, Review's href is the page with #ttf=<token>", () => {
    const box = render({ overview: { reviewers: [ALEXIS, CHRIS], assignments: [a({ path: "/digital-detox" })] }, reviewTokens: { r1: "tok_abc-123" } });
    const review = row(box).querySelector("a[data-review]")!;
    expect(review.getAttribute("href")).toBe("https://greensprings.life/digital-detox#ttf=tok_abc-123");
    expect(review.hasAttribute("data-ready")).toBe(true);
    expect(row(box).querySelector("a.lnk:not([data-review])")!.getAttribute("href")).toBe("https://greensprings.life/digital-detox");
  });

  it("while the reviewer's link is off, Review is gray text, not a link, and says why", () => {
    const off = a({ id: "c1", reviewer: { id: "r2", name: "Chris Tosswill" } });
    const r = row(render({ overview: { reviewers: [ALEXIS, CHRIS], assignments: [off] }, reviewTokens: { r2: "stale" } }), "c1");
    expect(r.querySelector("a[data-review]")).toBeNull();
    const span = links(r)[1];
    expect(span.tagName).toBe("SPAN");
    expect(span.className).toBe("lnk plain");
    expect(span.textContent).toBe("Review is off: Chris's link is off");
    expect(span.getAttribute("title")).toBe("Chris's link is off. New link turns it back on.");
    expect(r.innerHTML).not.toContain("stale");
  });
});

describe("Review link (mounted)", () => {
  let linkResponse: () => Response;
  let linkCalls: number;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    history.replaceState(null, "", "/o/#owner=tok");
    linkCalls = 0;
    linkResponse = () => new Response(JSON.stringify({ url: URL1 }), { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path.endsWith("/sites")) return new Response(JSON.stringify(SITES), { status: 200 });
        if (path === "/api/owner/reviewers/r1/link") return (linkCalls++, linkResponse());
        return new Response(JSON.stringify({ reviewers: [ALEXIS], assignments: [a({ path: "/digital-detox" })] }), { status: 200 });
      }),
    );
    vi.stubGlobal("ClipboardItem", undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  const review = () => document.querySelector("[data-row=a1] a[data-review]") as HTMLAnchorElement;
  const fakeTab = () => ({ opener: {} as unknown, location: { href: "" }, close: vi.fn() });

  it("opens the tab inside the tap, before the fetch, then sends it to the page in review mode", async () => {
    const tab = fakeTab();
    const open = vi.fn(() => tab as unknown as Window);
    vi.stubGlobal("open", open);
    await mountOwner(window);
    expect(linkCalls).toBe(0);
    review().click();
    expect(open).toHaveBeenCalledTimes(1); // synchronously, so iOS Safari does not block it
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    await vi.waitFor(() => expect(tab.location.href).toBe("https://greensprings.life/digital-detox#ttf=tok_abc-123"));
    expect(linkCalls).toBe(1);
    // The row now carries the real href, so the next tap opens directly.
    await vi.waitFor(() => expect(review().hasAttribute("data-ready")).toBe(true));
    expect(review().getAttribute("href")).toBe("https://greensprings.life/digital-detox#ttf=tok_abc-123");
  });

  it("after Copy link, Review reuses the link already fetched: no second fetch", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } });
    await mountOwner(window);
    (document.querySelector("[data-person=r1] [data-action=copy-link]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector("[data-action=copy-link]")!.textContent).toBe("Copied"));
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab as unknown as Window));
    review().click();
    await vi.waitFor(() => expect(tab.location.href).toBe("https://greensprings.life/digital-detox#ttf=tok_abc-123"));
    expect(linkCalls).toBe(1);
  });

  it("a link made before links were kept: the tab closes and the plain note shows", async () => {
    linkResponse = () => new Response('{"error":"x","code":"not_stored"}', { status: 409 });
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab as unknown as Window));
    await mountOwner(window);
    review().click();
    await vi.waitFor(() => expect(document.querySelector("[data-person=r1] [data-flash]")?.textContent).toContain(NOT_STORED_NOTE));
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });
});
