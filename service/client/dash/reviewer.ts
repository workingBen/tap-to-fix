// Reviewer dashboard (/r/#ttf=TOKEN): the pages a reviewer has been asked to look at.
// Pure view functions (data in, HTML out) plus a thin mount layer that talks to the API.
import { api, escapeHtml, progressRing, readToken } from "./common";
import { DASH_CSS } from "./dash.css";

export type MeAssignment = {
  id: string;
  site: { slug: string; name: string; origin: string };
  path: string;
  title: string;
  url: string;
  status: "not_started" | "open" | "in_progress" | "done";
  progress: number;
  counts: { total: number; settled: number; in_progress: number; open: number };
  is_new: boolean;
  is_updated: boolean;
};
export type MeResponse = { name: string; assignments: MeAssignment[] };
export type Chip = "Updated since you looked" | "New" | "All done";

export const STORAGE_KEY = "ttf:dash-token";
const OPENED_WAIT_MS = 1500;

const MSG_EMPTY = "Nothing to review yet. Ben will add pages here.";
const MSG_REVOKED = "This link no longer works. Ask for a new one.";
const MSG_OFFLINE = "Can't reach the review service right now.";

export function chipFor(a: MeAssignment): Chip | null {
  if (a.is_updated) return "Updated since you looked";
  if (a.is_new) return "New";
  if (a.counts.total > 0 && a.counts.settled === a.counts.total) return "All done";
  return null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function countLine(a: MeAssignment): string {
  const { total, in_progress, settled } = a.counts;
  if (total === 0) return "No comments yet";
  const parts = [plural(total, "comment", "comments")];
  if (in_progress > 0) parts.push(`${in_progress} being fixed`);
  if (settled > 0) parts.push(`${settled} settled`);
  return parts.join(" · ");
}

const CHECK =
  '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHEVRON =
  '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';

function chipHtml(chip: Chip | null): string {
  if (!chip) return "";
  if (chip === "All done") return `<span class="chip plain">${CHECK}${escapeHtml(chip)}</span>`;
  return `<span class="chip soft">${escapeHtml(chip)}</span>`;
}

/** `grouped`: rows sit under a site heading, so the site name is not repeated. */
function rowHtml(a: MeAssignment, grouped = false): string {
  return (
    `<a class="row" href="${escapeHtml(a.url)}" data-assignment="${escapeHtml(a.id)}">` +
    `<span class="ring">${progressRing(a.progress, 44)}</span>` +
    `<span class="main">` +
    `<span class="title">${escapeHtml(a.title)}</span>` +
    `<span class="where">${grouped ? "" : `${escapeHtml(a.site.name)} · `}<span class="path">${escapeHtml(a.path)}</span></span>` +
    // Each part stays whole, so a narrow screen breaks the line between parts, not inside one.
    `<span class="counts">${countLine(a)
      .split(" · ")
      .map((p) => `<span class="part">${escapeHtml(p)}</span>`)
      .join(" · ")}</span>` +
    `</span>` +
    chipHtml(chipFor(a)) +
    `<span class="chev">${CHEVRON}</span>` +
    `</a>`
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

export function renderReviewer(data: MeResponse): string {
  const first = firstName(data.name);
  const head =
    `<h1 class="hello">${first ? `Hi ${escapeHtml(first)}.` : "Hi."}</h1>` +
    `<p class="lede">Tap a page to open it, then tap anything on it that should change.</p>`;
  if (data.assignments.length === 0) return head + `<p class="empty">${MSG_EMPTY}</p>`;

  // Group by site, keeping the order sites first appear in.
  const groups = new Map<string, { name: string; rows: MeAssignment[] }>();
  for (const a of data.assignments) {
    const g = groups.get(a.site.slug) ?? { name: a.site.name, rows: [] };
    g.rows.push(a);
    groups.set(a.site.slug, g);
  }
  if (groups.size === 1) return head + `<div class="list">${data.assignments.map((a) => rowHtml(a)).join("")}</div>`;
  return (
    head +
    [...groups.values()]
      .map(
        (g) =>
          `<section><h2 class="site" data-site-heading>${escapeHtml(g.name)}</h2>` +
          `<div class="list">${g.rows.map((a) => rowHtml(a, true)).join("")}</div></section>`,
      )
      .join("")
  );
}

export const REVIEWER_CSS = `
main { padding-top: 40px; }
.hello { font: 600 30px/1.15 var(--hf); margin: 0 0 10px; letter-spacing: -0.01em; }
.lede { font-size: 17px; line-height: 1.5; color: var(--mut); margin: 0 0 28px; max-width: 34em; }
.empty, .notice { font: 400 21px/1.45 var(--hf); margin: 32px 0 0; padding-top: 24px; border-top: 1px solid var(--line); }
.notice:first-child { border-top: 0; padding-top: 0; margin-top: 24px; }
.muted { color: var(--mut); }
section + section { margin-top: 40px; }
.site { font: 600 22px/1.25 var(--hf); margin: 0 0 6px; }
.list { border-top: 1px solid var(--line); }
.row {
  display: grid; grid-template-columns: 44px minmax(0, 1fr) 22px;
  grid-template-areas: "ring main chev" ". chip chev";
  column-gap: 14px; align-items: center;
  min-height: 72px; padding: 18px 0;
  border-bottom: 1px solid var(--line); text-decoration: none; color: var(--ink);
  -webkit-tap-highlight-color: transparent;
}
.row:hover { background: var(--surf); }
.row:active { background: var(--soft); }
.row:focus-visible { outline: 3px solid var(--acc); outline-offset: -3px; border-radius: 6px; }
.ring { grid-area: ring; align-self: start; margin-top: 2px; display: block; line-height: 0; }
.main { grid-area: main; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.title { font: 600 20px/1.3 var(--hf); overflow-wrap: anywhere; }
.where { font-size: 17px; line-height: 1.4; color: var(--mut); }
.path { display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
.part { white-space: nowrap; }
.counts { font-size: 17px; line-height: 1.4; }
.chev { grid-area: chev; color: var(--mut); line-height: 0; }
.chip {
  grid-area: chip; justify-self: start; margin-top: 10px;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 17px; font-weight: 600; line-height: 1.2; padding: 7px 15px; border-radius: 999px; white-space: nowrap;
}
.chip.soft { background: var(--soft); color: var(--acc); }
.chip.plain { color: var(--acc); padding-left: 0; padding-right: 0; }
.retry {
  display: inline-flex; align-items: center; justify-content: center; min-height: 48px; margin-top: 18px;
  padding: 0 26px; border: 0; border-radius: 999px; background: var(--acc); color: var(--acc-ink);
  font: 600 18px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", system-ui, sans-serif; cursor: pointer;
}
.retry:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
@media (min-width: 640px) {
  main { padding-top: 64px; }
  .hello { font-size: 36px; }
  .lede { font-size: 18px; margin-bottom: 36px; }
  .row { grid-template-columns: 44px minmax(0, 1fr) auto 22px; grid-template-areas: "ring main chip chev"; padding: 20px 0; }
  .chip { margin-top: 0; justify-self: end; }
}
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById("ttf-dash-style")) return;
  const style = doc.createElement("style");
  style.id = "ttf-dash-style";
  style.textContent = DASH_CSS + REVIEWER_CSS;
  doc.head.appendChild(style);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function mountReviewer(win: Window): Promise<void> {
  const doc = win.document;
  ensureStyle(doc);
  const host = doc.getElementById("app") ?? doc.body;
  host.innerHTML = '<main aria-live="polite"></main>';
  const main = host.querySelector("main")!;

  const token = readToken(win, "ttf", STORAGE_KEY);
  if (!token) {
    main.innerHTML = `<p class="notice">${MSG_REVOKED}</p>`;
    return;
  }
  // Keep a working link in the address bar so "Add to Home Screen" saves one.
  if (!/(?:^#|&)ttf=/.test(win.location.hash)) {
    try {
      win.history.replaceState(null, "", win.location.pathname + win.location.search + "#ttf=" + encodeURIComponent(token));
    } catch {
      /* not fatal */
    }
  }

  main.addEventListener("click", (ev) => {
    const target = ev.target as Element | null;
    const row = target?.closest?.("a[data-assignment]") as HTMLAnchorElement | null;
    if (!row || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    const id = row.getAttribute("data-assignment") ?? "";
    const href = row.getAttribute("href") ?? "";
    const opened = api(token, `/api/me/assignments/${encodeURIComponent(id)}/opened`, { method: "POST", keepalive: true });
    void Promise.race([opened, sleep(OPENED_WAIT_MS)]).then(() => {
      win.location.href = href;
    });
  });

  const load = async (): Promise<void> => {
    main.innerHTML = '<p class="notice muted">Loading…</p>';
    const res = await api<MeResponse>(token, "/api/me");
    if (res.ok) {
      main.innerHTML = renderReviewer(res.data);
      return;
    }
    if (res.status === 401 || res.status === 403) {
      main.innerHTML = `<p class="notice">${MSG_REVOKED}</p>`;
      return;
    }
    main.innerHTML = `<p class="notice">${MSG_OFFLINE}</p><button type="button" class="retry">Try again</button>`;
    main.querySelector("button.retry")!.addEventListener("click", () => void load());
  };
  await load();
}

if (typeof document !== "undefined" && document.getElementById("app")) void mountReviewer(window);
