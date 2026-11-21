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

/** First name when plain and it resolves back to r; else the full-name slug if plain and it resolves back; else the id. */
export function commandName(reviewers, r) {
  const plain = (s) => /^[a-z0-9-]+$/.test(s);
  const back = (s) => {
    try {
      return resolveReviewer(reviewers, s) === r;
    } catch {
      return false;
    }
  };
  const first = firstWord(r.name);
  if (plain(first) && back(first)) return first;
  const s = slug(r.name);
  if (s && plain(s) && back(s)) return s;
  return r.id;
}
