// Waiting comments, handed from a reviewed site to the reviewer dashboard. Unsent comments live
// in each site's own storage on the phone (overlay/outbox.ts), which the dashboard's origin
// cannot read, so the overlay's Done link carries the counts in the dashboard URL's fragment:
//   /r/#ttf=TOKEN&waiting=<encoded {"site":"slug","pages":{"/path":2}}>
// The dashboard keeps the latest report per site; a report with no pages clears that site.

export const WAITING_PARAM = "waiting";

/** Unsent comments per page path, for one site. */
export type SiteWaiting = { site: string; pages: Record<string, number> };

/** The fragment part to append (after "&") for this site's counts. Zero counts are left out. */
export function encodeWaiting(site: string, pages: Record<string, number>): string {
  const kept: Record<string, number> = {};
  for (const [path, n] of Object.entries(pages)) if (n > 0) kept[path] = n;
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
  const out: Record<string, number> = {};
  for (const [path, n] of Object.entries(pages as Record<string, unknown>)) {
    if (path.startsWith("/") && typeof n === "number" && Number.isInteger(n) && n > 0 && n < 10_000) out[path] = n;
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

/** All sites' counts, as the dashboard keeps them: site slug → path → count. */
export type WaitingBySite = Record<string, Record<string, number>>;

/** Folds one site's report into what the dashboard knew: it replaces that site's counts. */
export function mergeWaiting(known: WaitingBySite, report: SiteWaiting): WaitingBySite {
  const next = { ...known };
  if (Object.keys(report.pages).length) next[report.site] = report.pages;
  else delete next[report.site];
  return next;
}
