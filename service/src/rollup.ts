export type Status = "open" | "in_progress" | "done" | "later" | "kept";
export type AssignmentStatus = "not_started" | "open" | "in_progress" | "done";

const SETTLED: ReadonlySet<Status> = new Set<Status>(["done", "later", "kept"]);

export const isSettled = (s: Status): boolean => SETTLED.has(s);

export function assignmentStatus(statuses: Status[]): AssignmentStatus {
  if (statuses.length === 0) return "not_started";
  if (statuses.includes("open")) return "open";
  if (statuses.includes("in_progress")) return "in_progress";
  return "done";
}

/** Settled comments divided by all comments; 0 when there are none. */
export function progress(statuses: Status[]): number {
  if (statuses.length === 0) return 0;
  return statuses.filter(isSettled).length / statuses.length;
}

/** True when the reviewer has opened the assignment and something changed since. */
export function isUpdated(lastOpenedAt: string | null, changedAts: string[]): boolean {
  if (lastOpenedAt === null) return false;
  return changedAts.some((t) => t > lastOpenedAt);
}
