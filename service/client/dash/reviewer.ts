// Reviewer dashboard (/r/#ttf=TOKEN): the pages a reviewer has been asked to look at.
// Pure view functions (data in, HTML out) plus a thin mount layer that talks to the API.
import { api, escapeHtml, readToken } from "./common";
import { DASH_CSS } from "./dash.css";
import { decodeWaiting, forgetSent, mergeWaiting, stripWaiting, type WaitingBySite } from "../handoff";

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
  /** The reviewer tapped Review complete; the page sits in Finished. */
  finished?: boolean;
};
/** One page in the "Since you last looked" notice: comments settled since the last Got it. */
export type FixedPage = { id: string; title: string; fixed: number; finished: boolean };
export type MeResponse = {
  name: string;
  assignments: MeAssignment[];
  fixed?: { through: string | null; pages: FixedPage[] };
};
export type Section = "new" | "updated" | "seen" | "finished";
/** What the row's icon shows. */
export type RowState = "none" | "waiting" | "some" | "done";

export const STORAGE_KEY = "ttf:dash-token";
/** Comments waiting to send on each site (client ids), as the overlay's Done link last reported them. */
export const WAITING_KEY = "ttf:waiting";
const OPENED_WAIT_MS = 1500;

const MSG_EMPTY = "Nothing to review yet. Ben will add pages here.";
const MSG_ALL_FINISHED = "Every page is finished. They are under Finished below.";
const MSG_REVOKED = "This link no longer works. Ask for a new one.";
const MSG_OFFLINE = "Can't reach the review service right now.";
const MSG_SAVE_FAILED = "Couldn't save. Check the connection and try again.";

export const SECTION_TITLES: Record<Exclude<Section, "finished">, string> = {
  new: "New",
  updated: "Updated since you looked",
  seen: "Looked at",
};

export function sectionFor(a: MeAssignment): Section {
  if (a.finished) return "finished";
  if (a.is_new) return "new";
  if (a.is_updated) return "updated";
  return "seen";
}

export function stateFor(a: MeAssignment): RowState {
  const { total, settled } = a.counts;
  if (total === 0) return "none";
  if (settled === total) return "done";
  if (settled > 0) return "some";
  return "waiting";
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

/** This dashboard's copy of the waiting counts, with any report in the address folded in. */
export function readWaiting(win: Window): WaitingBySite {
  let known: WaitingBySite = {};
  try {
    const raw = JSON.parse(win.localStorage.getItem(WAITING_KEY) ?? "{}") as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) known = keepIds(raw as Record<string, unknown>);
  } catch {
    known = {};
  }
  const report = decodeWaiting(win.location.hash);
  if (!report) return known;
  known = mergeWaiting(known, report);
  saveWaiting(win, known);
  return known;
}

/** Only lists of ids survive: a bare count (kept before ids) can never be checked off. */
function keepIds(raw: Record<string, unknown>): WaitingBySite {
  const out: WaitingBySite = {};
  for (const [site, pages] of Object.entries(raw)) {
    if (!pages || typeof pages !== "object") continue;
    for (const [path, ids] of Object.entries(pages as Record<string, unknown>)) {
      if (!Array.isArray(ids)) continue;
      const kept = ids.filter((id): id is string => typeof id === "string");
      if (kept.length) (out[site] ??= {})[path] = kept;
    }
  }
  return out;
}

function saveWaiting(win: Window, known: WaitingBySite): void {
  try {
    win.localStorage.setItem(WAITING_KEY, JSON.stringify(known));
  } catch {
    /* storage blocked: the counts still show for this visit */
  }
}

/**
 * Asks the service which waiting comments have arrived since the Done link reported them: each
 * sends when its page is next opened online, and that page never reports back here. One request
 * per page with something waiting; a page that can't be checked keeps its count.
 */
export async function checkSent(token: string, known: WaitingBySite, assignments: MeAssignment[]): Promise<WaitingBySite> {
  let next = known;
  for (const a of assignments) {
    if (!known[a.site.slug]?.[a.path]?.length) continue;
    const q = `site=${encodeURIComponent(a.site.slug)}&path=${encodeURIComponent(a.path)}`;
    const res = await api<{ comments: { client_id: string | null }[] }>(token, `/api/me/pages/comments?${q}`);
    if (!res.ok) continue;
    const onServer = new Set(res.data.comments.map((c) => c.client_id).filter((id): id is string => !!id));
    next = forgetSent(next, a.site.slug, a.path, onServer);
  }
  return next;
}

