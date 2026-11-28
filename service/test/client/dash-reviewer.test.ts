// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countLine,
  mountReviewer,
  noticeHtml,
  readWaiting,
  renderReviewer,
  sectionFor,
  stateFor,
  stateIcon,
  WAITING_KEY,
  type MeAssignment,
} from "../../client/dash/reviewer";
import { encodeWaiting } from "../../client/handoff";

const ids = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(from + i).padStart(12, "0")}`);

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

describe("sectionFor", () => {
  it("new when never opened, even if something changed", () => {
    expect(sectionFor(assignment({ is_new: true, is_updated: true }))).toBe("new");
  });
  it("updated when opened and changed since", () => {
    expect(sectionFor(assignment({ is_updated: true }))).toBe("updated");
  });
  it("looked at otherwise, all done or not", () => {
    expect(sectionFor(assignment())).toBe("seen");
    expect(sectionFor(assignment({}, { total: 2, settled: 2 }))).toBe("seen");
  });
  it("finished wins over everything, so a finished page never comes back to the top", () => {
    expect(sectionFor(assignment({ finished: true, is_new: true, is_updated: true }))).toBe("finished");
  });
});

describe("stateFor and stateIcon", () => {
  it("four states", () => {
    expect(stateFor(assignment())).toBe("none");
    expect(stateFor(assignment({}, { total: 3, open: 3 }))).toBe("waiting");
    expect(stateFor(assignment({}, { total: 4, settled: 2, open: 2 }))).toBe("some");
    expect(stateFor(assignment({}, { total: 2, settled: 2 }))).toBe("done");
  });
  it("differ by shape: outline bubble, filled amber bubble, pie, check disc", () => {
    const none = stateIcon("none");
    expect(none).toContain('fill="none"');
    expect(none).toContain('stroke="var(--mut)"');
    expect(stateIcon("waiting")).toContain('fill="var(--warn)"');
    const some = stateIcon("some", 0.5);
    expect(some).toContain("<circle");
    expect(some).toMatch(/<path d="M11 11L11 0A11 11/);
    const done = stateIcon("done");
    expect(done).toContain('fill="var(--acc)"');
    expect(done).toContain('stroke="#fff"');
    for (const svg of [none, some, done]) expect(svg).toContain('aria-hidden="true"');
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
    expect(html).toContain("Tap a page to open it. Then tap Comment, and tap anything that should change.");
  });
  it("escapes titles", () => {
    const html = renderReviewer({ name: "Alexis", assignments: [assignment({ title: "<script>alert(1)</script>" })] });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("shows the path and count line, and the site name only with two or more sites", () => {
    const one = renderReviewer({ name: "Alexis", assignments: [assignment({}, { total: 3, in_progress: 1, settled: 2 })] });
    const doc = new DOMParser().parseFromString(one, "text/html");
    expect(doc.querySelector(".counts")?.textContent).toBe("3 comments · 1 being fixed · 2 settled");
    expect(doc.querySelector(".where")?.textContent).toBe("· /sauna");
    const other = assignment({ id: "a3", site: { slug: "gl", name: "Greensprings", origin: "https://greensprings.life" } });
    const two = new DOMParser().parseFromString(renderReviewer({ name: "Alexis", assignments: [assignment(), other] }), "text/html");
    expect([...two.querySelectorAll(".where")].map((w) => w.textContent)).toEqual(["· Bonus Decade · /sauna", "· Greensprings · /sauna"]);
  });
  it("sorts pages into New, Updated since you looked and Looked at, hiding empty sections", () => {
    const html = renderReviewer({
      name: "Alexis",
      assignments: [
        assignment({ id: "s1", title: "Seen" }),
        assignment({ id: "n1", title: "Fresh", is_new: true }),
        assignment({ id: "u1", title: "Changed", is_updated: true }),
        assignment({ id: "s2", title: "Seen two" }, { total: 1, settled: 1 }),
      ],
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const secs = [...doc.querySelectorAll("section[data-section]")];
    expect(secs.map((s) => s.querySelector("h2")?.textContent)).toEqual(["New 1", "Updated since you looked 1", "Looked at 2"]);
    expect(secs.map((s) => [...s.querySelectorAll("a[data-assignment] .title")].map((t) => t.textContent))).toEqual([
      ["Fresh"],
      ["Changed"],
      ["Seen", "Seen two"],
    ]);
    // Only the all-done row has the badge; New and Updated are said by the headings.
    expect([...doc.querySelectorAll(".bdg")].map((b) => b.closest("a")?.getAttribute("data-assignment"))).toEqual(["s2"]);
    expect(doc.querySelector("details[data-section=finished]")).toBeNull();
    const none = renderReviewer({ name: "Alexis", assignments: [assignment()] });
    expect(none).not.toContain('data-section="new"');
    expect(none).not.toContain('data-section="updated"');
  });
  it("each row has a 44 px ⋯ actions button; finished rows sit in a closed Finished list with Re-review", () => {
    const html = renderReviewer({
      name: "Alexis",
      assignments: [assignment({ id: "a1" }), assignment({ id: "f1", title: "Done page", finished: true }, { total: 2, settled: 2 })],
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector('[data-actions="a1"]')?.getAttribute("aria-label")).toBe("Actions for Sauna guide");
    const fin = doc.querySelector("details[data-section=finished]")!;
    expect(fin.hasAttribute("open")).toBe(false);
    expect(fin.querySelector("summary")?.textContent).toBe("Finished 1");
    expect(fin.querySelector('[data-rereview="f1"]')?.textContent).toBe("Re-review");
    expect(fin.querySelector("[data-actions]")).toBeNull();
    expect(fin.querySelector(".bdg")).toBeNull();
    expect(renderReviewer({ name: "A", assignments: [assignment({ finished: true })] }, {}, { finishedOpen: true })).toContain(
      'data-section="finished" open',
    );
  });
  it("says so when every page is finished", () => {
    const html = renderReviewer({ name: "Alexis", assignments: [assignment({ finished: true })] });
    expect(html).toContain("Every page is finished.");
  });
  it("empty state", () => {
    const html = renderReviewer({ name: "Alexis", assignments: [] });
    expect(html).toContain("Nothing to review yet. Ben will add pages here.");
  });
});

describe("Since you last looked notice", () => {
  const pages = [
    assignment({ id: "a1", title: "Virtual EMF Assessment", url: "https://x.test/emf#ttf=t" }),
    assignment({ id: "a2", title: "Home page", finished: true }),
  ];
  it("one line per page with how many were fixed, Finished pages tagged, and Got it", () => {
    const html = renderReviewer({
      name: "Ben",
      assignments: pages,
      fixed: { through: "2026-01-01T00:00:00.000Z", pages: [{ id: "a1", title: "x", fixed: 2, finished: false }, { id: "a2", title: "y", fixed: 1, finished: true }] },
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nt = doc.querySelector("[data-notice]")!;
    expect(nt.querySelector("h2")?.textContent).toBe("Since you last looked");
    expect(nt.querySelector("button[data-ack]")?.textContent).toBe("Got it");
    const lines = [...nt.querySelectorAll("a.li")];
    expect(lines.map((l) => l.textContent)).toEqual(["Virtual EMF Assessment2 fixed", "Home pageFinished1 fixed"]);
    expect(lines[0].getAttribute("href")).toBe("https://x.test/emf#ttf=t");
    expect(lines[0].getAttribute("data-open")).toBe("a1");
    // The finished page stays in Finished; the notice only names it.
    expect(doc.querySelector("details[data-section=finished] a[data-assignment=a2]")).toBeTruthy();
  });
  it("nothing fixed, or an unknown page: no notice", () => {
    expect(noticeHtml([], pages)).toBe("");
    expect(noticeHtml([{ id: "gone", title: "Gone", fixed: 3, finished: false }], pages)).toBe("");
    expect(renderReviewer({ name: "Ben", assignments: pages })).not.toContain("data-notice");
  });
});

describe("waiting comments (offline mode's hand-off)", () => {
  const text = (html: string) => new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  it("one line with the total, and a note on each row that has some", () => {
    const html = renderReviewer(
      {
        name: "Ben",
        assignments: [assignment({}, { total: 1, open: 1 }), assignment({ id: "a2", path: "/cold", title: "Cold plunge" })],
      },
      { "bonus-decade": { "/sauna": ids(2), "/cold": ids(1, 3), "/not-mine": ids(4, 4) } },
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("[data-waiting-line] b")?.textContent).toBe("3 comments waiting to send");
    expect(doc.querySelector("[data-waiting-line]")?.textContent).toContain("Open each page while you're online and they send.");
    const rows = [...doc.querySelectorAll(".counts")].map((c) => c.textContent);
    // A page with no saved comments shows only what is waiting, not "No comments yet".
    expect(rows).toEqual(["1 comment · 2 waiting to send", "1 waiting to send"]);
  });
  it("one waiting is singular, and nothing waiting shows no line", () => {
    expect(text(renderReviewer({ name: "Ben", assignments: [assignment()] }, { "bonus-decade": { "/sauna": ids(1) } }))).toContain(
      "1 comment waiting to send",
    );
    const none = renderReviewer({ name: "Ben", assignments: [assignment()] }, {});
    expect(none).not.toContain("data-waiting-line");
    expect(text(none)).toContain("No comments yet");
  });
  it("counts from another site's slug never land on this site's rows", () => {
    const html = renderReviewer({ name: "Ben", assignments: [assignment()] }, { gl: { "/sauna": ids(5) } });
    expect(html).not.toContain("waiting to send");
  });
});

describe("readWaiting", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.history.replaceState(null, "", "/r/"));
  it("keeps the Done link's report, and a later report of none clears that site", () => {
    const [a, b, c] = ids(3);
    window.history.replaceState(null, "", "/r/#ttf=tok&" + encodeWaiting("bonus-decade", { "/sauna": [a, b] }));
    expect(readWaiting(window)).toEqual({ "bonus-decade": { "/sauna": [a, b] } });
    window.history.replaceState(null, "", "/r/#ttf=tok&" + encodeWaiting("gl", { "/x": [c] }));
    expect(readWaiting(window)).toEqual({ "bonus-decade": { "/sauna": [a, b] }, gl: { "/x": [c] } });
    window.history.replaceState(null, "", "/r/#ttf=tok");
    expect(readWaiting(window)).toEqual({ "bonus-decade": { "/sauna": [a, b] }, gl: { "/x": [c] } }); // kept between visits
    window.history.replaceState(null, "", "/r/#ttf=tok&" + encodeWaiting("bonus-decade", { "/sauna": [] }));
    expect(readWaiting(window)).toEqual({ gl: { "/x": [c] } });
    expect(JSON.parse(window.localStorage.getItem(WAITING_KEY)!)).toEqual({ gl: { "/x": [c] } });
  });
  it("drops stored bare counts (from before ids): they can never be checked off", () => {
    const [a] = ids(1);
    window.localStorage.setItem(WAITING_KEY, JSON.stringify({ s: { "/old": 1, "/new": [a] }, t: { "/old": 2 } }));
    window.history.replaceState(null, "", "/r/#ttf=tok");
    expect(readWaiting(window)).toEqual({ s: { "/new": [a] } });
  });
  it("ignores junk in storage", () => {
    window.localStorage.setItem(WAITING_KEY, "not json");
    window.history.replaceState(null, "", "/r/#ttf=tok");
    expect(readWaiting(window)).toEqual({});
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
  /** /api/me answers with one Sauna page; the page's comment list holds `onServer` client ids. */
  const service = (onServer: string[], list: "ok" | "down" = "ok") =>
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/me/pages/comments")) {
        if (list === "down") throw new TypeError("offline");
        expect(url).toBe("/api/me/pages/comments?site=bonus-decade&path=%2Fsauna");
        return new Response(JSON.stringify({ comments: onServer.map((client_id) => ({ client_id })) }));
      }
      return new Response(JSON.stringify({ name: "Ben", assignments: [assignment({}, { total: onServer.length })] }));
    });
  it("shows the Done link's waiting comments, then drops them from the address but keeps the token", async () => {
    window.history.replaceState(null, "", "/r/#ttf=tok&" + encodeWaiting("bonus-decade", { "/sauna": ids(2) }));
    vi.stubGlobal("fetch", service([]));
    await mountReviewer(window);
    expect(document.body.textContent).toContain("2 comments waiting to send");
    expect(window.location.hash).toBe("#ttf=tok");
  });
  it("a waiting comment that has since reached the service stops showing as waiting", async () => {
    const [sent, unsent] = ids(2);
    window.localStorage.setItem(WAITING_KEY, JSON.stringify({ "bonus-decade": { "/sauna": [sent, unsent] } }));
    window.history.replaceState(null, "", "/r/#ttf=tok");
    vi.stubGlobal("fetch", service([sent]));
    await mountReviewer(window);
    await vi.waitFor(() => expect(document.body.textContent).toContain("1 comment waiting to send"));
    expect(JSON.parse(window.localStorage.getItem(WAITING_KEY)!)).toEqual({ "bonus-decade": { "/sauna": [unsent] } });
  });
  it("once every waiting comment has arrived, the line and the row note go", async () => {
    const [sent] = ids(1);
    window.localStorage.setItem(WAITING_KEY, JSON.stringify({ "bonus-decade": { "/sauna": [sent] } }));
    window.history.replaceState(null, "", "/r/#ttf=tok");
    vi.stubGlobal("fetch", service([sent]));
    await mountReviewer(window);
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("waiting to send"));
    expect(document.body.textContent).toContain("1 comment");
    expect(JSON.parse(window.localStorage.getItem(WAITING_KEY)!)).toEqual({});
  });
  it("if the comment list can't be fetched, the waiting count stays as it was", async () => {
    window.localStorage.setItem(WAITING_KEY, JSON.stringify({ "bonus-decade": { "/sauna": ids(1) } }));
    window.history.replaceState(null, "", "/r/#ttf=tok");
    vi.stubGlobal("fetch", service([], "down"));
    await mountReviewer(window);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain("1 comment waiting to send");
  });
  it("restores the hash from storage so the address bar keeps a working link", async () => {
    window.localStorage.setItem("ttf:dash-token", "kept");
    window.history.replaceState(null, "", "/r/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "Alexis", assignments: [] }))));
    await mountReviewer(window);
    expect(window.location.hash).toBe("#ttf=kept");
  });
});

describe("mountReviewer actions", () => {
  type Call = { url: string; method: string; body: string | null };
  let calls: Call[];
  const me = (over: object = {}) => ({
    name: "Ben",
    assignments: [
      assignment({ id: "a1", title: "Virtual EMF Assessment" }, { total: 2, settled: 2 }),
      assignment({ id: "f1", title: "Home page", finished: true }),
    ],
    fixed: { through: "2026-01-02T00:00:00.000Z", pages: [{ id: "a1", title: "Virtual EMF Assessment", fixed: 2, finished: false }] },
    ...over,
  });
  const serve = (data: object, fail: RegExp | null = null) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null });
        if (fail && fail.test(url)) return new Response("{}", { status: 500 });
        if (url === "/api/me") return new Response(JSON.stringify(data));
        return new Response(null, { status: 204 });
      }),
    );
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);

  beforeEach(() => {
    calls = [];
    window.localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState(null, "", "/r/#ttf=tok");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/r/");
  });

  it("⋯ opens the sheet; Cancel and Escape close it and focus goes back to ⋯", async () => {
    serve(me());
    await mountReviewer(window);
    const dots = q('[data-actions="a1"]')!;
    dots.click();
    expect(q(".sheet")?.getAttribute("role")).toBe("dialog");
    expect(q(".sheet .sht")?.textContent).toBe("Virtual EMF Assessment");
    expect([...document.querySelectorAll(".sheet .sbtn")].map((b) => b.textContent)).toEqual(["Review complete", "Open the page", "Cancel"]);
    expect(document.activeElement).toBe(q(".sheet [data-finish]"));
    q<HTMLButtonElement>(".sheet .sbtn.plain")!.click();
    expect(q(".sheet")).toBeNull();
    expect(document.activeElement).toBe(q('[data-actions="a1"]'));
    q('[data-actions="a1"]')!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(q(".sheet")).toBeNull();
  });

  it("Review complete saves and moves the page into Finished; the notice tags it", async () => {
    serve(me());
    await mountReviewer(window);
    q('[data-actions="a1"]')!.click();
    q(".sheet [data-finish]")!.click();
    await vi.waitFor(() => expect(q(".sheet")).toBeNull());
    expect(calls.at(-1)).toMatchObject({ url: "/api/me/assignments/a1/finished", method: "POST" });
    expect(q("details[data-section=finished] summary")?.textContent).toBe("Finished 2");
    expect(q("details[data-section=finished] a[data-assignment=a1]")).toBeTruthy();
    expect(q("section[data-section]")).toBeNull();
    expect(q("[data-notice] a.li")?.textContent).toContain("Finished");
  });

  it("a failed Review complete keeps the sheet open with a message", async () => {
    serve(me(), /finished/);
    await mountReviewer(window);
    q('[data-actions="a1"]')!.click();
    q(".sheet [data-finish]")!.click();
    await vi.waitFor(() => expect(q<HTMLElement>("[data-sheet-error]")!.hidden).toBe(false));
    expect(q("[data-sheet-error]")?.textContent).toContain("Couldn't save");
    expect(q("section[data-section=seen] a[data-assignment=a1]")).toBeTruthy();
  });

  it("Re-review brings a finished page back, and keeps Finished open if it was", async () => {
    serve(me({ assignments: [assignment({ id: "f1", title: "Home page", finished: true }), assignment({ id: "f2", finished: true })] }));
    await mountReviewer(window);
    const det = q<HTMLDetailsElement>("details[data-section=finished]")!;
    det.open = true;
    det.dispatchEvent(new Event("toggle"));
    q('[data-rereview="f1"]')!.click();
    await vi.waitFor(() => expect(q("section[data-section=seen] a[data-assignment=f1]")).toBeTruthy());
    expect(calls.at(-1)).toMatchObject({ url: "/api/me/assignments/f1/finished", method: "DELETE" });
    expect(q<HTMLDetailsElement>("details[data-section=finished]")!.open).toBe(true);
  });

  it("Got it hides the notice and sends back the time it was built from", async () => {
    serve(me());
    await mountReviewer(window);
    expect(q("[data-notice]")).toBeTruthy();
    q("[data-ack]")!.click();
    expect(q("[data-notice]")).toBeNull();
    await vi.waitFor(() => expect(calls.at(-1)?.url).toBe("/api/me/acknowledge"));
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: JSON.stringify({ through: "2026-01-02T00:00:00.000Z" }) });
  });

  it("a notice line marks the page opened, like its row", async () => {
    serve(me());
    await mountReviewer(window);
    q("[data-notice] a.li")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await vi.waitFor(() => expect(calls.at(-1)).toMatchObject({ url: "/api/me/assignments/a1/opened", method: "POST" }));
  });
});
