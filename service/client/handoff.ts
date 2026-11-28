// Waiting comments, handed from a reviewed site to the reviewer dashboard. Unsent comments live
// in each site's own storage on the phone (overlay/outbox.ts), which the dashboard's origin
// cannot read, so the overlay's Done link carries them in the dashboard URL's fragment:
//   /r/#ttf=TOKEN&waiting=<encoded {"site":"slug","pages":{"/path":["client id", …]}}>
// The dashboard keeps the latest report per site; a report with no pages clears that site.
// Ids, not counts: a comment sends later, when its page is next opened online, and the dashboard
// never hears from that page again, so it asks the service which ids have arrived (forgetSent).

export const WAITING_PARAM = "waiting";

/** Unsent comments' client ids per page path, for one site. */
export type SiteWaiting = { site: string; pages: Record<string, string[]> };

const CLIENT_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_PER_PAGE = 500;

/** The fragment part to append (after "&") for this site's waiting comments. Empty pages are left out. */
export function encodeWaiting(site: string, pages: Record<string, string[]>): string {
  const kept: Record<string, string[]> = {};
  for (const [path, ids] of Object.entries(pages)) if (ids.length) kept[path] = ids;
  return `${WAITING_PARAM}=${encodeURIComponent(JSON.stringify({ site, pages: kept }))}`;
}

/** Reads a waiting= report out of a "#a&b" fragment; null when there is none or it is malformed. */
export function decodeWaiting(hash: string): SiteWaiting | null {
  const m = new RegExp("(?:^#|&)" + WAITING_PARAM + "=([^&]*)").exec(hash);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { site, pages } = raw as { site?: unknown; pages?: unknown };
  if (typeof site !== "string" || !site || !pages || typeof pages !== "object" || Array.isArray(pages)) return null;
  const out: Record<string, string[]> = {};
  for (const [path, ids] of Object.entries(pages as Record<string, unknown>)) {
    // A bare count (an overlay from before ids) can't be checked against the service: dropped.
    if (!path.startsWith("/") || !Array.isArray(ids)) continue;
    const kept = [...new Set(ids.filter((id): id is string => typeof id === "string" && CLIENT_ID.test(id)))].slice(0, MAX_PER_PAGE);
    if (kept.length) out[path] = kept;
  }
  return { site, pages: out };
}

/** The fragment without its waiting= part (the token and anything else stay as they were). */
export function stripWaiting(hash: string): string {
  const rest = hash
    .replace(/^#/, "")
    .split("&")
    .filter((p) => p !== "" && !p.startsWith(WAITING_PARAM + "="));
  return rest.length ? "#" + rest.join("&") : "";
}

/** All sites' waiting comments, as the dashboard keeps them: site slug → path → client ids. */
export type WaitingBySite = Record<string, Record<string, string[]>>;

/** Folds one site's report into what the dashboard knew: it replaces that site's counts. */
export function mergeWaiting(known: WaitingBySite, report: SiteWaiting): WaitingBySite {
  const next = { ...known };
  if (Object.keys(report.pages).length) next[report.site] = report.pages;
  else delete next[report.site];
  return next;
}

/** Drops a page's ids the service already has (they sent); empty pages and sites go too. */
export function forgetSent(known: WaitingBySite, site: string, path: string, onServer: Set<string>): WaitingBySite {
  const ids = known[site]?.[path];
  if (!ids || !ids.some((id) => onServer.has(id))) return known;
  const left = ids.filter((id) => !onServer.has(id));
  const pages = { ...known[site] };
  if (left.length) pages[path] = left;
  else delete pages[path];
  const next = { ...known };
  if (Object.keys(pages).length) next[site] = pages;
  else delete next[site];
  return next;
}
