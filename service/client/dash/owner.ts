// Owner dashboard (/o/#owner=TOKEN): reviewers and their private links, sites, page
// assignments with status and PR links, and the command that starts a review cycle.
// Pure view functions (state in, HTML out) plus a thin mount layer that talks to the API.
import { api, escapeHtml, type ApiResult } from "./common";
import { commandName } from "./names";
import { DASH_CSS } from "./dash.css";

export type Site = { slug: string; name: string; origin: string; repo: string; created_at?: string };
export type OwnerReviewer = { id: string; name: string; revoked: boolean; unsettled_count: number; ready_count: number };
export type AssignmentStatus = "not_started" | "open" | "in_progress" | "done";
export type OwnerAssignment = {
  id: string;
  site: string;
  path: string;
  title: string;
  created_at: string;
  reviewer: { id: string; name: string };
  status: AssignmentStatus;
  counts: { open: number; in_progress: number; settled: number };
  pr_urls: string[];
};
export type Overview = { reviewers: OwnerReviewer[]; assignments: OwnerAssignment[] };
export type Flash = { kind: "link"; id: string; name: string; url: string };
export type OwnerState = {
  sites: Site[];
  overview: Overview;
  /** The reviewer the assign panel is open for; null when it is closed. */
  assignFor: string | null;
  flash: Flash | null;
};
export type ReadyBatch = { reviewerId: string; reviewerName: string; siteSlug: string; siteName: string; open: number; command: string };

export const STORAGE_KEY = "ttf:owner-token";

const MSG_OFFLINE = "Can't reach the review service right now.";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const esc = escapeHtml;

/**
 * The Claude Code command that starts a review cycle for one reviewer on one site. The name is the
 * first name when it is unique among all reviewers, else the full-name slug (the CLI refuses an
 * ambiguous first name). Pass every reviewer so a shared first name is noticed.
 */
export function fixCommand(
  reviewerName: string,
  siteSlug: string,
  reviewers: { id?: string; name: string }[] = [{ name: reviewerName }],
  reviewerId?: string,
): string {
  const r = reviewers.find((x) => reviewerId !== undefined && x.id === reviewerId) ?? reviewers.find((x) => x.name === reviewerName) ?? { name: reviewerName };
  return `/tap-to-fix:fix ${commandName(reviewers, r)} ${siteSlug}`;
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
      reviewerId: a.reviewer.id,
      reviewerName: a.reviewer.name,
      siteSlug: a.site,
      siteName: siteName.get(a.site) ?? a.site,
      open: 0,
      command: fixCommand(a.reviewer.name, a.site, overview.reviewers, a.reviewer.id),
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
const DOWNLOAD = svg('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', 18);
const OUT = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 17);
const LINK = svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 18);
const MORE = svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>');
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

/** The comment counts for one page: the open count in bold, zeros left out. */
export function countsText(a: OwnerAssignment): string {
  const { open, in_progress, settled } = a.counts;
  const parts = [open ? `<b>${open} open</b>` : "", in_progress ? `${in_progress} in progress` : "", settled ? `${settled} settled` : ""];
  return parts.filter(Boolean).join(" · ") || "No comments yet";
}

/** The origin without its scheme ("https://greensprings.life" → "greensprings.life"). */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^[a-z]+:\/\//i, "");
  }
}

function initial(name: string): string {
  return esc(firstName(name).slice(0, 1).toUpperCase()) || "?";
}

function commandHtml(command: string): string {
  return (
    `<div class="cmd"><code>${command
      .split(" ")
      .map((t) => `<span class="tok">${esc(t)}</span>`)
      .join(" ")}</code>${copyButton(command)}</div>`
  );
}

