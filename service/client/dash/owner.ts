// Owner dashboard (/o/#owner=TOKEN): reviewers and their private links, sites, page
// assignments with status and PR links, and the command that starts a review cycle.
// Pure view functions (state in, HTML out) plus a thin mount layer that talks to the API.
import { api, escapeHtml, type ApiResult } from "./common";
import { DASH_CSS } from "./dash.css";

export type Site = { slug: string; name: string; origin: string; repo: string; created_at?: string };
export type OwnerReviewer = { id: string; name: string; revoked: boolean; unsettled_count: number; ready_count: number };
export type AssignmentStatus = "not_started" | "open" | "in_progress" | "done";
export type OwnerAssignment = {
  id: string;
  site: string;
  path: string;
  title: string;
  reviewer: { id: string; name: string };
  status: AssignmentStatus;
  counts: { open: number; in_progress: number; settled: number };
  pr_urls: string[];
};
export type Overview = { reviewers: OwnerReviewer[]; assignments: OwnerAssignment[] };
export type Flash = { kind: "link"; name: string; url: string };
export type OwnerState = {
  sites: Site[];
  overview: Overview;
  selectedReviewerId: string | null;
  flash: Flash | null;
};
export type ReadyBatch = { reviewerName: string; siteSlug: string; siteName: string; open: number; command: string };

export const STORAGE_KEY = "ttf:owner-token";

const MSG_OFFLINE = "Can't reach the review service right now.";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const esc = escapeHtml;

/** The Claude Code command that starts a review cycle for one reviewer on one site. */
export function fixCommand(reviewerName: string, siteSlug: string): string {
  return `/tap-to-fix:fix ${firstName(reviewerName).toLowerCase()} ${siteSlug}`;
}

export function reviewerLink(origin: string, token: string): string {
  return `${origin}/r/#ttf=${token}`;
}

/** Only http(s) URLs become links; anything else (javascript:, data:) is shown as text. */
export function isWebUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

export function prLabel(url: string): string {
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? `PR #${m[1]}` : "PR";
}

/** One entry per reviewer and site with open comments, most open first. */
export function readyBatches(overview: Overview, sites: Site[] = []): ReadyBatch[] {
  const siteName = new Map(sites.map((s) => [s.slug, s.name]));
  const byKey = new Map<string, ReadyBatch>();
  for (const a of overview.assignments) {
    if (a.counts.open <= 0) continue;
    const key = a.reviewer.id + "\u0000" + a.site;
    const b = byKey.get(key) ?? {
      reviewerName: a.reviewer.name,
      siteSlug: a.site,
      siteName: siteName.get(a.site) ?? a.site,
      open: 0,
      command: fixCommand(a.reviewer.name, a.site),
    };
    b.open += a.counts.open;
    byKey.set(key, b);
  }
  return [...byKey.values()].sort(
    (x, y) => y.open - x.open || x.reviewerName.localeCompare(y.reviewerName) || x.siteName.localeCompare(y.siteName),
  );
}

// confirm() copy is the contract: name the reviewer every time, no pronouns.
export const reissueConfirm = (name: string) => {
  const n = firstName(name);
  return `Make a new link for ${n}? ${n}'s old link stops working.`;
};
export const revokeConfirm = (name: string) => {
  const n = firstName(name);
  return `Turn off ${n}'s link? ${n} won't be able to review until you make a new one.`;
};
export function removeConfirm(a: OwnerAssignment): string {
  const total = a.counts.open + a.counts.in_progress + a.counts.settled;
  const head = `Remove “${a.title}” from ${firstName(a.reviewer.name)}'s list?`;
  if (total === 0) return head;
  return `${head} ${total === 1 ? "Its 1 comment is" : `Its ${total} comments are`} deleted too.`;
}

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  not_started: "Not started",
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

