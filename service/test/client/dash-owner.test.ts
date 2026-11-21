// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fixCommand,
  mountOwner,
  prLabel,
  readyBatches,
  removeConfirm,
  renderOwner,
  reviewerLink,
  type Overview,
  type OwnerAssignment,
  type OwnerState,
  type Site,
} from "../../client/dash/owner";

const SITES: Site[] = [
  { slug: "bonus-decade", name: "Bonus Decade", origin: "https://bonusdecade.com", repo: "workingBen/longevity-tracker" },
  { slug: "greensprings", name: "Greensprings Longevity", origin: "https://greensprings.life", repo: "workingBen/longevity-tracker" },
];

function a(over: Partial<OwnerAssignment> = {}, counts: Partial<OwnerAssignment["counts"]> = {}): OwnerAssignment {
  return {
    id: "a1",
    site: "bonus-decade",
    path: "/sauna",
    title: "Sauna guide",
    reviewer: { id: "r1", name: "Alexis Rivera" },
    status: "not_started",
    counts: { open: 0, in_progress: 0, settled: 0, ...counts },
    pr_urls: [],
    ...over,
  };
}

const ALEXIS = { id: "r1", name: "Alexis Rivera", revoked: false, unsettled_count: 0, ready_count: 0 };

function state(over: Partial<OwnerState> = {}): OwnerState {
  return {
    sites: SITES,
    overview: { reviewers: [ALEXIS], assignments: [] },
    selectedReviewerId: null,
    flash: null,
    ...over,
  };
}