function flashHtml(f: Flash): string {
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

function menuHtml(r: OwnerReviewer, batches: ReadyBatch[]): string {
  const items =
    (r.revoked ? "" : `<button type="button" class="mi" data-action="revoke" data-id="${esc(r.id)}">Turn off link</button>`) +
    batches
      .map((b) => {
        const label = `Download batch file for ${b.siteName}`;
        return (
          `<div class="dl"><button type="button" class="mi" data-action="download-batch" data-id="${esc(r.id)}" data-site="${esc(b.siteSlug)}" data-label="${esc(label)}">` +
          `${DOWNLOAD}<span>${esc(label)}</span></button>` +
          `<p class="dl-s">For when the network is blocked: ttf batch --from reads it.</p>${errLine()}</div>`
        );
      })
      .join("");
  if (!items) return "";
  return (
    `<details class="more"><summary class="ico" aria-label="${esc(`More for ${firstName(r.name)}`)}" title="More">${MORE}</summary>` +
    `<div class="menu">${items}</div></details>`
  );
}

function pageHtml(a: OwnerAssignment, site: Site | undefined): string {
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
    `<li class="pg" data-row="${esc(a.id)}"><div class="grow">` +
    `<p class="tt">${esc(a.title)}</p>` +
    `<p class="tu">${esc(site ? site.name + " " : "")}<span class="mono">${esc(a.path)}</span></p>` +
    `<div class="meta"><span class="st ${a.status}">${STATUS_LABEL[a.status]}</span><span class="counts">${countsText(a)}</span>${links}</div>` +
    `</div><button type="button" class="rm" data-action="remove" data-id="${esc(a.id)}" aria-label="${esc(label)}" title="Remove">${CLOSE}</button></li>`
  );
}

/** Stand-in for the assign panel: the old form, fixed to one reviewer. */
function assignFormHtml(s: OwnerState, r: OwnerReviewer): string {
  const siteOpts = s.sites.map((x) => `<option value="${esc(x.slug)}">${esc(x.name)}</option>`).join("");
  return (
    `<form class="assign" data-form="assign" novalidate>` +
    `<p class="assign-h">Assign a page to ${esc(firstName(r.name))}</p>` +
    `<input type="hidden" name="reviewer_id" value="${esc(r.id)}">` +
    `<div class="grid">` +
    `<label class="fld"><span>Site</span><select name="site">${siteOpts}</select></label>` +
    field("Path", "path", 'placeholder="/digital-detox" autocapitalize="off" spellcheck="false"') +
    field("Title", "title", 'placeholder="Digital Detox"') +
    `</div>${errLine()}` +
    `<div class="row-btns"><button type="submit" class="btn">Assign</button><button type="button" class="btn quiet" data-action="assign-cancel">Cancel</button></div>` +
    `</form>`
  );
}

function personHtml(s: OwnerState, r: OwnerReviewer, batches: ReadyBatch[]): string {
  const sites = new Map(s.sites.map((x) => [x.slug, x]));
  const mine = s.overview.assignments.filter((a) => a.reviewer.id === r.id);
  const first = esc(firstName(r.name));
  const sub = `${plural(r.unsettled_count, "open comment", "open comments")} · ${r.revoked ? `<span class="off">Link off</span>` : "link on"}`;
  const ready = batches
    .map((b) => `<div class="ready" data-ready><p>${plural(b.open, "comment", "comments")} ready to fix on ${esc(b.siteName)}</p>${commandHtml(b.command)}</div>`)
    .join("");
  const pages = mine.length
    ? `<ul class="pgs">${mine.map((a) => pageHtml(a, sites.get(a.site))).join("")}</ul>`
    : `<p class="none">No pages for ${first} yet.</p>`;
  const add =
    s.sites.length === 0
      ? ""
      : s.assignFor === r.id
        ? assignFormHtml(s, r)
        : `<div class="add"><button type="button" class="btn quiet" data-action="assign" data-id="${esc(r.id)}">${PLUS}<span>Assign a page to ${first}</span></button></div>`;
  return (
    `<section class="person" data-person="${esc(r.id)}" aria-labelledby="p-${esc(r.id)}">` +
    `<div class="person-h"><span class="av" aria-hidden="true">${initial(r.name)}</span>` +
    `<div class="grow"><h2 class="pname" id="p-${esc(r.id)}">${esc(r.name)}</h2><p class="tu">${sub}</p></div>` +
    `<button type="button" class="btn quiet" data-action="reissue" data-id="${esc(r.id)}">${LINK}<span>New link</span></button>` +
    menuHtml(r, batches) +
    `</div><div class="person-err"></div>` +
    (s.flash && s.flash.id === r.id ? flashHtml(s.flash) : "") +
    ready +
    pages +
    add +
    `</section>`
  );
}

