// Reviewer-name rules. A TypeScript port of bin/lib/reviewers.mjs (slug, commandName);
// test/client/names.test.ts runs the same cases as test/cli/reviewers.test.ts so the two stay in step.
export type NamedReviewer = { name: string; id?: string };

export function slug(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const firstWord = (name: string): string => String(name).trim().split(/\s+/)[0].toLowerCase();

/** Port of resolveReviewer: the one reviewer an argument picks out, or null when none or several match. */
function resolves(reviewers: NamedReviewer[], arg: string): NamedReviewer | null {
  const byId = reviewers.find((r) => r.id !== undefined && r.id === arg);
  if (byId) return byId;
  const s = slug(arg);
  const bySlug = reviewers.filter((r) => slug(r.name) === s);
  if (bySlug.length) return bySlug.length === 1 ? bySlug[0] : null;
  const byFirst = reviewers.filter((r) => firstWord(r.name) === arg.toLowerCase());
  return byFirst.length === 1 ? byFirst[0] : null;
}

/** First name when plain and it resolves back to r; else the full-name slug if plain and it resolves back; else the id. */
export function commandName(reviewers: NamedReviewer[], r: NamedReviewer): string {
  const plain = (s: string) => /^[a-z0-9-]+$/.test(s);
  const back = (s: string) => resolves(reviewers, s) === r;
  const first = firstWord(r.name);
  if (plain(first) && back(first)) return first;
  const s = slug(r.name);
  if (s && plain(s) && back(s)) return s;
  return r.id ?? "";
}
