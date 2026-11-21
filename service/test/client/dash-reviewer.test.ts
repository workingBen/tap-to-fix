// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chipFor, countLine, mountReviewer, renderReviewer, type MeAssignment } from "../../client/dash/reviewer";

function assignment(over: Partial<MeAssignment> = {}, counts: Partial<MeAssignment["counts"]> = {}): MeAssignment {
  return {
    id: "a1",
    site: { slug: "bonus-decade", name: "Bonus Decade", origin: "https://bonusdecade.com" },
    path: "/sauna",
    title: "Sauna guide",
    url: "https://bonusdecade.com/sauna#ttf=tok",
    status: "not_started",
    progress: 0,
    counts: { total: 0, settled: 0, in_progress: 0, open: 0, ...counts },
    is_new: false,
    is_updated: false,
    ...over,
  };
}

describe("chipFor", () => {
  it("updated beats new", () => {
    expect(chipFor(assignment({ is_updated: true, is_new: true }))).toBe("Updated since you looked");
  });
  it("new when never opened", () => {
    expect(chipFor(assignment({ is_new: true }))).toBe("New");
  });
  it("new beats all done", () => {
    expect(chipFor(assignment({ is_new: true }, { total: 2, settled: 2 }))).toBe("New");
  });
  it("all done only when there are comments and all are settled", () => {
    expect(chipFor(assignment({}, { total: 2, settled: 2 }))).toBe("All done");
    expect(chipFor(assignment({}, { total: 0, settled: 0 }))).toBeNull();
    expect(chipFor(assignment({}, { total: 3, settled: 2, open: 1 }))).toBeNull();
  });
});

describe("countLine", () => {
  it("no comments", () => {
    expect(countLine(assignment())).toBe("No comments yet");
  });
  it("one comment is singular", () => {
    expect(countLine(assignment({}, { total: 1, open: 1 }))).toBe("1 comment");
  });
  it("mixed counts", () => {
    expect(countLine(assignment({}, { total: 3, in_progress: 1, settled: 2 }))).toBe(
      "3 comments · 1 being fixed · 2 settled",
    );
  });
  it("leaves out zero parts", () => {
    expect(countLine(assignment({}, { total: 2, settled: 2 }))).toBe("2 comments · 2 settled");
  });
});

describe("renderReviewer", () => {
  it("greets by first name", () => {
    const html = renderReviewer({ name: "Alexis Rivera", assignments: [assignment()] });
    expect(html).toContain("Hi Alexis.");
    expect(html).toContain("Tap a page to open it, then tap anything on it that should change.");
  });
  it("escapes titles", () => {
    const html = renderReviewer({ name: "Alexis", assignments: [assignment({ title: "<script>alert(1)</script>" })] });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("shows site, path and count line", () => {
    const html = renderReviewer({ name: "Alexis", assignments: [assignment({}, { total: 3, in_progress: 1, settled: 2 })] });
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent;
    expect(text).toContain("Bonus Decade · /sauna");
    expect(text).toContain("3 comments · 1 being fixed · 2 settled");
  });
  it("groups under site headings only when there is more than one site", () => {
    const one = renderReviewer({ name: "Alexis", assignments: [assignment(), assignment({ id: "a2", path: "/cold" })] });
    expect(one).not.toContain("data-site-heading");
    const other = assignment({ id: "a3", site: { slug: "gl", name: "Greensprings", origin: "https://greensprings.life" } });
    const two = renderReviewer({ name: "Alexis", assignments: [assignment(), other, assignment({ id: "a2" })] });
    const doc = new DOMParser().parseFromString(two, "text/html");
    const headings = [...doc.querySelectorAll("[data-site-heading]")].map((h) => h.textContent);
    expect(headings).toEqual(["Bonus Decade", "Greensprings"]);
    // Both Bonus Decade rows sit in the first group.
    expect(doc.querySelectorAll("section")[0].querySelectorAll("a[data-assignment]").length).toBe(2);
  });
  it("empty state", () => {
    const html = renderReviewer({ name: "Alexis", assignments: [] });
    expect(html).toContain("Nothing to review yet. Ben will add pages here.");
  });
  it("chip styles: soft for updated and new, plain for all done", () => {
    const html = renderReviewer({
      name: "Alexis",
      assignments: [assignment({ is_new: true }), assignment({ id: "a2" }, { total: 1, settled: 1 })],
    });
    expect(html).toMatch(/class="chip soft"[^>]*>New/);
    expect(html).toMatch(/class="chip plain"[^>]*>[\s\S]*All done/);
  });
});

describe("mountReviewer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/r/");
  });

  it("no token says the link no longer works", async () => {
    window.history.replaceState(null, "", "/r/");
    await mountReviewer(window);
    expect(document.body.textContent).toContain("This link no longer works. Ask for a new one.");
  });
  it("401 says the link no longer works", async () => {
    window.history.replaceState(null, "", "/r/#ttf=bad");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await mountReviewer(window);
    expect(document.body.textContent).toContain("This link no longer works. Ask for a new one.");
  });
  it("network error offers Try again, which retries", async () => {
    window.history.replaceState(null, "", "/r/#ttf=tok");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Alexis", assignments: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await mountReviewer(window);
    expect(document.body.textContent).toContain("Can't reach the review service right now.");
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(btn).toBeTruthy();
    btn!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Nothing to review yet."));
  });
  it("restores the hash from storage so the address bar keeps a working link", async () => {
    window.localStorage.setItem("ttf:dash-token", "kept");
    window.history.replaceState(null, "", "/r/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "Alexis", assignments: [] }))));
    await mountReviewer(window);
    expect(window.location.hash).toBe("#ttf=kept");
  });
});
