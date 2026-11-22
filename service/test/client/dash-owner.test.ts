// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countsText,
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
    created_at: "2026-11-01T00:00:00.000Z",
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
    assignFor: null,
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
  it("the reviewer's more menu downloads each ready batch, carrying reviewer and site", () => {
    const box = document.createElement("div");
    box.innerHTML = renderOwner(state({ overview: { reviewers: [ALEXIS], assignments: [a({}, { open: 1 })] } }));
    const btn = box.querySelector("[data-person=r1] details.more [data-action=download-batch]")!;
    expect(btn.getAttribute("data-id")).toBe("r1");
    expect(btn.getAttribute("data-site")).toBe("bonus-decade");
    expect(btn.textContent).toContain("Download batch file for Bonus Decade");
    expect(box.querySelector("[data-person=r1] details.more")!.textContent).toContain("For when the network is blocked: ttf batch --from reads it.");
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
  it("no reviewers: the add-reviewer form is open", () => {
    const box = document.createElement("div");
    box.innerHTML = renderOwner(state({ overview: { reviewers: [], assignments: [] } }));
    expect(box.querySelector("[data-adder=reviewer]")!.hasAttribute("open")).toBe(true);
    box.innerHTML = renderOwner(state());
    expect(box.querySelector("[data-adder=reviewer]")!.hasAttribute("open")).toBe(false);
  });
  it("no sites: says to add a site first and offers no assign button", () => {
    const html = renderOwner(state({ sites: [] }));
    expect(html).toContain("Add a site first. The form is under Sites, below.");
    expect(html).not.toContain('data-action="assign"');
  });
  it("the assign button opens a form for that reviewer only (stub until the panel lands)", () => {
    const ben = { ...ALEXIS, id: "r2", name: "Ben Pellow" };
    const s = state({ overview: { reviewers: [ALEXIS, ben], assignments: [] } });
    expect(renderOwner(s)).not.toContain('data-form="assign"');
    const box = document.createElement("div");
    box.innerHTML = renderOwner({ ...s, assignFor: "r2" });
    expect(box.querySelectorAll("form[data-form=assign]")).toHaveLength(1);
    const form = box.querySelector("[data-person=r2] form[data-form=assign]")!;
    expect((form.querySelector("input[name=reviewer_id]") as HTMLInputElement).value).toBe("r2");
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
  it("ready strip with the count, the site and the command", () => {
    const html = renderOwner(
      state({
        overview: { reviewers: [{ ...ALEXIS, ready_count: 7 }], assignments: [a({ status: "open" }, { open: 7 })] },
      }),
    );
    expect(html).toContain("7 comments ready to fix on Bonus Decade");
    expect(html).toContain("/tap-to-fix:fix alexis bonus-decade");
    // The command breaks only at spaces: each word is kept whole, and the copied text is exact.
    const box = document.createElement("div");
    box.innerHTML = html;
    const code = box.querySelector("[data-ready] code")!;
    expect(code.textContent).toBe("/tap-to-fix:fix alexis bonus-decade");
    expect([...code.querySelectorAll(".tok")].map((t) => t.textContent)).toEqual(["/tap-to-fix:fix", "alexis", "bonus-decade"]);
    expect(box.querySelector("[data-ready] [data-copy]")!.getAttribute("data-copy")).toBe("/tap-to-fix:fix alexis bonus-decade");
  });
  it("every column has New link; Turn off link only while the link is on", () => {
    const chris = { ...ALEXIS, id: "r2", name: "Chris Tosswill", revoked: true };
    const box = document.createElement("div");
    box.innerHTML = renderOwner(state({ overview: { reviewers: [ALEXIS, chris], assignments: [] } }));
    const col = (id: string) => box.querySelector(`[data-person=${id}]`)!;
    expect(col("r1").querySelector("[data-action=reissue]")!.textContent).toBe("New link");
    expect(col("r2").querySelector("[data-action=reissue]")!.textContent).toBe("New link");
    expect(col("r1").querySelector("details.more [data-action=revoke]")!.textContent).toBe("Turn off link");
    expect(col("r2").querySelector("[data-action=revoke]")).toBeNull();
  });
  it("link flash names the reviewer and sits in that reviewer's column", () => {
    const ben = { ...ALEXIS, id: "r2", name: "Ben Pellow" };
    const box = document.createElement("div");
    box.innerHTML = renderOwner(
      state({ overview: { reviewers: [ALEXIS, ben], assignments: [] }, flash: { kind: "link", id: "r2", name: "Ben Pellow", url: "https://t.example/r/#ttf=abc" } }),
    );
    const flash = box.querySelector("[data-person=r2] [data-flash]")!;
    expect(flash.textContent).toContain("Text this link to Ben");
    expect(flash.textContent).toContain("https://t.example/r/#ttf=abc");
    expect(box.querySelectorAll("[data-flash]")).toHaveLength(1);
  });
});

describe("countsText", () => {
  it("bolds the open count and leaves out zeros", () => {
    expect(countsText(a({}, { open: 3, in_progress: 1, settled: 0 }))).toBe("<b>3 open</b> · 1 in progress");
    expect(countsText(a({}, { open: 0, in_progress: 0, settled: 2 }))).toBe("2 settled");
    expect(countsText(a({}, { open: 1, in_progress: 0, settled: 4 }))).toBe("<b>1 open</b> · 4 settled");
  });
  it("says No comments yet when all three are zero", () => {
    expect(countsText(a())).toBe("No comments yet");
  });
});

describe("one column per reviewer", () => {
  const BEN = { id: "r2", name: "Ben Pellow", revoked: false, unsettled_count: 1, ready_count: 1 };
  const THREE: Site[] = [...SITES, { slug: "alexis-art", name: "Alexis Art", origin: "https://art.greensprings.life", repo: "workingBen/art" }];
  const ben = { id: "r2", name: "Ben Pellow" };
  const overview: Overview = {
    reviewers: [{ ...ALEXIS, unsettled_count: 5 }, BEN],
    assignments: [
      a({ id: "p6", title: "Gallery", site: "alexis-art", path: "/gallery", status: "open" }, { open: 1 }),
      a({ id: "p5", title: "Gifts buying club", site: "greensprings", path: "/gifts", reviewer: ben, status: "open" }, { open: 1, in_progress: 1 }),
      a({ id: "p4", title: "Home page", site: "bonus-decade", path: "/", reviewer: ben, status: "done" }, { settled: 2 }),
      a({ id: "p3", title: "Sauna protocol", site: "bonus-decade", path: "/protocols/sauna" }),
      a({ id: "p2", title: "Digital Detox Retreat", site: "greensprings", path: "/digital-detox", status: "open" }, { open: 1, settled: 2 }),
      a({ id: "p1", title: "Virtual EMF Assessment", site: "greensprings", path: "/virtual-emf-assessment", status: "open" }, { open: 3, in_progress: 1 }),
    ],
  };
  const render = (over: Partial<OwnerState> = {}) => {
    const box = document.createElement("div");
    box.innerHTML = renderOwner(state({ sites: THREE, overview, ...over }));
    return box;
  };

  it("one column per reviewer, in reviewer order", () => {
    expect([...render().querySelectorAll("[data-person]")].map((c) => c.getAttribute("data-person"))).toEqual(["r1", "r2"]);
  });
  it("each column holds only that reviewer's pages, in overview order", () => {
    const box = render();
    const titles = (id: string) => [...box.querySelectorAll(`[data-person=${id}] [data-row] .tt`)].map((t) => t.textContent);
    expect(titles("r1")).toEqual(["Gallery", "Sauna protocol", "Digital Detox Retreat", "Virtual EMF Assessment"]);
    expect(titles("r2")).toEqual(["Gifts buying club", "Home page"]);
  });
  it("each column has its ready strips with the command and a Copy button", () => {
    const box = render();
    const strips = (id: string) => [...box.querySelectorAll(`[data-person=${id}] [data-ready]`)];
    expect(strips("r1").map((s) => s.querySelector("p")!.textContent)).toEqual([
      "4 comments ready to fix on Greensprings Longevity",
      "1 comment ready to fix on Alexis Art",
    ]);
    expect(strips("r1")[0].querySelector("code")!.textContent).toBe("/tap-to-fix:fix alexis greensprings");
    expect(strips("r1")[0].querySelector("[data-copy]")!.textContent).toBe("Copy");
    expect(strips("r2").map((s) => s.querySelector("code")!.textContent)).toEqual(["/tap-to-fix:fix ben greensprings"]);
  });
  it("the header shows the open count and the link state", () => {
    const box = render();
    expect(box.querySelector("[data-person=r1] .person-h")!.textContent).toContain("5 open comments · link on");
    expect(box.querySelector("[data-person=r2] .person-h")!.textContent).toContain("1 open comment · link on");
  });
  it("a revoked reviewer's subline says Link off", () => {
    const box = render({ overview: { ...overview, reviewers: [overview.reviewers[0], { ...BEN, revoked: true }] } });
    expect(box.querySelector("[data-person=r2] .person-h")!.textContent).toContain("Link off");
    expect(box.querySelector("[data-person=r1] .person-h")!.textContent).not.toContain("Link off");
  });
  it("pages show the status chip, the counts, the Page link and a remove button", () => {
    const row = render().querySelector("[data-row=p2]")!;
    expect(row.querySelector(".tu")!.textContent).toBe("Greensprings Longevity /digital-detox");
    expect(row.querySelector(".st")!.textContent).toBe("Open");
    expect(row.querySelector(".counts")!.innerHTML).toBe("<b>1 open</b> · 2 settled");
    expect(row.querySelector("a.lnk")!.getAttribute("href")).toBe("https://greensprings.life/digital-detox");
    expect(row.querySelector("[data-action=remove]")!.getAttribute("aria-label")).toBe("Remove Digital Detox Retreat from Alexis's list");
  });
  it("Assign a page to <First> at the end of each column", () => {
    const box = render();
    const btn = (id: string) => box.querySelector(`[data-person=${id}] [data-action=assign]`)!;
    expect(btn("r1").textContent).toBe("Assign a page to Alexis");
    expect(btn("r1").getAttribute("data-id")).toBe("r1");
    expect(btn("r2").textContent).toBe("Assign a page to Ben");
  });
  it("the top bar has Add a reviewer", () => {
    expect(render().querySelector(".top [data-adder=reviewer] > summary")!.textContent).toBe("Add a reviewer");
  });
  it("sites list at the bottom: name, host and page count, with the slug kept", () => {
    const box = render();
    const rows = [...box.querySelectorAll("[data-sites] .siterow")];
    expect(rows.map((r) => r.querySelector(".tu")!.textContent)).toEqual([
      "bonusdecade.com · 2 pages",
      "greensprings.life · 3 pages",
      "art.greensprings.life · 1 page",
    ]);
    expect(rows[1].querySelector("b")!.textContent).toBe("Greensprings Longevity");
    expect(rows[1].textContent).toContain("greensprings");
    expect(rows[1].textContent).toContain("workingBen/longevity-tracker");
    expect(box.querySelector(".sites [data-adder=site] > summary")!.textContent).toBe("Add a site");
  });
  it("no table remains", () => {
    expect(render().querySelector("table")).toBeNull();
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
