export class AmbiguousReviewer extends Error {
  constructor(arg, matches) {
    super(
      `"${arg}" matches more than one reviewer: ` +
        matches.map((m) => `${m.name} (${slug(m.name)}, id ${m.id})`).join(", ") +
        ". Use the full-name slug or the id.",
    );
    this.name = "AmbiguousReviewer";
    this.matches = matches;
  }
}

export class UnknownReviewer extends Error {
  constructor(arg) {
    super(`No reviewer matches "${arg}".`);
    this.name = "UnknownReviewer";
  }
}

export function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const firstWord = (name) => String(name).trim().split(/\s+/)[0].toLowerCase();

/** Exact id; else full-name slug; else first word, case-insensitive. */
export function resolveReviewer(reviewers, arg) {
  const a = String(arg ?? "").trim();
  const byId = reviewers.find((r) => r.id === a);
  if (byId) return byId;
  const s = slug(a);
  const bySlug = reviewers.filter((r) => slug(r.name) === s);
  if (bySlug.length === 1) return bySlug[0];
  if (bySlug.length > 1) throw new AmbiguousReviewer(a, bySlug);
  const byFirst = reviewers.filter((r) => firstWord(r.name) === a.toLowerCase());
  if (byFirst.length === 1) return byFirst[0];
  if (byFirst.length > 1) throw new AmbiguousReviewer(a, byFirst);
  throw new UnknownReviewer(a);
}

/** First name when unique among reviewers, else the full-name slug. */
export function commandName(reviewers, r) {
  const first = firstWord(r.name);
  const sameFirst = reviewers.filter((x) => firstWord(x.name) === first);
  return sameFirst.length === 1 ? first : slug(r.name);
}
