// Reviewer-name rules. A TypeScript port of bin/lib/reviewers.mjs (slug, commandName);
// test/client/names.test.ts runs the same cases as test/cli/reviewers.test.ts so the two stay in step.
export type NamedReviewer = { name: string };

export function slug(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const firstWord = (name: string): string => String(name).trim().split(/\s+/)[0].toLowerCase();

/** First name when unique among reviewers, else the full-name slug. */
export function commandName(reviewers: NamedReviewer[], r: NamedReviewer): string {
  const first = firstWord(r.name);
  const sameFirst = reviewers.filter((x) => firstWord(x.name) === first);
  return sameFirst.length === 1 ? first : slug(r.name);
}