// Monochrome line icons.
const svg = (d: string, size = 20) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const PLUS = svg('<path d="M12 5v14M5 12h14"/>');
const CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>');
const COPY = svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 18);
const OUT = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 17);
const PR = svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4M13 3.5L10.5 6 13 8.5"/>', 17);

const copyButton = (text: string) =>
  `<button type="button" class="btn quiet copy" data-copy="${esc(text)}">${COPY}<span>Copy</span></button>`;
const errLine = () => `<p class="err" data-error role="alert" hidden></p>`;
const field = (label: string, name: string, attrs = "") =>
  `<label class="fld"><span>${esc(label)}</span><input name="${name}" autocomplete="off" required ${attrs}></label>`;

function adder(form: string, label: string, body: string, open: boolean): string {
  return (
    `<details class="adder" data-adder="${form}"${open ? " open" : ""}>` +
    `<summary>${PLUS}<span>${esc(label)}</span></summary>` +
    `<form data-form="${form}" novalidate>${body}${errLine()}</form>` +
    `</details>`
  );
}

function readyHtml(batches: ReadyBatch[]): string {
  if (batches.length === 0) return "";
  return (
    `<section class="ready-wrap" aria-label="Ready for a review cycle">` +
    batches
      .map(
        (b) =>
          `<div class="ready" data-ready>` +
          `<p class="ready-h">${esc(firstName(b.reviewerName))} has ${plural(b.open, "comment", "comments")} ready for a review cycle on ${esc(b.siteName)}</p>` +
          `<div class="cmd"><code>${b.command
            .split(" ")
            .map((t) => `<span class="tok">${esc(t)}</span>`)
            .join(" ")}</code>${copyButton(b.command)}</div>` +
          `</div>`,
      )
      .join("") +
    `</section>`
  );
}

function flashHtml(f: Flash | null): string {
  if (!f) return "";
  const n = esc(firstName(f.name));
  return (
    `<div class="flash" data-flash role="status">` +
    `<p class="flash-h">Text this link to ${n}</p>` +
    `<p class="flash-s">The link is shown only now. Copy it before you leave this page.</p>` +
    `<code class="flash-url" data-flash-url>${esc(f.url)}</code>` +
    `<div class="flash-row">${copyButton(f.url)}<button type="button" class="btn quiet" data-action="dismiss">Done</button></div>` +
    `</div>`
  );
}

function reviewersHtml(s: OwnerState): string {
  const { reviewers } = s.overview;
  const items = reviewers
    .map((r) => {
      const sel = r.id === s.selectedReviewerId;
      const meta = [`${r.ready_count} open`, r.revoked ? `<span class="off">Link off</span>` : ""].filter(Boolean).join(" · ");
      const controls = sel
        ? `<div class="rv-actions">` +
          `<button type="button" class="btn quiet" data-action="reissue" data-id="${esc(r.id)}">New link</button>` +
          (r.revoked ? "" : `<button type="button" class="btn quiet" data-action="revoke" data-id="${esc(r.id)}">Turn off link</button>`) +
          `</div>`
        : "";
      return (
        `<li class="rv-item${sel ? " sel" : ""}">` +
        `<button type="button" class="rv" data-action="select" data-id="${esc(r.id)}" aria-pressed="${sel}">` +
        `<span class="av" aria-hidden="true">${esc(firstName(r.name).slice(0, 1).toUpperCase()) || "?"}</span>` +
        `<span class="rv-n">${esc(r.name)}</span>` +
        `<span class="rv-c">${meta}</span>` +
        `</button>` +
        controls +
        `</li>`
      );
    })
    .join("");
  const form = field("Name", "name", 'placeholder="Alexis"') + `<button type="submit" class="btn">Add</button>`;
  return (
    `<section class="side" aria-labelledby="h-reviewers">` +
    `<h2 class="lbl" id="h-reviewers">Reviewers</h2>` +
    (items ? `<ul class="rv-list">${items}</ul>` : "") +
    flashHtml(s.flash) +
    adder("reviewer", reviewers.length ? "Add a reviewer" : "Add your first reviewer", form, reviewers.length === 0) +
    `</section>`
  );
}

