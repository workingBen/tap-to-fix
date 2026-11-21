import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs, not type-checked
import { AmbiguousReviewer, UnknownReviewer, commandName, resolveReviewer, slug } from "../../../bin/lib/reviewers.mjs";

const rp = { id: "r1", name: "Alexis Rivera" };
const rs = { id: "r2", name: "Alexis Smith" };
const ben = { id: "r3", name: "Ben" };

describe("reviewer matching", () => {
  it("slugs names", () => expect(slug("  Alexis O'Neil! ")).toBe("alexis-o-neil"));
  it("resolves by id, slug and first word", () => {
    expect(resolveReviewer([rp, ben], "r1")).toBe(rp);
    expect(resolveReviewer([rp, ben], "alexis-rivera")).toBe(rp);
    expect(resolveReviewer([rp, rs], "Alexis-Smith")).toBe(rs);
    expect(resolveReviewer([rp, ben], "ALEXIS")).toBe(rp);
  });
  it("is ambiguous for a shared first word", () => {
    try {
      resolveReviewer([rp, rs], "alexis");
      throw new Error("no throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AmbiguousReviewer);
      expect((e as { matches: unknown[] }).matches).toEqual([rp, rs]);
      expect((e as Error).message).toContain("alexis-rivera");
      expect((e as Error).message).toContain("alexis-smith");
    }
  });
  it("throws for unknown", () => {
    expect(() => resolveReviewer([rp], "zed")).toThrow(UnknownReviewer);
  });
  it("commandName uses first name when unique, else slug", () => {
    expect(commandName([rp, ben], rp)).toBe("alexis");
    expect(commandName([rp, rs], rp)).toBe("alexis-rivera");
  });
});
