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
  it("always prints a name that resolves back to the same reviewer", () => {
    const mj = { id: "m1", name: "Mary-Jane Smith" };
    const mj2 = { id: "m2", name: "Mary Jane" };
    expect(commandName([mj, mj2], mj)).toBe("mary-jane-smith");
    expect(commandName([mj, mj2], mj2)).toBe("mary");
    const a = { id: "a1", name: "Sam Lee" };
    const b = { id: "a2", name: "Sam Lee" };
    expect(commandName([a, b], a)).toBe("a1");
    const k = { id: "k1", name: "李雷" };
    const l = { id: "k2", name: "王芳" };
    expect(commandName([k, l], k)).toBe("k1");
    expect(commandName([k, l], l)).toBe("k2");
    const d = { id: "d1", name: "D'Arcy Lee" };
    const dn = commandName([d, ben], d);
    expect(dn).toMatch(/^[a-z0-9-]+$/);
    expect(dn).toBe("d-arcy-lee");
  });

  it("commandName uses first name when unique, else slug", () => {
    expect(commandName([rp, ben], rp)).toBe("alexis");
    expect(commandName([rp, rs], rp)).toBe("alexis-rivera");
  });
});