function assignHtml(s: OwnerState): string {
  if (s.sites.length === 0) return `<p class="empty">Add a site first. The form is under Sites, below.</p>`;
  if (s.overview.reviewers.length === 0) return `<p class="empty">Add a reviewer first, then assign pages here.</p>`;
  const siteOpts = s.sites.map((x) => `<option value="${esc(x.slug)}">${esc(x.name)}</option>`).join("");
  const revOpts = s.overview.reviewers
    .map(
      (r) =>
        `<option value="${esc(r.id)}"${r.id === s.selectedReviewerId ? " selected" : ""}>${esc(r.name)}${r.revoked ? " (link off)" : ""}</option>`,
    )
    .join("");
  const body =
    `<div class="grid">` +
    `<label class="fld"><span>Site</span><select name="site">${siteOpts}</select></label>` +
    `<label class="fld"><span>Reviewer</span><select name="reviewer_id">${revOpts}</select></label>` +
    field("Path", "path", 'placeholder="/digital-detox" autocapitalize="off" spellcheck="false"') +
    field("Title", "title", 'placeholder="Digital Detox"') +
    `</div><button type="submit" class="btn">Assign</button>`;
  return adder("assign", "Assign a page", body, false);
}

function rowHtml(a: OwnerAssignment, site: Site | undefined): string {
  const links =
    (site
      ? `<a class="lnk" href="${esc(site.origin + a.path)}" target="_blank" rel="noopener noreferrer">${OUT}<span>Page</span></a>`
      : "") +
    a.pr_urls
      .map((u) =>
        isWebUrl(u)
          ? `<a class="lnk" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${PR}<span>${esc(prLabel(u))}</span></a>`
          : `<span class="lnk plain">${PR}<span>${esc(prLabel(u))}</span></span>`,
      )
      .join("");
  const label = `Remove ${a.title} from ${firstName(a.reviewer.name)}'s list`;
  return (
    `<tr data-row="${esc(a.id)}">` +
    `<td class="c-page"><span class="tt">${esc(a.title)}</span><span class="tu">${esc(site ? site.name + " " : "")}<span class="path">${esc(a.path)}</span></span></td>` +
    `<td class="c-rev">${esc(a.reviewer.name)}</td>` +
    `<td class="c-st"><span class="st ${a.status}">${STATUS_LABEL[a.status]}</span></td>` +
    `<td class="c-links">${links}</td>` +
    `<td class="c-rm"><button type="button" class="rm" data-action="remove" data-id="${esc(a.id)}" aria-label="${esc(label)}" title="Remove">${CLOSE}</button></td>` +
    `</tr>`
  );
}

function pagesHtml(s: OwnerState): string {
  const sel = s.overview.reviewers.find((r) => r.id === s.selectedReviewerId) ?? null;
  const rows = s.overview.assignments.filter((a) => !sel || a.reviewer.id === sel.id);
  const sites = new Map(s.sites.map((x) => [x.slug, x]));
  const heading = sel ? `${esc(firstName(sel.name))}'s pages` : "Pages";
  const empty = sel ? `No pages for ${esc(firstName(sel.name))} yet.` : "No pages assigned yet.";
  const table = rows.length
    ? `<table class="pages"><thead><tr><th>Page</th><th>Reviewer</th><th>Status</th><th>Links</th><th><span class="sr">Remove</span></th></tr></thead>` +
      `<tbody>${rows.map((a) => rowHtml(a, sites.get(a.site))).join("")}</tbody></table>`
    : `<p class="empty">${empty}</p>`;
  return (
    `<section class="pages-sec" aria-labelledby="h-pages">` +
    `<div class="topline"><h2 class="h" id="h-pages">${heading}</h2>` +
    (sel ? `<button type="button" class="btn quiet" data-action="select" data-id="">Show everyone</button>` : "") +
    `</div>` +
    assignHtml(s) +
    table +
    `</section>`
  );
}

