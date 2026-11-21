import { describe, expect, it } from "vitest";
import { commandName, slug } from "../../client/dash/names";
// @ts-expect-error plain .mjs, not type-checked
import * as cli from "../../../bin/lib/reviewers.mjs";

const rp = { id: "r1", name: "Alexis Rivera" };
const rs = { id: "r2", name: "Alexis Smith" };
const ben = { id: "r3", name: "Ben" };

describe("names (TS port of bin/lib/reviewers.mjs)", () => {
  it("slugs names", () => expect(slug("  Alexis O'Neil! ")).toBe("alexis-o-neil"));
  it("commandName uses first name when unique, else slug", () => {
    expect(commandName([rp, ben], rp)).toBe("alexis");
    expect(commandName([rp, rs], rp)).toBe("alexis-rivera");
  });
  it("agrees with the CLI on every case", () => {
    for (const n of ["  Alexis O'Neil! ", "Ben", "Zoë Q.", "  ", "A  B"]) expect(slug(n)).toBe(cli.slug(n));
    for (const set of [[rp, ben], [rp, rs], [rp, rs, ben]]) {
      for (const r of set) expect(commandName(set, r)).toBe(cli.commandName(set, r));
    }
  });
});
