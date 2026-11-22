// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountOwner, renderOwner, smsBody, smsHref, NOT_STORED_NOTE, type OwnerAssignment, type OwnerState, type Site } from "../../client/dash/owner";

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
  it("a column with its link on has Copy link and Text link before New link", () => {
    const ctl = render().querySelector("[data-person=r1] .ctl")!;
    const labels = [...ctl.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Copy link", "Text link", "New link"]);
    for (const b of ctl.querySelectorAll("button")) expect(b.querySelector("svg")).not.toBeNull();
    expect(render().querySelector("[data-person=r1] .person-h details.more")).not.toBeNull();
  });

  it("a column whose link is off has only New link", () => {
    const ctl = render().querySelector("[data-person=r2] .ctl")!;
    expect([...ctl.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["New link"]);
  });

  it("the not-stored note sits in that reviewer's column, in plain words", () => {
    const box = render({ flash: { kind: "missing", id: "r1", name: "Alexis Rivera" } });
    const note = box.querySelector("[data-person=r1] [data-flash]")!;
    expect(note.textContent).toContain(NOT_STORED_NOTE);
    expect(NOT_STORED_NOTE).toBe("This link was made before links could be copied. Tap New link once to make one you can copy and text.");
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