function sitesHtml(s: OwnerState): string {
  const list = s.sites
    .map(
      (x) =>
        `<li class="site-row"><span class="tt">${esc(x.name)}</span>` +
        `<span class="tu"><span class="part">${esc(x.origin)}</span> · <span class="part">${esc(x.repo)}</span> · <span class="part">slug <code>${esc(x.slug)}</code></span></span></li>`,
    )
    .join("");
  const body =
    `<div class="grid">` +
    field("Slug", "slug", 'placeholder="bonus-decade" autocapitalize="off" spellcheck="false"') +
    field("Name", "name", 'placeholder="Bonus Decade"') +
    field("Origin", "origin", 'placeholder="https://bonusdecade.com" inputmode="url" autocapitalize="off" spellcheck="false"') +
    field("Repo", "repo", 'placeholder="workingBen/longevity-tracker" autocapitalize="off" spellcheck="false"') +
    `</div><button type="submit" class="btn">Add site</button>`;
  return (
    `<section class="sites-sec" aria-labelledby="h-sites">` +
    `<h2 class="h" id="h-sites">Sites</h2>` +
    (list ? `<ul class="site-list">${list}</ul>` : "") +
    adder("site", "Add a site", body, s.sites.length === 0) +
    `</section>`
  );
}

export function renderOwner(state: OwnerState): string {
  return (
    `<h1 class="sr">tap-to-fix owner dashboard</h1>` +
    `<div class="owner">` +
    `<div class="a-ready">${readyHtml(readyBatches(state.overview, state.sites))}</div>` +
    `<div class="a-side">${reviewersHtml(state)}</div>` +
    `<div class="a-pages">${pagesHtml(state)}</div>` +
    `<div class="a-sites">${sitesHtml(state)}</div>` +
    `</div>`
  );
}

export function renderTokenForm(): string {
  return (
    `<form class="token" data-form="token">` +
    `<h1 class="h">Paste your owner token</h1>` +
    `<label class="fld"><span>Owner token</span><input type="password" name="token" autocomplete="current-password" required></label>` +
    `<button type="submit" class="btn">Open</button>` +
    `</form>`
  );
}