describe("fixCommand / reviewerLink / prLabel", () => {
  it("uses the lowercased first name and the site slug", () => {
    expect(fixCommand("Alexis Rivera", "bonus-decade")).toBe("/tap-to-fix:fix alexis bonus-decade");
    expect(fixCommand("  John  ", "greensprings")).toBe("/tap-to-fix:fix john greensprings");
  });
  it("reviewer links are <origin>/r/#ttf=<token>", () => {
    expect(reviewerLink("https://t.example", "abc")).toBe("https://t.example/r/#ttf=abc");
  });
  it("PR label carries the number when the URL has one", () => {
    expect(prLabel("https://github.com/a/b/pull/42")).toBe("PR #42");
    expect(prLabel("https://github.com/a/b/pull/42/files")).toBe("PR #42");
    expect(prLabel("https://example.com/change/9")).toBe("PR");
  });
  it("a javascript: PR URL is shown as text, never as a link", () => {
    const html = renderOwner(
      state({ overview: { reviewers: [ALEXIS], assignments: [a({ pr_urls: ["javascript:alert(1)//pull/7"] })] } }),
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<span class="lnk plain">');
    expect(html).toContain("PR #7");
  });
});

describe("readyBatches", () => {
  it("splits one reviewer's opens across sites, sorts by open desc and skips zero", () => {
    const overview: Overview = {
      reviewers: [ALEXIS, { ...ALEXIS, id: "r2", name: "Chris Tosswill" }],
      assignments: [
        a({ id: "1" }, { open: 2 }),
        a({ id: "2", path: "/x" }, { open: 1 }),
        a({ id: "3", site: "greensprings" }, { open: 4 }),
        a({ id: "4", reviewer: { id: "r2", name: "Chris Tosswill" } }, { open: 0, in_progress: 3 }),
      ],
    };
    expect(readyBatches(overview, SITES)).toEqual([
      { reviewerId: "r1", reviewerName: "Alexis Rivera", siteSlug: "greensprings", siteName: "Greensprings Longevity", open: 4, command: "/tap-to-fix:fix alexis greensprings" },
      { reviewerId: "r1", reviewerName: "Alexis Rivera", siteSlug: "bonus-decade", siteName: "Bonus Decade", open: 3, command: "/tap-to-fix:fix alexis bonus-decade" },
    ]);
  });
  it("falls back to the slug when the site is unknown", () => {
    const [b] = readyBatches({ reviewers: [ALEXIS], assignments: [a({ site: "gone" }, { open: 1 })] });
    expect(b.siteName).toBe("gone");
  });
});

describe("ready box heading", () => {
  it("uses the full name when the first name is shared", () => {
    const smith = { ...ALEXIS, id: "r2", name: "Alexis Smith" };
    const html = renderOwner(state({ overview: { reviewers: [ALEXIS, smith], assignments: [a({}, { open: 2 })] } }));
    expect(html).toContain("Alexis Rivera has 2 comments ready");
  });
});

describe("unambiguous fix commands", () => {
  it("two reviewers with the same first name both get slug commands", () => {
    const smith = { ...ALEXIS, id: "r2", name: "Alexis Smith" };
    const overview: Overview = {
      reviewers: [ALEXIS, smith],
      assignments: [a({ id: "1" }, { open: 2 }), a({ id: "2", reviewer: { id: "r2", name: "Alexis Smith" } }, { open: 1 })],
    };
    expect(readyBatches(overview, SITES).map((b) => b.command)).toEqual([
      "/tap-to-fix:fix alexis-rivera bonus-decade",
      "/tap-to-fix:fix alexis-smith bonus-decade",
    ]);
    // A reviewer with no open comments still counts toward the clash.
    const quiet = { ...overview, assignments: [a({ id: "1" }, { open: 2 })] };
    expect(readyBatches(quiet, SITES)[0].command).toBe("/tap-to-fix:fix alexis-rivera bonus-decade");
  });
  it("each ready box has a 44px-class download button carrying reviewer and site", () => {
    const box = document.createElement("div");
    box.innerHTML = renderOwner(state({ overview: { reviewers: [ALEXIS], assignments: [a({}, { open: 1 })] } }));
    const btn = box.querySelector("[data-ready] [data-action=download-batch]")!;
    expect(btn.getAttribute("data-id")).toBe("r1");
    expect(btn.getAttribute("data-site")).toBe("bonus-decade");
    expect(btn.textContent).toContain("Download batch file");
  });
});

describe("removeConfirm", () => {
  it("names the page and the reviewer and counts the comments", () => {
    const x = a({ title: "Digital Detox" }, { open: 1, in_progress: 1, settled: 1 });
    expect(removeConfirm(x)).toBe("Remove “Digital Detox” from Alexis's list? Its 3 comments are deleted too.");
    expect(removeConfirm(a({ title: "Digital Detox" }, { open: 1 }))).toBe(
      "Remove “Digital Detox” from Alexis's list? Its 1 comment is deleted too.",
    );
    expect(removeConfirm(a({ title: "Digital Detox" }))).toBe("Remove “Digital Detox” from Alexis's list?");
  });
});

describe("renderOwner", () => {
  it("no reviewers: says to add the first one", () => {
    const html = renderOwner(state({ overview: { reviewers: [], assignments: [] } }));
    expect(html).toContain("Add your first reviewer");
  });
  it("no sites: says to add a site first in place of the assign form", () => {
    const html = renderOwner(state({ sites: [] }));
    expect(html).toContain("Add a site first");
    expect(html).not.toContain('data-form="assign"');
    expect(renderOwner(state())).toContain('data-form="assign"');
  });
  it("escapes names and titles", () => {
    const html = renderOwner(
      state({
        overview: {
          reviewers: [{ ...ALEXIS, name: "<b>Eve</b>" }],
          assignments: [a({ title: "<script>x</script>", reviewer: { id: "r1", name: "<b>Eve</b>" } })],
        },
      }),
    );
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<b>Eve");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
  it("status chips, page link and PR links", () => {
    const html = renderOwner(
      state({
        overview: {
          reviewers: [ALEXIS],
          assignments: [a({ status: "in_progress", pr_urls: ["https://github.com/a/b/pull/42", "https://x.example/9"] }, { in_progress: 1 })],
        },
      }),
    );
    expect(html).toContain("In progress");
    expect(html).toContain('href="https://bonusdecade.com/sauna"');
    expect(html).toContain("PR #42");
    expect(html).toMatch(/>PR<\/span>/);
  });
  it("ready box with the review-cycle sentence and the command", () => {
    const html = renderOwner(
      state({
        overview: { reviewers: [{ ...ALEXIS, ready_count: 7 }], assignments: [a({ status: "open" }, { open: 7 })] },
      }),
    );
    expect(html).toContain("Alexis has 7 comments ready for a review cycle on Bonus Decade");
    expect(html).toContain("/tap-to-fix:fix alexis bonus-decade");
    // The command breaks only at spaces: each word is kept whole, and the copied text is exact.
    const box = document.createElement("div");
    box.innerHTML = html;
    const code = box.querySelector("[data-ready] code")!;
    expect(code.textContent).toBe("/tap-to-fix:fix alexis bonus-decade");
    expect([...code.querySelectorAll(".tok")].map((t) => t.textContent)).toEqual(["/tap-to-fix:fix", "alexis", "bonus-decade"]);
    expect(box.querySelector("[data-ready] [data-copy]")!.getAttribute("data-copy")).toBe("/tap-to-fix:fix alexis bonus-decade");
  });
  it("revoked reviewers say Link off; selecting one filters and shows the link controls", () => {
    const chris = { ...ALEXIS, id: "r2", name: "Chris Tosswill", revoked: true };
    const s = state({
      overview: {
        reviewers: [ALEXIS, chris],
        assignments: [a({ id: "x1", title: "Alexis page" }), a({ id: "x2", title: "Chris page", reviewer: { id: "r2", name: "Chris Tosswill" } })],
      },
    });
    expect(renderOwner(s)).toContain("Link off");
    expect(renderOwner(s)).not.toContain("Turn off link");
    const sel = renderOwner({ ...s, selectedReviewerId: "r1" });
    expect(sel).toContain("Alexis page");
    expect(sel).not.toContain("Chris page");
    expect(sel).toContain("New link");
    expect(sel).toContain("Turn off link");
    // A revoked reviewer can get a new link but has nothing to turn off.
    const selChris = renderOwner({ ...s, selectedReviewerId: "r2" });
    expect(selChris).toContain("New link");
    expect(selChris).not.toContain("Turn off link");
  });
  it("link flash names the reviewer and shows the link", () => {
    const html = renderOwner(state({ flash: { kind: "link", name: "Alexis Rivera", url: "https://t.example/r/#ttf=abc" } }));
    expect(html).toContain("Text this link to Alexis");
    expect(html).toContain("https://t.example/r/#ttf=abc");
  });
});

describe("mountOwner", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    history.replaceState(null, "", "/o/");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("no token shows the token form", async () => {
    await mountOwner(window);
    expect(document.body.textContent).toContain("Paste your owner token");
    expect(document.querySelector("input[type=password]")).not.toBeNull();
  });
  it("401 shows the token form again and forgets the stored token", async () => {
    localStorage.setItem("ttf:owner-token", "wrong");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"Unauthorized"}', { status: 401 })));
    await mountOwner(window);
    expect(document.body.textContent).toContain("Paste your owner token");
    expect(localStorage.getItem("ttf:owner-token")).toBeNull();
  });
  it("when the clipboard is refused, Copy in the link flash selects the link itself", async () => {
    history.replaceState(null, "", "/o/#owner=tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        if (path === "/api/owner/reviewers" && init?.method === "POST") {
          return new Response('{"id":"r9","name":"Shawn Smith","token":"secret-token"}', { status: 201 });
        }
        if (path.endsWith("/sites")) return new Response("[]", { status: 200 });
        return new Response('{"reviewers":[{"id":"r9","name":"Shawn Smith","revoked":false,"unsettled_count":0,"ready_count":0}],"assignments":[]}', { status: 200 });
      }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    const exec = vi.fn(() => false);
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    await mountOwner(window);

    const form = document.querySelector("form[data-form=reviewer]") as HTMLFormElement;
    (form.querySelector("input[name=name]") as HTMLInputElement).value = "Shawn Smith";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector("[data-flash]")).not.toBeNull());

    const link = `${location.origin}/r/#ttf=secret-token`;
    expect(document.querySelector("[data-flash-url]")!.textContent).toBe(link);
    const button = document.querySelector("[data-flash] [data-copy]") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Select and copy the link"));
    expect(window.getSelection()!.toString()).toBe(link);
    expect(window.getSelection()!.toString()).not.toBe("Copy");
  });
  it("Download batch file fetches with the Bearer token (never in the URL) and saves a Blob", async () => {
    history.replaceState(null, "", "/o/#owner=tok");
    const calls: { path: string; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, auth: new Headers(init?.headers).get("Authorization") });
        if (path.endsWith("/sites")) return new Response(JSON.stringify(SITES), { status: 200 });
        if (path.includes("/api/owner/batch")) {
          return new Response('{"comments":[]}', {
            status: 200,
            headers: { "Content-Disposition": 'attachment; filename="tap-to-fix-bonus-decade-alexis-rivera-20261120.json"' },
          });
        }
        return new Response(JSON.stringify({ reviewers: [ALEXIS], assignments: [a({}, { open: 1 })] }), { status: 200 });
      }),
    );
    const created = vi.fn(() => "blob:x");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: created });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    await mountOwner(window);
    (document.querySelector("[data-action=download-batch]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(names).toEqual(["tap-to-fix-bonus-decade-alexis-rivera-20261120.json"]));
    const call = calls.find((c) => c.path.includes("/api/owner/batch"))!;
    expect(call.path).toBe("/api/owner/batch?reviewer=r1&site=bonus-decade&format=file");
    expect(call.path).not.toContain("tok");
    expect(call.auth).toBe("Bearer tok");
    expect(created).toHaveBeenCalled();
    click.mockRestore();
  });
  it("takes the token out of the address bar once stored", async () => {
    history.replaceState(null, "", "/o/#owner=tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => new Response(path.endsWith("/sites") ? "[]" : '{"reviewers":[],"assignments":[]}', { status: 200 })),
    );
    await mountOwner(window);
    expect(location.hash).toBe("");
    expect(localStorage.getItem("ttf:owner-token")).toBe("tok");
    expect(document.body.textContent).toContain("Add your first reviewer");
  });
});
