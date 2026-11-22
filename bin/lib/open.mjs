import { commandName, resolveReviewer } from "./reviewers.mjs";

/** Statuses that still need work. Everything else (done, later, kept) is settled. */
export const UNSETTLED = ["open", "in_progress"];

/** How long ago an ISO time was, in plain words; "" when it does not parse. */
export function age(iso, now) {
  const t = Date.parse(String(iso ?? ""));
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * One line of a comment body, at most `max` characters. Control characters
 * become spaces: a body is third-party text and must not drive the terminal.
 */
export function snippet(body, max = 60) {
  // eslint-disable-next-line no-control-regex
  const line = String(body ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return line.length <= max ? line : line.slice(0, max - 1) + "…";
}

const STATUS_LABEL = { open: "open", in_progress: "in progress" };

/**
 * Every reviewer + site with unsettled comments, most comments first.
 * Returns [{ reviewer, site, command, comments }], reading /overview then /batch.
 */
export async function openBatches(api, reviewerArg) {
  const { reviewers, assignments } = await api.overview();
  const only = reviewerArg === undefined ? null : resolveReviewer(reviewers, reviewerArg);
  const keys = new Map();
  for (const a of assignments) {
    if (only && a.reviewer.id !== only.id) continue;
    if (!(a.counts.open + a.counts.in_progress)) continue;
    const k = a.reviewer.id + "\u0000" + a.site;
    if (!keys.has(k)) keys.set(k, { reviewerId: a.reviewer.id, site: a.site });
  }
  const groups = [];
  for (const { reviewerId, site } of keys.values()) {
    const batch = await api.batch(reviewerId, site, UNSETTLED);
    if (!batch.comments.length) continue;
    const r = reviewers.find((x) => x.id === reviewerId) ?? batch.reviewer;
    groups.push({
      reviewer: batch.reviewer,
      site: batch.site,
      command: `/tap-to-fix:fix ${commandName(reviewers, r)} ${batch.site.slug}`,
      comments: batch.comments,
    });
  }
  groups.sort((a, b) => b.comments.length - a.comments.length); // stable: ties keep dashboard order
  return { only, groups };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The text `ttf open` prints, as lines. */
export function openLines({ only, groups }, now) {
  if (!groups.length) return [only ? `Nothing waiting for ${only.name}.` : "Nothing waiting: every comment is settled."];
  const lines = [];
  let total = 0;
  for (const g of groups) {
    total += g.comments.length;
    lines.push(`${g.reviewer.name} · ${g.site.name} (${g.site.slug}) · ${g.comments.length} waiting`);
    const pages = new Map();
    for (const c of g.comments) {
      const list = pages.get(c.page.path) ?? [];
      list.push(c);
      pages.set(c.page.path, list);
    }
    for (const [path, list] of pages) {
      lines.push(`  ${path}`);
      for (const c of list) {
        const status = (STATUS_LABEL[c.status] ?? String(c.status)).padEnd(13);
        lines.push(`    ${status}${age(c.created_at, now).padEnd(13)}${snippet(c.body)}`.trimEnd());
      }
    }
    lines.push(`  Run: ${g.command}`, "");
  }
  lines.push(`${plural(total, "comment", "comments")} waiting in ${plural(groups.length, "batch", "batches")}.`);
  return lines;
}
