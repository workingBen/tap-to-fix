// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countsText,
  filterCandidates,
  fixCommand,
  mountOwner,
  pageCandidates,
  relativeDay,
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
  it("the old inline assign form is gone; assignFor opens the one Assign pages panel", () => {
    const ben = { ...ALEXIS, id: "r2", name: "Ben Pellow" };
    const s = state({ overview: { reviewers: [ALEXIS, ben], assignments: [] } });
    expect(renderOwner(s)).not.toContain("data-assign-panel");
    const box = document.createElement("div");
    box.innerHTML = renderOwner({ ...s, assignFor: "r2" });
    expect(box.querySelector("form[data-form=assign]")).toBeNull();
    expect(box.querySelectorAll("[data-assign-panel]")).toHaveLength(1);
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
  it("the header subline uses the ready count, the in-progress total and the link state", () => {
    const box = render({ overview: { ...overview, reviewers: [{ ...ALEXIS, unsettled_count: 9, ready_count: 5 }, BEN] } });
    const sub = (id: string) => box.querySelector(`[data-person=${id}] .person-h .tu`)!.textContent;
    expect(sub("r1")).toBe("5 open · 1 in progress · link on");
    expect(sub("r2")).toBe("1 open · 1 in progress · link on");
  });
  it("the header subline leaves out a zero in-progress count, and says No comments yet with none", () => {
    const box = render({
      overview: {
        reviewers: [{ ...ALEXIS, ready_count: 2 }, { ...BEN, unsettled_count: 0, ready_count: 0, revoked: true }],
        assignments: [a({ id: "q1" }, { open: 2, settled: 1 }), a({ id: "q2", reviewer: ben })],
      },
    });
    expect(box.querySelector("[data-person=r1] .person-h .tu")!.textContent).toBe("2 open · link on");
    expect(box.querySelector("[data-person=r2] .person-h .tu")!.textContent).toBe("No comments yet · Link off");
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

describe("assign pages panel", () => {
  const NOW = new Date(2026, 10, 21, 15, 0);
  /** A local time `days` calendar days before NOW, at `hour`:00. */
  const at = (days: number, hour = 9) => new Date(2026, 10, 21 - days, hour, 0).toISOString();
  const ben = { id: "r2", name: "Ben Pellow" };
  const BEN = { id: "r2", name: "Ben Pellow", revoked: false, unsettled_count: 0, ready_count: 0 };
  const THREE: Site[] = [...SITES, { slug: "alexis-art", name: "Alexis Art", origin: "https://art.greensprings.life", repo: "workingBen/art" }];
  const overview: Overview = {
    reviewers: [ALEXIS, BEN],
    assignments: [
      a({ id: "p6", title: "Gallery", site: "alexis-art", path: "/gallery", created_at: at(0, 10) }),
      a({ id: "p5", title: "Home page", site: "bonus-decade", path: "/", reviewer: ben, created_at: at(0, 9) }),
      a({ id: "p4", title: "Gifts buying club", site: "greensprings", path: "/gifts", reviewer: ben, created_at: at(1) }),
      a({ id: "p3", title: "Sauna protocol", site: "bonus-decade", path: "/protocols/sauna", created_at: at(2) }),
      a({ id: "p2", title: "Digital Detox Retreat", site: "greensprings", path: "/digital-detox", created_at: at(3, 11) }),
      a({ id: "p1", title: "Virtual EMF Assessment", site: "greensprings", path: "/virtual-emf-assessment", created_at: at(3, 10) }),
    ],
  };

  describe("pageCandidates", () => {
    it("lists pages the reviewer does not have, newest first, and the rest as already", () => {
      const { candidates, already } = pageCandidates(overview, "r2");
      expect(candidates.map((c) => c.title)).toEqual(["Gallery", "Sauna protocol", "Digital Detox Retreat", "Virtual EMF Assessment"]);
      expect(candidates[0]).toEqual({ site: "alexis-art", path: "/gallery", title: "Gallery", lastAssignedTo: ["Alexis"], lastAssignedAt: at(0, 10) });
      expect(already.map((x) => x.title)).toEqual(["Home page", "Gifts buying club"]);
    });
    it("dedupes a page two reviewers have, most recent first, with the newest title", () => {
      const shawn = { id: "r3", name: "Shawn Smith" };
      const both: Overview = {
        reviewers: [ALEXIS, BEN, { ...BEN, id: "r3", name: "Shawn Smith" }],
        assignments: [
          a({ id: "n2", title: "Sauna (new title)", path: "/sauna", reviewer: ben, created_at: at(0) }),
          a({ id: "n3", title: "Other", path: "/other", reviewer: shawn, created_at: at(1) }),
          a({ id: "n1", title: "Sauna", path: "/sauna", created_at: at(2) }),
        ],
      };
      const { candidates, already } = pageCandidates(both, "r3");
      expect(candidates).toEqual([
        { site: "bonus-decade", path: "/sauna", title: "Sauna (new title)", lastAssignedTo: ["Ben", "Alexis"], lastAssignedAt: at(0) },
      ]);
      expect(already.map((x) => x.id)).toEqual(["n3"]);
    });
    it("two reviewers who share a first name both count, by full name", () => {
      const smith = { id: "r4", name: "Alexis Smith" };
      const clash: Overview = {
        reviewers: [ALEXIS, BEN, { ...BEN, id: "r4", name: "Alexis Smith" }],
        assignments: [
          a({ id: "c2", path: "/sauna", reviewer: smith, created_at: at(0) }),
          a({ id: "c1", path: "/sauna", created_at: at(1) }),
        ],
      };
      expect(pageCandidates(clash, "r2").candidates[0].lastAssignedTo).toEqual(["Alexis Smith", "Alexis Rivera"]);
    });
    it("sorts by the latest assignment even when the overview is not in order", () => {
      const shuffled = { ...overview, assignments: [...overview.assignments].reverse() };
      expect(pageCandidates(shuffled, "r2").candidates.map((c) => c.path)).toEqual([
        "/gallery",
        "/protocols/sauna",
        "/digital-detox",
        "/virtual-emf-assessment",
      ]);
    });
  });

  describe("filterCandidates", () => {
    const list = pageCandidates(overview, "r2").candidates;
    it("matches the title, ignoring case", () => {
      expect(filterCandidates(list, "DET", THREE).map((c) => c.title)).toEqual(["Digital Detox Retreat"]);
    });
    it("matches the path", () => {
      expect(filterCandidates(list, "/protocols", THREE).map((c) => c.title)).toEqual(["Sauna protocol"]);
      const forAlexis = pageCandidates(overview, "r1").candidates;
      expect(filterCandidates(forAlexis, "/gifts", THREE).map((c) => c.title)).toEqual(["Gifts buying club"]);
    });
    it("matches the site name", () => {
      expect(filterCandidates(list, "alexis art", THREE).map((c) => c.title)).toEqual(["Gallery"]);
    });
    it("a blank query returns the list unchanged", () => {
      expect(filterCandidates(list, "   ", THREE)).toBe(list);
    });
  });

  describe("relativeDay", () => {
    it("today, yesterday and N days ago, by local calendar day", () => {
      expect(relativeDay(new Date(2026, 10, 21, 0, 5).toISOString(), NOW)).toBe("today");
      expect(relativeDay(new Date(2026, 10, 20, 23, 55).toISOString(), NOW)).toBe("yesterday");
      expect(relativeDay(new Date(2026, 10, 18, 9).toISOString(), NOW)).toBe("3 days ago");
    });
  });

  describe("panel render", () => {
    const render = (assign: Partial<NonNullable<OwnerState["assign"]>> = {}) => {
      const box = document.createElement("div");
      box.innerHTML = renderOwner(
        state({
          sites: THREE,
          overview,
          assignFor: "r2",
          assign: { opener: "r2", picked: [], query: "", manualOpen: false, manual: { site: "", path: "", title: "" }, error: null, busy: false, ...assign },
        }),
        NOW,
      );
      return box.querySelector("[data-assign-panel]") as HTMLElement;
    };
    const submit = (p: HTMLElement) => p.querySelector("[data-action=assign-submit]") as HTMLButtonElement;

    it("is a labeled modal dialog headed Assign pages", () => {
      const p = render();
      const dialog = p.querySelector("[role=dialog]")!;
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      const heading = p.querySelector(`#${dialog.getAttribute("aria-labelledby")}`)!;
      expect(heading.textContent).toBe("Assign pages");
      expect(p.querySelector("[data-action=assign-close]")!.getAttribute("aria-label")).toBe("Close");
    });
    it("the To control presses the chosen reviewer", () => {
      const seg = [...render().querySelectorAll("[data-action=assign-to]")];
      expect(seg.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
        ["Alexis", "false"],
        ["Ben", "true"],
      ]);
    });
    it("has a search box labeled Find a page and the Most recently assigned list", () => {
      const p = render();
      const search = p.querySelector("input[type=search]") as HTMLInputElement;
      expect(search.getAttribute("aria-label")).toBe("Find a page");
      expect(search.placeholder).toBe("Find a page");
      expect(p.querySelector(".sub-h")!.textContent).toBe("Most recently assigned");
    });
    it("one checkbox row per candidate, with site, path and who has it", () => {
      const rows = [...render({ picked: ["alexis-art|/gallery"] }).querySelectorAll(".pick")];
      expect(rows.map((r) => r.querySelector(".tt")!.textContent)).toEqual([
        "Gallery",
        "Sauna protocol",
        "Digital Detox Retreat",
        "Virtual EMF Assessment",
      ]);
      const [first, second, third] = rows;
      expect(first.querySelector("input[type=checkbox]")!.hasAttribute("checked")).toBe(true);
      expect(second.querySelector("input[type=checkbox]")!.hasAttribute("checked")).toBe(false);
      const lines = (r: Element) => [...r.querySelectorAll(".tu")].map((t) => t.textContent);
      expect(lines(first)).toEqual(["Alexis Art /gallery", "Assigned to Alexis · today"]);
      expect(lines(second)[1]).toBe("Assigned to Alexis · 2 days ago");
      expect(lines(third)[1]).toBe("Assigned to Alexis · 3 days ago");
    });
    it("says which pages the reviewer already has", () => {
      expect(render().querySelector(".already")!.textContent).toBe("Already on Ben's list: Home page, Gifts buying club");
    });
    it("offers A page that isn't listed", () => {
      const btn = render().querySelector("[data-action=assign-manual]")!;
      expect(btn.textContent).toBe("A page that isn't listed");
      expect(btn.getAttribute("aria-expanded")).toBe("false");
    });
    it("the submit counts the chosen pages and is disabled with none", () => {
      expect(submit(render()).textContent).toBe("Assign pages to Ben");
      expect(submit(render()).disabled).toBe(true);
      expect(submit(render({ picked: ["alexis-art|/gallery"] })).textContent).toBe("Assign 1 page to Ben");
      const two = submit(render({ picked: ["alexis-art|/gallery", "bonus-decade|/protocols/sauna"] }));
      expect(two.textContent).toBe("Assign 2 pages to Ben");
      expect(two.disabled).toBe(false);
    });
    it("a filled page that isn't listed counts as one more", () => {
      const p = render({ picked: ["alexis-art|/gallery"], manualOpen: true, manual: { site: "greensprings", path: "/faq", title: "FAQ" } });
      expect(submit(p).textContent).toBe("Assign 2 pages to Ben");
      expect(p.querySelector("[data-action=assign-manual]")!.getAttribute("aria-expanded")).toBe("true");
      const manual = p.querySelector("[data-manual]")!;
      expect((manual.querySelector("select[name=site]") as HTMLSelectElement).value).toBe("greensprings");
      expect((manual.querySelector("input[name=path]") as HTMLInputElement).value).toBe("/faq");
      expect((manual.querySelector("input[name=title]") as HTMLInputElement).value).toBe("FAQ");
    });
    it("the search keeps its text and narrows the list", () => {
      const p = render({ query: "det" });
      expect((p.querySelector("input[type=search]") as HTMLInputElement).value).toBe("det");
      expect([...p.querySelectorAll(".pick .tt")].map((t) => t.textContent)).toEqual(["Digital Detox Retreat"]);
    });
    it("shows a saved error line", () => {
      expect(render({ error: "Not found" }).querySelector("[data-error]")!.textContent).toBe("Not found");
    });
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
  describe("the assign panel", () => {
    const BEN = { id: "r2", name: "Ben Pellow", revoked: false, unsettled_count: 0, ready_count: 0 };
    const ben = { id: "r2", name: "Ben Pellow" };
    let assignments: OwnerAssignment[];
    let posts: Record<string, string>[];
    let failPaths: Set<string>;
    /** When set, POSTs wait for it; `postStatus` overrides the POST reply; `overviewDown` fails the reload. */
    let gate: Promise<void> | null;
    let postStatus: number | null;
    let overviewDown: boolean;
    beforeEach(() => {
      gate = null;
      postStatus = null;
      overviewDown = false;
      document.documentElement.classList.remove("ttf-lock");
      history.replaceState(null, "", "/o/#owner=tok");
      assignments = [
        a({ id: "p3", title: "Gallery", site: "greensprings", path: "/gallery", created_at: "2026-11-21T10:00:00.000Z" }),
        a({ id: "p2", title: "Home page", site: "bonus-decade", path: "/", reviewer: ben, created_at: "2026-11-20T10:00:00.000Z" }),
        a({ id: "p1", title: "Sauna protocol", site: "bonus-decade", path: "/protocols/sauna", created_at: "2026-11-19T10:00:00.000Z" }),
      ];
      posts = [];
      failPaths = new Set();
      let n = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, init?: RequestInit) => {
          if (path === "/api/owner/assignments" && init?.method === "POST") {
            const body = JSON.parse(String(init.body)) as Record<string, string>;
            posts.push(body);
            if (gate) await gate;
            if (postStatus) return new Response('{"error":"Unauthorized"}', { status: postStatus });
            if (failPaths.has(body.path)) return new Response('{"error":"Not found"}', { status: 404 });
            const r = body.reviewer_id === "r2" ? ben : { id: "r1", name: "Alexis Rivera" };
            assignments.unshift(a({ id: `new${++n}`, site: body.site, path: body.path, title: body.title, reviewer: r, created_at: `2026-11-22T00:00:0${n}.000Z` }));
            return new Response(JSON.stringify({ id: `new${n}` }), { status: 201 });
          }
          if (path.endsWith("/sites")) return new Response(JSON.stringify(SITES), { status: 200 });
          if (overviewDown && posts.length) return new Response("{}", { status: 503 });
          return new Response(JSON.stringify({ reviewers: [ALEXIS, BEN], assignments }), { status: 200 });
        }),
      );
    });
    const panel = () => document.querySelector("[data-assign-panel]") as HTMLElement | null;
    const box = (path: string) => panel()!.querySelector(`input[type=checkbox][data-key$="|${path}"]`) as HTMLInputElement;
    const tick = (path: string) => {
      const cb = box(path);
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const submit = () => panel()!.querySelector("[data-action=assign-submit]") as HTMLButtonElement;
    const openFor = (id: string) => (document.querySelector(`[data-person=${id}] [data-action=assign]`) as HTMLButtonElement).click();

    it("opens preset to the column's reviewer and closes with Escape, focus back on the opener", async () => {
      await mountOwner(window);
      openFor("r2");
      expect(panel()).not.toBeNull();
      expect(panel()!.querySelector("[aria-pressed=true]")!.textContent).toBe("Ben");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(document.querySelector("[data-person=r2] [data-action=assign]"));
    });
    it("the X closes it too", async () => {
      await mountOwner(window);
      openFor("r1");
      (panel()!.querySelector("[data-action=assign-close]") as HTMLButtonElement).click();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(document.querySelector("[data-person=r1] [data-action=assign]"));
    });
    it("ticks survive a search and a reviewer switch; the switch drops pages that reviewer has", async () => {
      await mountOwner(window);
      openFor("r2");
      tick("/gallery");
      tick("/protocols/sauna");
      expect(submit().textContent).toBe("Assign 2 pages to Ben");
      const search = panel()!.querySelector("input[type=search]") as HTMLInputElement;
      search.value = "gall";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      expect([...panel()!.querySelectorAll(".pick .tt")].map((t) => t.textContent)).toEqual(["Gallery"]);
      expect(submit().textContent).toBe("Assign 2 pages to Ben");
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      expect(box("/protocols/sauna").checked).toBe(true);
      // Switch to Alexis: she already has Gallery and Sauna, so both ticks go.
      (panel()!.querySelector("[data-action=assign-to][data-id=r1]") as HTMLButtonElement).click();
      expect(submit().textContent).toBe("Assign pages to Alexis");
      expect(box("/")).not.toBeNull();
      tick("/");
      (panel()!.querySelector("[data-action=assign-to][data-id=r2]") as HTMLButtonElement).click();
      // Ben has Home page, so that tick goes too.
      expect(submit().textContent).toBe("Assign pages to Ben");
    });
    it("the search's blur-time change event leaves the list alone, so a tap on a row lands", async () => {
      await mountOwner(window);
      openFor("r2");
      const row = box("/gallery");
      const search = panel()!.querySelector("input[type=search]") as HTMLInputElement;
      search.value = "zzz";
      search.dispatchEvent(new Event("change", { bubbles: true }));
      expect(box("/gallery")).toBe(row);
    });
    it("posts each page in turn, then closes and shows the new rows in the column", async () => {
      await mountOwner(window);
      openFor("r2");
      tick("/gallery");
      tick("/protocols/sauna");
      submit().click();
      await vi.waitFor(() => expect(panel()).toBeNull());
      expect(posts).toEqual([
        { site: "bonus-decade", reviewer_id: "r2", path: "/protocols/sauna", title: "Sauna protocol" },
        { site: "greensprings", reviewer_id: "r2", path: "/gallery", title: "Gallery" },
      ]);
      const titles = [...document.querySelectorAll("[data-person=r2] [data-row] .tt")].map((t) => t.textContent);
      expect(titles).toEqual(["Gallery", "Sauna protocol", "Home page"]);
      expect(document.activeElement).toBe(document.querySelector("[data-person=r2] [data-action=assign]"));
    });
    it("a failure keeps the panel open with the failed page ticked and the error shown", async () => {
      failPaths.add("/gallery");
      await mountOwner(window);
      openFor("r2");
      tick("/gallery");
      tick("/protocols/sauna");
      submit().click();
      await vi.waitFor(() => expect(panel()!.querySelector("[data-error]")?.textContent).toContain("Not found"));
      expect(box("/gallery").checked).toBe(true);
      expect(box("/protocols/sauna")).toBeNull(); // Ben has it now
      expect(submit().textContent).toBe("Assign 1 page to Ben");
      expect([...document.querySelectorAll("[data-person=r2] [data-row] .tt")].map((t) => t.textContent)).toContain("Sauna protocol");
    });
    it("a page that isn't listed is posted from the Site, Path and Title fields", async () => {
      await mountOwner(window);
      openFor("r1");
      (panel()!.querySelector("[data-action=assign-manual]") as HTMLButtonElement).click();
      const m = panel()!.querySelector("[data-manual]")!;
      const set = (sel: string, v: string) => {
        const el = m.querySelector(sel) as HTMLInputElement | HTMLSelectElement;
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("select[name=site]", "greensprings");
      set("input[name=path]", "/faq");
      expect(submit().textContent).toBe("Assign 1 page to Alexis");
      set("input[name=title]", "FAQ");
      submit().click();
      await vi.waitFor(() => expect(panel()).toBeNull());
      expect(posts).toEqual([{ site: "greensprings", reviewer_id: "r1", path: "/faq", title: "FAQ" }]);
    });
    const locked = () => document.documentElement.classList.contains("ttf-lock");
    it("the page behind is locked while the panel is open, and unlocked when a 401 mid-submit shows the token form", async () => {
      await mountOwner(window);
      openFor("r2");
      expect(locked()).toBe(true);
      postStatus = 401;
      tick("/gallery");
      submit().click();
      await vi.waitFor(() => expect(document.body.textContent).toContain("Paste your owner token"));
      expect(locked()).toBe(false);
    });
    it("unlocks when the reload after a submit goes offline", async () => {
      overviewDown = true;
      await mountOwner(window);
      openFor("r2");
      tick("/gallery");
      submit().click();
      await vi.waitFor(() => expect(document.body.textContent).toContain("Can't reach the review service right now."));
      expect(panel()).toBeNull();
      expect(locked()).toBe(false);
    });
    it("a failure is scrolled into view and focused, so it is seen and announced", async () => {
      failPaths.add("/gallery");
      const seen: Element[] = [];
      const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
        seen.push(this);
      });
      await mountOwner(window);
      openFor("r2");
      tick("/gallery");
      submit().click();
      await vi.waitFor(() => expect(panel()!.querySelector("[data-error]")?.textContent).toContain("Not found"));
      const err = panel()!.querySelector("[data-error]")!;
      expect(document.activeElement).toBe(err);
      expect(err.getAttribute("tabindex")).toBe("-1");
      expect(seen).toContain(err);
      spy.mockRestore();
    });
    it("Escape, the X and the scrim do nothing while a submit is in flight", async () => {
      failPaths.add("/gallery");
      let open!: () => void;
      gate = new Promise((res) => (open = res));
      await mountOwner(window);
      openFor("r2");
      tick("/gallery");
      submit().click();
      await vi.waitFor(() => expect(posts).toHaveLength(1));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      (panel()!.querySelector("[data-action=assign-close]") as HTMLButtonElement).click();
      (panel()!.querySelector("[data-action=assign-scrim]") as HTMLElement).click();
      expect(panel()).not.toBeNull();
      open();
      await vi.waitFor(() => expect(panel()!.querySelector("[data-error]")?.textContent).toContain("Not found"));
    });
    it("Enter in the Path or Title field submits", async () => {
      await mountOwner(window);
      openFor("r1");
      (panel()!.querySelector("[data-action=assign-manual]") as HTMLButtonElement).click();
      const m = panel()!.querySelector("[data-manual]")!;
      for (const [name, v] of [["path", "/faq"], ["title", "FAQ"]]) {
        const el = m.querySelector(`input[name=${name}]`) as HTMLInputElement;
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      (m.querySelector("input[name=title]") as HTMLInputElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await vi.waitFor(() => expect(panel()).toBeNull());
      expect(posts).toEqual([{ site: "bonus-decade", reviewer_id: "r1", path: "/faq", title: "FAQ" }]);
    });
    it("a page that isn't listed with no title says so and posts nothing", async () => {
      await mountOwner(window);
      openFor("r1");
      (panel()!.querySelector("[data-action=assign-manual]") as HTMLButtonElement).click();
      const path = panel()!.querySelector("[data-manual] input[name=path]") as HTMLInputElement;
      path.value = "/faq";
      path.dispatchEvent(new Event("input", { bubbles: true }));
      submit().click();
      expect(panel()!.querySelector("[data-error]")!.textContent).toBe("Fill in the Path and the Title for the page that isn't listed.");
      expect(posts).toEqual([]);
    });
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