export const OWNER_CSS = `
main { max-width: 1240px; padding-top: 28px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.owner { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: "ready" "side" "pages" "sites"; row-gap: 36px; }
.a-ready { grid-area: ready; } .a-side { grid-area: side; } .a-pages { grid-area: pages; } .a-sites { grid-area: sites; }
.a-ready:empty { display: none; }
.h { font: 600 26px/1.2 var(--hf); margin: 0; letter-spacing: -0.01em; }
.lbl { font-size: 17px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--mut); margin: 0 0 8px; }
.empty { font: 400 19px/1.45 var(--hf); color: var(--mut); margin: 16px 0 0; }
.tt { font: 600 19px/1.3 var(--hf); overflow-wrap: anywhere; }
.tu { font-size: 17px; line-height: 1.4; color: var(--mut); overflow-wrap: anywhere; }
.path, code { font-family: ui-monospace, Menlo, monospace; font-size: 17px; }
.part { white-space: nowrap; }
button { font: inherit; color: inherit; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 20px;
  border: 0; border-radius: 999px; background: var(--acc); color: var(--acc-ink); font-size: 17px; font-weight: 600; cursor: pointer;
}
.btn.quiet { background: transparent; color: var(--acc); padding: 0 12px; }
.btn.quiet:hover { background: var(--soft); }
.btn:focus-visible, .rv:focus-visible, .rm:focus-visible, .lnk:focus-visible, summary:focus-visible { outline: 3px solid var(--acc); outline-offset: 2px; }

/* the one highlighted box */
.ready-wrap { display: flex; flex-direction: column; gap: 12px; }
.ready { background: var(--soft); border-radius: var(--r); padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
.ready-h { margin: 0; font: 600 20px/1.35 var(--hf); }
.cmd { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cmd code, .flash-url {
  font-size: 17px; font-weight: 600; background: var(--surf); border: 1px solid var(--line); border-radius: 8px;
  padding: 10px 12px; overflow-wrap: break-word; min-width: 0; user-select: all;
}
.cmd code { flex: 1 1 auto; overflow-wrap: normal; overflow-x: auto; }
.cmd .tok { white-space: nowrap; hyphens: none; }

/* reviewers */
.rv-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.rv-item { border-bottom: 1px solid var(--line); }
.rv {
  display: grid; grid-template-columns: 34px minmax(0, 1fr); grid-template-areas: "av n" "av c"; column-gap: 12px; align-items: center;
  width: 100%; min-height: 64px; padding: 10px 8px; border: 0; background: none; text-align: left; cursor: pointer; border-radius: 10px;
}
.rv:hover { background: var(--surf); }
.rv-item.sel .rv { background: var(--soft); }
.av { grid-area: av; width: 34px; height: 34px; border-radius: 50%; background: var(--ink); color: var(--bg); display: grid; place-items: center; font-weight: 700; font-size: 17px; }
.rv-item.sel .av { background: var(--acc); color: var(--acc-ink); }
.rv-n { grid-area: n; font-weight: 600; font-size: 18px; overflow-wrap: anywhere; }
.rv-c { grid-area: c; font-size: 17px; color: var(--mut); }
.off { color: var(--warn); font-weight: 600; }
.rv-actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 0 10px 46px; }
.rv-actions .err, .c-page .err { flex-basis: 100%; margin-top: 4px; }
.flash { margin-top: 16px; padding: 16px 0 4px; border-top: 2px solid var(--acc); }
.flash-h { margin: 0; font: 600 20px/1.3 var(--hf); }
.flash-s { margin: 4px 0 10px; font-size: 17px; color: var(--mut); }
.flash-url { display: block; }
.flash-row { display: flex; gap: 4px; margin-top: 8px; margin-left: -12px; }

/* inline forms */
.adder { margin-top: 12px; }
.adder > summary {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; color: var(--acc); font-weight: 600; font-size: 17px;
  cursor: pointer; list-style: none; border-radius: 8px;
}
.adder > summary::-webkit-details-marker { display: none; }
.adder[open] > summary { margin-bottom: 6px; }
.adder form { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; padding: 4px 0 8px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; width: 100%; }
.fld { display: flex; flex-direction: column; gap: 5px; width: 100%; min-width: 0; }
.fld > span { font-size: 17px; font-weight: 600; color: var(--mut); }
.fld input, .fld select {
  font-size: 17px; line-height: 1.3; font-family: inherit; color: var(--ink); background: var(--surf); border: 1.5px solid var(--line); border-radius: 10px;
  min-height: 48px; padding: 0 12px; width: 100%; box-sizing: border-box; min-width: 0;
}
.fld input:focus, .fld select:focus { outline: none; border-color: var(--acc); }
.err { margin: 0; color: var(--warn); background: var(--warn-bg); border-radius: 8px; padding: 8px 12px; font-size: 17px; }
.err[hidden] { display: none; }

/* pages */
.topline { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pages { width: 100%; border-collapse: collapse; margin-top: 12px; }
.pages thead { display: none; }
.pages tbody { display: block; border-top: 1px solid var(--line); }
.pages tr {
  display: grid; grid-template-columns: auto minmax(0, 1fr) 44px; grid-template-areas: "page page rm" "rev st st" "links links links";
  column-gap: 10px; row-gap: 6px; padding: 14px 0 8px; border-bottom: 1px solid var(--line); align-items: center;
}
.pages td { padding: 0; }
.c-page { grid-area: page; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.c-rev { grid-area: rev; font-size: 17px; white-space: nowrap; }
.c-page .path { display: block; }
.c-rev::after { content: " ·"; color: var(--mut); }
.c-st { grid-area: st; }
.c-links { grid-area: links; display: flex; flex-wrap: wrap; column-gap: 18px; margin-left: -2px; }
.c-links:empty { display: none; }
.c-rm { grid-area: rm; align-self: start; justify-self: end; }
.st { display: inline-block; font-size: 17px; font-weight: 600; padding: 4px 12px; border-radius: 999px; background: var(--line); color: var(--ink); white-space: nowrap; }
.st.open { background: var(--warn-bg); color: var(--warn); }
.st.in_progress { background: var(--soft); color: var(--acc); }
.st.done { background: var(--acc); color: var(--acc-ink); }
.lnk { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; color: var(--acc); font-weight: 600; font-size: 17px; text-decoration: none; white-space: nowrap; }
.lnk:hover span { text-decoration: underline; }
.lnk.plain { color: var(--mut); }
.lnk.plain:hover span { text-decoration: none; }
.rm { display: grid; place-items: center; width: 44px; height: 44px; border: 0; background: none; color: var(--mut); border-radius: 50%; cursor: pointer; }
.rm:hover { background: var(--warn-bg); color: var(--warn); }

/* sites */
.site-list { list-style: none; margin: 12px 0 0; padding: 0; border-top: 1px solid var(--line); }
.site-row { display: flex; flex-direction: column; gap: 2px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.site-row code { font-size: 17px; color: var(--ink); }

/* token form */
.token { max-width: 420px; margin: 48px auto 0; display: flex; flex-direction: column; align-items: flex-start; gap: 16px; }
.notice { font: 400 21px/1.45 var(--hf); margin: 24px 0 0; }
.muted { color: var(--mut); }

@media (min-width: 640px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 900px) {
  main { padding: 40px 32px 72px; }
  .owner {
    grid-template-columns: 290px minmax(0, 1fr); grid-template-rows: auto auto 1fr;
    grid-template-areas: "side ready" "side pages" "side sites"; column-gap: 44px; row-gap: 40px;
  }
  .a-side { border-right: 1px solid var(--line); padding-right: 24px; align-self: stretch; }
  .owner { row-gap: 0; }
  .a-ready:not(:empty) ~ .a-pages { margin-top: 36px; }
  .a-sites { margin-top: 56px; }
}
@media (min-width: 1200px) {
  .pages thead { display: table-header-group; }
  .pages tbody { display: table-row-group; border-top: 0; }
  .pages tr { display: table-row; }
  .pages th {
    text-align: left; font-size: 17px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--mut);
    padding: 10px 12px; border-bottom: 1px solid var(--line);
  }
  .pages td { padding: 14px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .pages td:first-child, .pages th:first-child { padding-left: 0; }
  .pages td:last-child, .pages th:last-child { padding-right: 0; width: 44px; }
  .c-page { display: table-cell; }
  .c-page .tt, .c-page .tu { display: block; }
  .c-page .path { display: inline; }
  .c-rev::after { content: none; }
  .c-links { display: table-cell; white-space: nowrap; }
  .c-links:empty { display: table-cell; }
  .c-links .lnk + .lnk { margin-left: 16px; }
  .ready { flex-direction: row; align-items: center; justify-content: space-between; gap: 20px; }
  .cmd { flex: none; }
}
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById("ttf-dash-style")) return;
  const style = doc.createElement("style");
  style.id = "ttf-dash-style";
  style.textContent = DASH_CSS + OWNER_CSS;
  doc.head.appendChild(style);
}

function errorText(res: { status: number; error?: string }): string {
  if (res.error) return res.error;
  if (res.status === 0) return MSG_OFFLINE;
  return `Something went wrong (status ${res.status}).`;
}

/**
 * Clipboard first. If that is refused, select the shown text (the link or command itself)
 * and try the old copy command; "selected" means the person has to copy it themselves.
 */
export async function copyText(win: Window, text: string, shown: HTMLElement | null): Promise<"copied" | "selected"> {
  try {
    await win.navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    /* fall through */
  }
  if (shown) {
    try {
      const range = win.document.createRange();
      range.selectNodeContents(shown);
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      /* selection unavailable */
    }
  }
  try {
    if (shown && win.document.execCommand("copy")) return "copied";
  } catch {
    /* not supported */
  }
  return "selected";
}

export async function mountOwner(win: Window): Promise<void> {
  const doc = win.document;
  ensureStyle(doc);
  const host = doc.getElementById("app") ?? doc.body;
  host.innerHTML = '<main aria-live="polite"></main>';
  const main = host.querySelector("main")!;

  const showTokenForm = () => {
    main.innerHTML = renderTokenForm();
  };

  // Hash first (and remember it), then storage.
  let token: string | null = null;
  const m = /(?:^#|&)owner=([^&]*)/.exec(win.location.hash);
  if (m) {
    try {
      token = decodeURIComponent(m[1]) || null;
    } catch {
      token = m[1] || null;
    }
  }
  let stored: string | null = null;
  try {
    if (token) win.localStorage.setItem(STORAGE_KEY, token);
    stored = win.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the hash token still works for this visit */
  }
  token = token ?? stored;
  // The owner token is a master key: once it is safely stored, keep it out of the address bar.
  if (m && token && stored === token) {
    try {
      win.history.replaceState(null, "", win.location.pathname + win.location.search);
    } catch {
      /* not fatal */
    }
  }

  const state: OwnerState = { sites: [], overview: { reviewers: [], assignments: [] }, selectedReviewerId: null, flash: null };

  main.addEventListener("submit", (ev) => {
    const form = (ev.target as Element | null)?.closest?.("form[data-form]") as HTMLFormElement | null;
    if (!form) return;
    ev.preventDefault();
    void onSubmit(form);
  });
  main.addEventListener("click", (ev) => {
    const el = (ev.target as Element | null)?.closest?.("[data-action], [data-copy]") as HTMLElement | null;
    if (!el) return;
    void onClick(el);
  });

  if (!token) {
    showTokenForm();
    return;
  }
  const tok = token;

  const forgetToken = () => {
    try {
      win.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    showTokenForm();
  };

  const render = () => {
    main.innerHTML = renderOwner(state);
  };

  /** Fetches everything; false when the token was refused (the token form is showing). */
  const refresh = async (): Promise<boolean> => {
    const [ov, sites] = await Promise.all([api<Overview>(tok, "/api/owner/overview"), api<Site[]>(tok, "/api/owner/sites")]);
    for (const r of [ov, sites]) {
      if (!r.ok && (r.status === 401 || r.status === 403)) {
        forgetToken();
        return false;
      }
    }
    if (!ov.ok || !sites.ok) {
      main.innerHTML = `<p class="notice">${MSG_OFFLINE}</p><button type="button" class="btn" data-action="retry">Try again</button>`;
      return false;
    }
    state.overview = ov.data;
    state.sites = sites.data;
    if (state.selectedReviewerId && !state.overview.reviewers.some((r) => r.id === state.selectedReviewerId)) {
      state.selectedReviewerId = null;
    }
    render();
    return true;
  };

  const showError = (form: HTMLFormElement, res: { status: number; error?: string }) => {
    const line = form.querySelector("[data-error]") as HTMLElement | null;
    if (!line) return;
    line.textContent = errorText(res);
    line.hidden = false;
  };

  const linkFlash = (r: { name: string; token: string }) => {
    state.flash = { kind: "link", name: r.name, url: reviewerLink(win.location.origin, r.token) };
  };

  async function onSubmit(form: HTMLFormElement): Promise<void> {
    const kind = form.getAttribute("data-form");
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    if (kind === "token") {
      const value = (data.token ?? "").trim();
      if (!value) return;
      win.location.hash = "owner=" + encodeURIComponent(value);
      win.location.reload();
      return;
    }
    const button = form.querySelector("button[type=submit]") as HTMLButtonElement | null;
    if (button) button.disabled = true;
    let res: ApiResult<unknown>;
    if (kind === "reviewer") {
      res = await api<{ id: string; name: string; token: string }>(tok, "/api/owner/reviewers", { method: "POST", json: { name: data.name } });
      if (res.ok) {
        const r = res.data as { id: string; name: string; token: string };
        linkFlash(r);
        state.selectedReviewerId = r.id;
      }
    } else if (kind === "assign") {
      res = await api(tok, "/api/owner/assignments", { method: "POST", json: data });
    } else if (kind === "site") {
      res = await api(tok, "/api/owner/sites", { method: "POST", json: data });
    } else {
      return;
    }
    if (button) button.disabled = false;
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return forgetToken();
      showError(form, res);
      return;
    }
    await refresh();
  }

  async function onClick(el: HTMLElement): Promise<void> {
    const copy = el.getAttribute("data-copy");
    if (copy !== null) {
      const shown = el.closest(".flash, .cmd")?.querySelector("code") as HTMLElement | null;
      const result = await copyText(win, copy, shown);
      const label = el.querySelector("span");
      if (!label) return;
      if (result === "copied") {
        label.textContent = "Copied";
        setTimeout(() => (label.textContent = "Copy"), 1800);
      } else {
        label.textContent = el.closest(".flash") ? "Select and copy the link" : "Select and copy the command";
      }
      return;
    }
    const action = el.getAttribute("data-action");
    const id = el.getAttribute("data-id") ?? "";
    const reviewer = state.overview.reviewers.find((r) => r.id === id);
    if (action === "retry") {
      main.innerHTML = '<p class="notice muted">Loading…</p>';
      await refresh();
    } else if (action === "select") {
      state.selectedReviewerId = id && state.selectedReviewerId !== id ? id : null;
      render();
    } else if (action === "dismiss") {
      state.flash = null;
      render();
    } else if (action === "reissue" && reviewer) {
      if (!win.confirm(reissueConfirm(reviewer.name))) return;
      const res = await api<{ id: string; name: string; token: string }>(tok, `/api/owner/reviewers/${encodeURIComponent(id)}/reissue`, {
        method: "POST",
      });
      if (!res.ok) return failNear(el, res);
      linkFlash(res.data);
      await refresh();
    } else if (action === "revoke" && reviewer) {
      if (!win.confirm(revokeConfirm(reviewer.name))) return;
      const res = await api(tok, `/api/owner/reviewers/${encodeURIComponent(id)}/revoke`, { method: "POST" });
      if (!res.ok) return failNear(el, res);
      if (state.flash && state.flash.name === reviewer.name) state.flash = null;
      await refresh();
    } else if (action === "remove") {
      const a = state.overview.assignments.find((x) => x.id === id);
      if (!a || !win.confirm(removeConfirm(a))) return;
      const res = await api(tok, `/api/owner/assignments/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) return failNear(el, res);
      await refresh();
    }
  }

  /** A --warn line next to the control that failed: under the reviewer's link buttons, or in the page cell. */
  function failNear(el: HTMLElement, res: { status: number; error?: string }): void {
    if (res.status === 401 || res.status === 403) return forgetToken();
    const spot = (el.closest(".rv-actions") ?? el.closest("tr")?.querySelector(".c-page")) as HTMLElement | null;
    if (!spot) return;
    let line = spot.querySelector(":scope > .err") as HTMLElement | null;
    if (!line) {
      line = win.document.createElement("p");
      line.className = "err";
      line.setAttribute("role", "alert");
      spot.appendChild(line);
    }
    line.textContent = errorText(res);
  }

  main.innerHTML = '<p class="notice muted">Loading…</p>';
  await refresh();
}

if (typeof document !== "undefined" && document.getElementById("app")) void mountOwner(window);
