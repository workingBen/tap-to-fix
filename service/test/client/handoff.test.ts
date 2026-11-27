import { describe, expect, it } from "vitest";
import { decodeWaiting, encodeWaiting, mergeWaiting, stripWaiting } from "../../client/handoff";

describe("dashboard hand-off of waiting counts", () => {
  it("round-trips a site's counts through the fragment, leaving out zeros", () => {
    const part = encodeWaiting("fixture", { "/index.html": 2, "/other path?&x": 1, "/none": 0 });
    expect(part).not.toMatch(/[&#]/); // safe inside "#ttf=…&<part>"
    expect(decodeWaiting("#ttf=tok&" + part)).toEqual({ site: "fixture", pages: { "/index.html": 2, "/other path?&x": 1 } });
  });
  it("a report of nothing waiting still parses (it clears the site)", () => {
    expect(decodeWaiting("#ttf=tok&" + encodeWaiting("fixture", {}))).toEqual({ site: "fixture", pages: {} });
  });
  it("is null when absent or malformed, and drops bad entries", () => {
    expect(decodeWaiting("#ttf=tok")).toBeNull();
    expect(decodeWaiting("#ttf=tok&waiting=%7Bnope")).toBeNull();
    expect(decodeWaiting("#waiting=" + encodeURIComponent(JSON.stringify({ pages: {} })))).toBeNull();
    expect(decodeWaiting("#waiting=" + encodeURIComponent(JSON.stringify({ site: "s", pages: [1] })))).toBeNull();
    const odd = { site: "s", pages: { "/ok": 3, nopath: 2, "/neg": -1, "/frac": 1.5, "/str": "2", "/huge": 1e9 } };
    expect(decodeWaiting("#waiting=" + encodeURIComponent(JSON.stringify(odd)))).toEqual({ site: "s", pages: { "/ok": 3 } });
  });
  it("does not mistake another param ending in waiting=", () => {
    expect(decodeWaiting("#notwaiting=" + encodeURIComponent(JSON.stringify({ site: "s", pages: { "/a": 1 } })))).toBeNull();
  });
  it("strips only the waiting part", () => {
    expect(stripWaiting("#ttf=tok&" + encodeWaiting("s", { "/a": 1 }))).toBe("#ttf=tok");
    expect(stripWaiting("#" + encodeWaiting("s", {}))).toBe("");
    expect(stripWaiting("#ttf=tok&x=1")).toBe("#ttf=tok&x=1");
  });
  it("a site's report replaces what was known for that site only", () => {
    const known = { a: { "/1": 1 }, b: { "/2": 2 } };
    expect(mergeWaiting(known, { site: "a", pages: { "/3": 3 } })).toEqual({ a: { "/3": 3 }, b: { "/2": 2 } });
    expect(mergeWaiting(known, { site: "b", pages: {} })).toEqual({ a: { "/1": 1 } });
    expect(known).toEqual({ a: { "/1": 1 }, b: { "/2": 2 } }); // not mutated
  });
});
