import { describe, expect, it } from "vitest";
import { commandName, slug } from "../../client/dash/names";
// @ts-expect-error plain .mjs, not type-checked
import * as cli from "../../../bin/lib/reviewers.mjs";

const rp = { id: "r1", name: "Alexis Rivera" };
const rs = { id: "r2", name: "Alexis Smith" };
const ben = { id: "r3", name: "Ben" };

describe("names (TS port of bin/lib/reviewers.mjs)", () => {
  it("slugs names", () => expect(slug("  Alexis O'Neil! ")).toBe("alexis-o-neil"));
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
  it("agrees with the CLI on every case", () => {
    for (const n of ["  Alexis O'Neil! ", "Ben", "Zoë Q.", "  ", "A  B"]) expect(slug(n)).toBe(cli.slug(n));
    for (const set of [[rp, ben], [rp, rs], [rp, rs, ben], [{ id: "m1", name: "Mary-Jane Smith" }, { id: "m2", name: "Mary Jane" }], [{ id: "a1", name: "Sam Lee" }, { id: "a2", name: "Sam Lee" }], [{ id: "k1", name: "李雷" }, { id: "k2", name: "王芳" }], [{ id: "d1", name: "D'Arcy Lee" }, ben]]) {
      for (const r of set) expect(commandName(set, r)).toBe(cli.commandName(set, r));
    }
  });
});