const waitingFor = (w: WaitingBySite, a: MeAssignment): number => {
  return w[a.site.slug]?.[a.path]?.length ?? 0;
};

const PHONE =
  '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M11 18h2"/></svg>';
const check = (size: number) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const CHEVRON =
  '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
const CHEVRON_DOWN =
  '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>';
const MORE =
  '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const UNDO =
  '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>';

const BUBBLE = "M4 5.5h16v10H10l-4.5 3.5V15.5H4z";
/** Darker than --line, so a small settled share still reads as a pie. */
const PIE_TRACK = "#C9DCCF";

/**
 * The row's state icon. The four differ by shape as well as color: an outline bubble (no
 * comments yet), a filled amber bubble (comments waiting), a green pie (some settled), a green
 * check disc (all done). The count line beside it says the same in words, so it is hidden from
 * screen readers.
 */
export function stateIcon(state: RowState, fraction = 0, size = 22): string {
  const open = `<svg class="si" data-state="${state}" aria-hidden="true" width="${size}" height="${size}"`;
  if (state === "none") {
    return `${open} viewBox="0 0 24 24" fill="none" stroke="var(--mut)" stroke-width="1.8" stroke-linejoin="round"><path d="${BUBBLE}"/></svg>`;
  }
  if (state === "waiting") {
    return (
      `${open} viewBox="0 0 24 24" fill="var(--warn)" stroke="var(--warn)" stroke-width="1.8" stroke-linejoin="round">` +
      `<path d="${BUBBLE}"/><path d="M8 10.5h8" stroke="#fff" stroke-linecap="round"/></svg>`
    );
  }
  const c = size / 2;
  if (state === "done") {
    const n = (v: number) => (size * v).toFixed(1);
    return (
      `${open} viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${c}" fill="var(--acc)"/>` +
      `<path d="M${n(0.28)} ${n(0.52)}l${n(0.15)} ${n(0.15)} ${n(0.3)}-${n(0.32)}" fill="none" stroke="#fff" ` +
      `stroke-width="${Math.max(2, size / 10).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    );
  }
  // A pie never looks empty or full while some, but not all, are settled.
  const f = Math.min(0.92, Math.max(0.08, Number.isFinite(fraction) ? fraction : 0));
  const a = 2 * Math.PI * f;
  const x = (c + c * Math.sin(a)).toFixed(2);
  const y = (c - c * Math.cos(a)).toFixed(2);
  return (
    `${open} viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${c}" fill="${PIE_TRACK}"/>` +
    `<path d="M${c} ${c}L${c} 0A${c} ${c} 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}Z" fill="var(--acc)"/></svg>`
  );
}

type RowOpts = { showSite: boolean; waiting: number };

function rowHtml(a: MeAssignment, { showSite, waiting }: RowOpts): string {
  const finished = !!a.finished;
  const parts = a.counts.total === 0 && waiting ? [] : countLine(a).split(" · ").map((p) => `<span class="part">${escapeHtml(p)}</span>`);
  if (waiting) parts.push(`<span class="part pend" data-waiting>${waiting} waiting to send</span>`);
  const state = stateFor(a);
  const badge = state === "done" && !finished ? `<span class="bdg">${check(15)}All done</span>` : "";
  const where = (showSite ? `${escapeHtml(a.site.name)} · ` : "") + escapeHtml(a.path);
  const control = finished
    ? `<button type="button" class="fin" data-rereview="${escapeHtml(a.id)}">${UNDO}<span>Re-review</span></button>`
    : `<button type="button" class="dots" data-actions="${escapeHtml(a.id)}" aria-label="Actions for ${escapeHtml(a.title)}" aria-haspopup="dialog">${MORE}</button>`;
  return (
    `<div class="rowd${finished ? " fin-row" : ""}">` +
    `<a class="row" href="${escapeHtml(a.url)}" data-assignment="${escapeHtml(a.id)}">` +
    `<span class="l1"><span class="title">${escapeHtml(a.title)}</span>${badge}</span>` +
    `<span class="l2">${stateIcon(state, a.progress)}` +
    // Each part stays whole, so a narrow screen breaks the line between parts, not inside one.
    `<span class="counts">${parts.join(" · ")}</span>` +
    `<span class="where">· <span class="path">${where}</span></span></span>` +
    `</a>${control}</div>`
  );
}

function sectionHtml(key: Exclude<Section, "finished">, rows: MeAssignment[], opts: (a: MeAssignment) => RowOpts): string {
  if (rows.length === 0) return "";
  return (
    `<section class="sec k-${key}" data-section="${key}"><h2 class="sh"><span class="mark"></span>${SECTION_TITLES[key]} ` +
    `<span class="n">${rows.length}</span></h2><div class="list">${rows.map((a) => rowHtml(a, opts(a))).join("")}</div></section>`
  );
}

/** "Since you last looked": one tappable line per page with how many comments were fixed. */
export function noticeHtml(pages: FixedPage[], assignments: MeAssignment[]): string {
  const byId = new Map(assignments.map((a) => [a.id, a]));
  const lines = pages.flatMap((p) => {
    const a = byId.get(p.id);
    if (!a || p.fixed <= 0) return [];
    const finished = !!a.finished;
    return [
      `<a class="li" href="${escapeHtml(a.url)}" data-open="${escapeHtml(a.id)}">` +
        `<span class="t">${escapeHtml(a.title)}</span>` +
        (finished ? `<span class="ftag">Finished</span>` : `<span></span>`) +
        `<span class="n">${p.fixed} fixed</span><span class="chev">${CHEVRON}</span></a>`,
    ];
  });
  if (lines.length === 0) return "";
  return (
    `<div class="nt" role="status" data-notice><div class="top"><h2 class="h"><span class="ic">${check(22)}</span>Since you last looked</h2>` +
    `<button type="button" class="ok" data-ack>Got it</button></div>${lines.join("")}</div>`
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

export type RenderOpts = { finishedOpen?: boolean };

/** `waiting`: unsent comments the overlay reported (offline mode), shown as a line and per row. */
export function renderReviewer(data: MeResponse, waiting: WaitingBySite = {}, opts: RenderOpts = {}): string {
  const first = firstName(data.name);
  const total = data.assignments.reduce((n, a) => n + waitingFor(waiting, a), 0);
  const head =
    `<h1 class="hello" tabindex="-1">${first ? `Hi ${escapeHtml(first)}.` : "Hi."}</h1>` +
    `<p class="lede">Tap a page to open it. Then tap Comment, and tap anything that should change.</p>` +
    // The dashboard can't send them (they live with each site on the phone): it says how they go.
    (total
      ? `<div class="wait" data-waiting-line>${PHONE}<div><b>${plural(total, "comment", "comments")} waiting to send</b>` +
        `<span>Saved on this phone. Open each page while you're online and they send.</span></div></div>`
      : "") +
    noticeHtml(data.fixed?.pages ?? [], data.assignments);
  if (data.assignments.length === 0) return head + `<p class="empty">${MSG_EMPTY}</p>`;

  // With one site every row would repeat its name; with two or more, each row says which.
  const showSite = new Set(data.assignments.map((a) => a.site.slug)).size > 1;
  const rowOpts = (a: MeAssignment): RowOpts => ({ showSite, waiting: waitingFor(waiting, a) });
  const by: Record<Section, MeAssignment[]> = { new: [], updated: [], seen: [], finished: [] };
  for (const a of data.assignments) by[sectionFor(a)].push(a);

  const active = by.new.length + by.updated.length + by.seen.length;
  const finished = by.finished.length
    ? `<details class="findet" data-section="finished"${opts.finishedOpen ? " open" : ""}>` +
      `<summary class="finbar"><span class="sh">Finished <span class="n">${by.finished.length}</span></span>` +
      `<span class="chev">${CHEVRON_DOWN}</span></summary>` +
      `<div class="list muted">${by.finished.map((a) => rowHtml(a, rowOpts(a))).join("")}</div></details>`
    : "";
  return (
    head +
    (active ? "" : `<p class="empty">${MSG_ALL_FINISHED}</p>`) +
    `<div class="secs">` +
    sectionHtml("new", by.new, rowOpts) +
    sectionHtml("updated", by.updated, rowOpts) +
    sectionHtml("seen", by.seen, rowOpts) +
    finished +
    `</div>`
  );
}

/** The ⋯ menu, as a bottom sheet. */
export function sheetHtml(a: MeAssignment): string {
  return (
    `<div class="scrim" data-sheet-close></div>` +
    `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ttf-sheet-title" data-sheet="${escapeHtml(a.id)}">` +
    `<p class="sht" id="ttf-sheet-title">${escapeHtml(a.title)}</p>` +
    `<button type="button" class="sbtn solid" data-finish="${escapeHtml(a.id)}">${check(20)}<span>Review complete</span></button>` +
    `<a class="sbtn" href="${escapeHtml(a.url)}" data-open="${escapeHtml(a.id)}">Open the page</a>` +
    `<button type="button" class="sbtn plain" data-sheet-close>Cancel</button>` +
    `<p class="serr" data-sheet-error hidden></p>` +
    `</div>`
  );
}

const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", system-ui, sans-serif`;

export const REVIEWER_CSS = `
main { padding: 16px 10px 64px; }
.hello { font: 600 30px/1.15 var(--hf); margin: 0 0 8px; letter-spacing: -0.01em; }
.hello:focus { outline: none; }
.lede { font-size: 17px; line-height: 1.45; color: var(--mut); margin: 0 0 6px; max-width: 34em; }
.empty, .notice { font: 400 21px/1.45 var(--hf); margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--line); }
.notice:first-child { border-top: 0; padding-top: 0; margin-top: 24px; }
.muted { color: var(--mut); }
.list { border-top: 1px solid var(--line); }
.sec { margin-top: 22px; }
.secs > .sec:first-child { margin-top: 10px; }
.sh { display: flex; align-items: center; gap: 8px; font: 700 17px/1.25 ${SANS}; margin: 0; padding: 0 0 6px; }
.sh .n { font: 600 16px/1 ${SANS}; }
.sh .mark { width: 4px; height: 18px; border-radius: 2px; flex: none; }
.k-new .sh { color: var(--acc); } .k-new .mark { background: var(--acc); }
.k-updated .sh { color: var(--warn); } .k-updated .mark { background: var(--warn); }
.k-seen .sh { color: var(--ink); } .k-seen .mark { background: var(--ink); }
.rowd { display: grid; grid-template-columns: minmax(0, 1fr) 44px; column-gap: 2px; align-items: center; border-bottom: 1px solid var(--line); }
.rowd.fin-row { grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; }
.row {
  display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0;
  box-sizing: border-box; min-height: 68px; padding: 11px 0; text-decoration: none; color: var(--ink);
  -webkit-tap-highlight-color: transparent;
}
.row:hover { background: var(--surf); }
.row:active { background: var(--soft); }
.row:focus-visible, .dots:focus-visible, .fin:focus-visible, .ok:focus-visible, .li:focus-visible, .finbar:focus-visible, .sbtn:focus-visible {
  outline: 3px solid var(--acc); outline-offset: -3px; border-radius: 6px;
}
.l1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.title { font: 600 18px/1.25 var(--hf); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.l1 .bdg { margin-left: auto; }
.bdg { flex: none; display: inline-flex; align-items: center; gap: 3px; font: 600 16px/1 ${SANS}; color: var(--acc); background: var(--soft); padding: 4px 9px 4px 7px; border-radius: 999px; white-space: nowrap; }
.l2 { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 16px; line-height: 1.3; }
.si { display: block; flex: none; }
.counts { flex: 0 1 auto; min-width: 0; }
.part { white-space: nowrap; }
.where { flex: 1 1 0; min-width: 0; color: var(--mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pend { font-weight: 600; color: var(--ink); }
.dots { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--ink); cursor: pointer; }
.dots:hover { background: var(--surf); }
.fin {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; min-width: 44px; padding: 0 14px;
  border: 1.5px solid var(--acc); border-radius: 999px; background: var(--surf); color: var(--acc);
  font: 600 17px/1 ${SANS}; cursor: pointer; white-space: nowrap;
}
.fin[disabled] { opacity: .6; cursor: default; }
.findet { margin-top: 22px; }
.finbar {
  display: flex; align-items: center; justify-content: space-between; min-height: 56px;
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); cursor: pointer; list-style: none;
}
.finbar::-webkit-details-marker { display: none; }
.finbar .sh { padding: 0; color: var(--mut); }
.finbar .chev { color: var(--mut); line-height: 0; }
.findet[open] .finbar .chev svg { transform: rotate(180deg); }
.findet .list { border-top: 0; }
.list.muted .title { color: var(--mut); }
.wait { display: flex; gap: 12px; align-items: flex-start; margin: 12px 0 10px; max-width: 34em; }
.wait svg { flex: none; margin-top: 2px; color: var(--ink); }
.wait b { display: block; font-weight: 600; font-size: 18px; line-height: 1.35; }
.wait span { display: block; font-size: 17px; line-height: 1.45; color: var(--mut); }
.nt { background: var(--soft); border: 1px solid #CFE0D4; border-radius: 12px; margin: 12px 0 6px; padding: 8px 12px 4px; color: var(--ink); }
.nt .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 4px; }
.nt .h { display: flex; align-items: center; gap: 6px; font: 700 17px/1.3 ${SANS}; margin: 0; }
.nt .ic { color: var(--acc); display: inline-flex; flex: none; }
.ok {
  flex: none; min-height: 44px; min-width: 44px; padding: 0 14px; border-radius: 999px; border: 1.5px solid var(--acc);
  background: var(--surf); color: var(--acc); font: 600 16px/1 ${SANS}; cursor: pointer;
}
.li {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto 18px; gap: 8px; align-items: center; min-height: 44px;
  border-top: 1px solid #CFE0D4; font-size: 16px; color: var(--ink); text-decoration: none; -webkit-tap-highlight-color: transparent;
}
.li .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.li .n { color: var(--acc); font-weight: 600; white-space: nowrap; }
.li .ftag { font-weight: 600; color: var(--mut); white-space: nowrap; }
.li .chev { color: var(--mut); line-height: 0; }
.scrim { position: fixed; inset: 0; background: rgba(31, 42, 36, .42); z-index: 20; }
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; margin: 0 auto; max-width: 520px;
  background: var(--surf); border-radius: 18px 18px 0 0; padding: 18px 16px calc(22px + env(safe-area-inset-bottom, 0px));
  display: flex; flex-direction: column; gap: 10px; box-sizing: border-box;
}
.sht { font: 600 20px/1.25 var(--hf); margin: 0 0 4px; text-align: center; overflow-wrap: anywhere; }
.sbtn {
  display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 52px; border-radius: 14px;
  border: 1.5px solid var(--line); background: var(--bg); color: var(--ink); font: 600 18px/1 ${SANS}; cursor: pointer; text-decoration: none;
}
.sbtn.solid { background: var(--acc); border-color: var(--acc); color: var(--acc-ink); }
.sbtn.plain { border-color: transparent; background: transparent; color: var(--acc); }
.sbtn[disabled] { opacity: .6; cursor: default; }
.serr, .rerr { margin: 0; color: var(--warn); background: var(--warn-bg); border-radius: 8px; padding: 8px 12px; font-size: 17px; }
.rerr { margin: 6px 0 10px; }
.retry {
  display: inline-flex; align-items: center; justify-content: center; min-height: 48px; margin-top: 18px;
  padding: 0 26px; border: 0; border-radius: 999px; background: var(--acc); color: var(--acc-ink);
  font: 600 18px/1 ${SANS}; cursor: pointer;
}
.retry:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
@media (min-width: 640px) {
  main { padding: 56px 16px 64px; }
  .hello { font-size: 36px; }
  .lede { font-size: 18px; margin-bottom: 14px; }
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
  let waiting = readWaiting(win);
  // The report has been kept; a saved link (or a reload) should not carry it again.
  if (stripWaiting(win.location.hash) !== win.location.hash) {
    try {
      win.history.replaceState(null, "", win.location.pathname + win.location.search + stripWaiting(win.location.hash));
    } catch {
      /* not fatal */
    }
  }
  // Keep a working link in the address bar so "Add to Home Screen" saves one.
  if (!/(?:^#|&)ttf=/.test(win.location.hash)) {
    try {
      win.history.replaceState(null, "", win.location.pathname + win.location.search + "#ttf=" + encodeURIComponent(token));
    } catch {
      /* not fatal */
    }
  }

  let data: MeResponse | null = null;
  let finishedOpen = false;
  let sheetFrom: HTMLElement | null = null;
  const render = () => {
    if (data) main.innerHTML = renderReviewer(data, waiting, { finishedOpen });
  };
  const find = (id: string) => data?.assignments.find((a) => a.id === id);

  /** Marks the page opened (so it leaves New), then goes to it. */
  const openPage = (id: string, href: string) => {
    const opened = api(token, `/api/me/assignments/${encodeURIComponent(id)}/opened`, { method: "POST", keepalive: true });
    void Promise.race([opened, sleep(OPENED_WAIT_MS)]).then(() => {
      win.location.href = href;
    });
  };

  const closeSheet = () => {
    host.querySelectorAll(".scrim, .sheet").forEach((el) => el.remove());
    const back = sheetFrom?.getAttribute("data-actions");
    sheetFrom = null;
    // The list may have been drawn again; give focus to the same row's ⋯ if it is still there.
    const btn = [...main.querySelectorAll<HTMLElement>("[data-actions]")].find((b) => b.getAttribute("data-actions") === back);
    btn?.focus();
  };
  const openSheet = (from: HTMLElement, a: MeAssignment) => {
    closeSheet();
    sheetFrom = from;
    host.insertAdjacentHTML("beforeend", sheetHtml(a));
    (host.querySelector(".sheet [data-finish]") as HTMLElement | null)?.focus();
  };

  const setFinished = async (id: string, finished: boolean): Promise<boolean> => {
    const res = await api(token, `/api/me/assignments/${encodeURIComponent(id)}/finished`, { method: finished ? "POST" : "DELETE" });
    if (!res.ok) return false;
    const a = find(id);
    if (a) a.finished = finished;
    for (const p of data?.fixed?.pages ?? []) if (p.id === id) p.finished = finished;
    return true;
  };

  const onClick = (ev: MouseEvent) => {
    const target = ev.target as Element | null;
    if (!target?.closest) return;
    const link = target.closest("a[data-assignment], a[data-open]") as HTMLAnchorElement | null;
    if (link) {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      openPage(link.getAttribute("data-assignment") ?? link.getAttribute("data-open") ?? "", link.getAttribute("href") ?? "");
      return;
    }
    const dots = target.closest("[data-actions]") as HTMLElement | null;
    if (dots) {
      const a = find(dots.getAttribute("data-actions") ?? "");
      if (a) openSheet(dots, a);
      return;
    }
    if (target.closest("[data-sheet-close]")) {
      closeSheet();
      return;
    }
    const finish = target.closest("[data-finish]") as HTMLButtonElement | null;
    if (finish) {
      finish.disabled = true;
      void setFinished(finish.getAttribute("data-finish") ?? "", true).then((ok) => {
        if (ok) {
          render();
          closeSheet();
          return;
        }
        finish.disabled = false;
        const err = host.querySelector("[data-sheet-error]") as HTMLElement | null;
        if (err) {
          err.textContent = MSG_SAVE_FAILED;
          err.hidden = false;
        }
      });
      return;
    }
    const again = target.closest("[data-rereview]") as HTMLButtonElement | null;
    if (again) {
      again.disabled = true;
      const id = again.getAttribute("data-rereview") ?? "";
      void setFinished(id, false).then((ok) => {
        if (ok) return render();
        again.disabled = false;
        const row = again.closest(".rowd");
        if (row && !row.nextElementSibling?.matches(".rerr")) row.insertAdjacentHTML("afterend", `<p class="rerr" role="alert">${MSG_SAVE_FAILED}</p>`);
      });
      return;
    }
    if (target.closest("[data-ack]") && data) {
      // Hide it now; if the call is lost the notice simply comes back on the next visit.
      const through = data.fixed?.through ?? null;
      data.fixed = { through: null, pages: [] };
      render();
      (main.querySelector(".hello") as HTMLElement | null)?.focus();
      void api(token, "/api/me/acknowledge", { method: "POST", keepalive: true, json: through ? { through } : {} });
    }
  };
  host.addEventListener("click", onClick);
  host.addEventListener(
    "toggle",
    (ev) => {
      const d = ev.target as HTMLDetailsElement | null;
      if (d?.matches?.("details[data-section=finished]")) finishedOpen = d.open;
    },
    true,
  );
  doc.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && host.querySelector(".sheet")) closeSheet();
  });

  const load = async (): Promise<void> => {
    main.innerHTML = '<p class="notice muted">Loading…</p>';
    const res = await api<MeResponse>(token, "/api/me");
    if (res.ok) {
      data = res.data;
      render();
      const checked = await checkSent(token, waiting, data.assignments);
      if (checked !== waiting) {
        waiting = checked;
        saveWaiting(win, waiting);
        render();
      }
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
