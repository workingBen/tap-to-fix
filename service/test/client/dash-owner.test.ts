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
      { reviewerName: "Alexis Rivera", siteSlug: "greensprings", siteName: "Greensprings Longevity", open: 4, command: "/tap-to-fix:fix alexis greensprings" },
      { reviewerName: "Alexis Rivera", siteSlug: "bonus-decade", siteName: "Bonus Decade", open: 3, command: "/tap-to-fix:fix alexis bonus-decade" },
    ]);
  });
  it("falls back to the slug when the site is unknown", () => {
    const [b] = readyBatches({ reviewers: [ALEXIS], assignments: [a({ site: "gone" }, { open: 1 })] });
    expect(b.siteName).toBe("gone");
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