function sitesHtml(s: OwnerState): string {
  const count = new Map<string, number>();
  for (const a of s.overview.assignments) count.set(a.site, (count.get(a.site) ?? 0) + 1);
  const list = s.sites
    .map(
      (x) =>
        `<li class="siterow"><b>${esc(x.name)}</b><span class="tu">${esc(hostOf(x.origin))} · ${plural(count.get(x.slug) ?? 0, "page", "pages")}</span>` +
        `<span class="tu more-line">slug <code>${esc(x.slug)}</code> · ${esc(x.repo)}</span></li>`,
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
    `<section class="sites" aria-labelledby="h-sites">` +
    `<div class="sec-h"><h2 class="h2" id="h-sites">Sites</h2>${adder("site", "Add a site", body, s.sites.length === 0)}</div>` +
    (list ? `<ul class="rule" data-sites>${list}</ul>` : "") +
    `</section>`
  );
}

export function renderOwner(state: OwnerState): string {
  const { reviewers } = state.overview;
  const batches = readyBatches(state.overview, state.sites);
  const form = field("Name", "name", 'placeholder="Alexis"') + `<button type="submit" class="btn">Add</button>`;
  return (
    `<h1 class="sr">tap-to-fix owner dashboard</h1>` +
    `<div class="top"><p class="brand">tap-to-fix</p>` +
    adder("reviewer", reviewers.length ? "Add a reviewer" : "Add your first reviewer", form, reviewers.length === 0) +
    `</div>` +
    (state.flash && !reviewers.some((r) => r.id === state.flash!.id) ? flashHtml(state.flash) : "") +
    (state.sites.length === 0 ? `<p class="empty">Add a site first. The form is under Sites, below.</p>` : "") +
    (reviewers.length
      ? `<div class="people">${reviewers.map((r) => personHtml(state, r, batches.filter((b) => b.reviewerId === r.id))).join("")}</div>`
      : "") +
    sitesHtml(state)
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
main { max-width: 1240px; padding-top: 22px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
p, h2 { margin: 0; }
button { font: inherit; color: inherit; }
.h { font: 600 26px/1.2 var(--hf); margin: 0; letter-spacing: -0.01em; }
.h2 { font: 600 24px/1.2 var(--hf); }
.empty { font: 400 19px/1.45 var(--hf); color: var(--mut); margin: 22px 0 0; }
.tt { font: 600 19px/1.3 var(--hf); overflow-wrap: anywhere; }
.tu { font-size: 16px; line-height: 1.4; color: var(--mut); overflow-wrap: anywhere; }
.mono, code { font-family: ui-monospace, Menlo, monospace; font-size: 16px; }
.grow { flex: 1 1 auto; min-width: 0; }
.off { color: var(--warn); font-weight: 600; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 18px;
  border: 0; border-radius: 999px; background: var(--acc); color: var(--acc-ink); font-size: 17px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn.quiet { background: transparent; color: var(--acc); padding: 0 10px; }
.btn.quiet:hover { background: var(--soft); }
.ico { display: inline-grid; place-items: center; width: 44px; height: 44px; color: var(--mut); border-radius: 50%; cursor: pointer; }
.ico:hover { background: var(--soft); color: var(--ink); }
.btn:focus-visible, .rm:focus-visible, .lnk:focus-visible, .mi:focus-visible, summary:focus-visible { outline: 3px solid var(--acc); outline-offset: 2px; }

/* top bar */
.top { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.brand { font: 600 24px/1.2 var(--hf); }

/* inline forms (Add a reviewer, Add a site): the toggle sits at the right, the form opens full width under it */
.adder { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; }
.adder[open] { flex-basis: 100%; }
.adder > summary {
  display: inline-flex; align-items: center; gap: 7px; min-height: 44px; padding: 0 18px; border-radius: 999px;
  color: var(--acc); font-weight: 600; font-size: 17px; cursor: pointer; list-style: none; white-space: nowrap;
}
.top .adder > summary { background: var(--surf); border: 1.5px solid var(--line); }
.sites .adder > summary { padding: 0 10px; }
.adder > summary:hover { background: var(--soft); }
.adder > summary::-webkit-details-marker { display: none; }
.adder form { align-self: stretch; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; padding: 14px 0 8px; }
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

/* one column per reviewer */
.people { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 40px; margin-top: 22px; align-items: start; }
.person { min-width: 0; }
.person-h { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 2px solid var(--ink); }
.av { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--ink); color: var(--bg); font-weight: 700; flex: none; }
.pname { font: 600 22px/1.2 var(--hf); overflow-wrap: anywhere; }
.person-err:empty { display: none; }
.person-err .err { margin-top: 10px; }

/* the more menu */
.more { position: relative; flex: none; }
.more > summary { list-style: none; }
.more > summary::-webkit-details-marker { display: none; }
.more[open] > summary { background: var(--soft); color: var(--ink); }
.menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 5; width: max-content; max-width: min(360px, calc(100vw - 32px));
  background: var(--surf); border: 1.5px solid var(--line); border-radius: 12px; box-shadow: 0 8px 24px rgba(31, 42, 36, .12); padding: 6px 0;
}
.mi {
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 0 16px; border: 0; background: none;
  text-align: left; font-size: 17px; font-weight: 600; color: var(--acc); cursor: pointer;
}
.mi:hover { background: var(--soft); }
.menu > * + * { border-top: 1px solid var(--line); }
.dl { padding-bottom: 10px; }
.dl-s { font-size: 16px; color: var(--mut); padding: 0 16px 0 44px; }
.dl .err { margin: 8px 16px 0; }

/* new-link flash, in the reviewer's column */
.flash { margin-top: 14px; padding: 14px 0 6px; border-bottom: 1px solid var(--line); }
.flash-h { font: 600 20px/1.3 var(--hf); }
.flash-s { margin: 4px 0 10px; font-size: 16px; color: var(--mut); }
.flash-url { display: block; font-size: 16px; font-weight: 600; background: var(--surf); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; overflow-wrap: anywhere; user-select: all; }
.flash-row { display: flex; gap: 4px; margin-top: 8px; margin-left: -10px; }

/* ready strip: a rule at the left, no box */
.ready { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 14px 0 4px; padding: 12px 0 12px 14px; border-left: 4px solid var(--acc); }
.ready p { font-weight: 600; }
.cmd { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-height: 44px; padding: 0 4px 0 12px; background: var(--surf); border: 1px solid var(--line); border-radius: 8px; }
.cmd code { font-size: 15px; font-weight: 600; user-select: all; min-width: 0; padding: 8px 0; }
.cmd .tok { white-space: nowrap; }
.cmd .btn { flex: none; }

/* pages: ruled rows */
.pgs { list-style: none; margin: 0; padding: 0; }
.pg { display: flex; gap: 12px; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid var(--line); }
.pg .err { margin-top: 8px; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0 14px; margin-top: 0; }
.st { display: inline-block; font-size: 15px; font-weight: 600; padding: 3px 11px; border-radius: 999px; background: var(--line); color: var(--ink); white-space: nowrap; }
.st.open { background: var(--warn-bg); color: var(--warn); }
.st.in_progress { background: var(--soft); color: var(--acc); }
.st.done { background: var(--acc); color: var(--acc-ink); }
.counts { font-size: 16px; color: var(--mut); }
.counts b { color: var(--warn); font-weight: 700; }
.lnk { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; color: var(--acc); font-weight: 600; font-size: 16px; text-decoration: none; white-space: nowrap; }
.lnk:hover span { text-decoration: underline; }
.lnk.plain { color: var(--mut); }
.lnk.plain:hover span { text-decoration: none; }
.rm { display: grid; place-items: center; flex: none; width: 44px; height: 44px; margin-top: -8px; border: 0; background: none; color: var(--mut); border-radius: 50%; cursor: pointer; }
.rm:hover { background: var(--warn-bg); color: var(--warn); }
.none { color: var(--mut); padding: 14px 0; border-bottom: 1px solid var(--line); }
.add { margin-top: 6px; margin-left: -10px; }
.assign { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; padding: 16px 0 8px; }
.assign-h { font: 600 20px/1.3 var(--hf); }
.row-btns { display: flex; gap: 8px; }

/* sites */
.sites { margin-top: 48px; }
.sec-h { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
.rule { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.siterow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.siterow .more-line { flex-basis: 100%; }
.siterow code { font-size: 16px; color: var(--ink); }

/* token form */
.token { max-width: 420px; margin: 48px auto 0; display: flex; flex-direction: column; align-items: flex-start; gap: 16px; }
.notice { font: 400 21px/1.45 var(--hf); margin: 24px 0 0; }
.muted { color: var(--mut); }

@media (min-width: 640px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .assign .grid { grid-template-columns: minmax(0, 1fr); }
}
@media (min-width: 900px) {
  main { padding: 32px 32px 72px; }
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

  const state: OwnerState = { sites: [], overview: { reviewers: [], assignments: [] }, assignFor: null, flash: null };

  main.addEventListener("submit", (ev) => {
    const form = (ev.target as Element | null)?.closest?.("form[data-form]") as HTMLFormElement | null;
    if (!form) return;
    ev.preventDefault();
    void onSubmit(form);
  });
  main.addEventListener("click", (ev) => {
    const inside = (ev.target as Element | null)?.closest?.("details.more");
    for (const d of main.querySelectorAll("details.more[open]")) if (d !== inside) d.removeAttribute("open");
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
    if (state.assignFor && !state.overview.reviewers.some((r) => r.id === state.assignFor)) {
      state.assignFor = null;
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

  const linkFlash = (r: { id: string; name: string; token: string }) => {
    state.flash = { kind: "link", id: r.id, name: r.name, url: reviewerLink(win.location.origin, r.token) };
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
      }
    } else if (kind === "assign") {
      res = await api(tok, "/api/owner/assignments", { method: "POST", json: data });
      if (res.ok) state.assignFor = null;
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
    if (action === "download-batch") {
      await downloadBatch(el, id, el.getAttribute("data-site") ?? "");
    } else if (action === "retry") {
      main.innerHTML = '<p class="notice muted">Loading…</p>';
      await refresh();
    } else if (action === "assign" && reviewer) {
      state.assignFor = id;
      render();
      (main.querySelector(`[data-person="${CSS.escape(id)}"] form[data-form=assign] select`) as HTMLElement | null)?.focus();
    } else if (action === "assign-cancel") {
      state.assignFor = null;
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
      if (state.flash && state.flash.id === reviewer.id) state.flash = null;
      await refresh();
    } else if (action === "remove") {
      const a = state.overview.assignments.find((x) => x.id === id);
      if (!a || !win.confirm(removeConfirm(a))) return;
      const res = await api(tok, `/api/owner/assignments/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) return failNear(el, res);
      await refresh();
    }
  }

  /** Bearer fetch of the offline batch file, then a Blob download; the token never goes in a URL. */
  async function downloadBatch(el: HTMLElement, reviewerId: string, site: string): Promise<void> {
    const err = el.closest(".dl")?.querySelector("[data-error]") as HTMLElement | null;
    const fail = (text: string) => {
      if (!err) return;
      err.textContent = text;
      err.hidden = false;
    };
    if (err) err.hidden = true;
    const label = el.querySelector("span");
    if (label) label.textContent = "Preparing…";
    try {
      const res = await fetch(`/api/owner/batch?reviewer=${encodeURIComponent(reviewerId)}&site=${encodeURIComponent(site)}&format=file`, {
        headers: { Authorization: "Bearer " + tok },
      });
      if (res.status === 401 || res.status === 403) return forgetToken();
      if (!res.ok) return fail(`Something went wrong (status ${res.status}).`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "tap-to-fix-batch.json";
      const url = URL.createObjectURL(blob);
      const a = win.document.createElement("a");
      a.href = url;
      a.download = name;
      win.document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      fail(MSG_OFFLINE);
    } finally {
      if (label) label.textContent = el.getAttribute("data-label") ?? "Download batch file";
    }
  }

  /** A --warn line next to the control that failed: in the page row, or under the reviewer's header. */
  function failNear(el: HTMLElement, res: { status: number; error?: string }): void {
    if (res.status === 401 || res.status === 403) return forgetToken();
    const spot = (el.closest(".pg")?.querySelector(".grow") ?? el.closest(".person")?.querySelector(".person-err")) as HTMLElement | null;
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
