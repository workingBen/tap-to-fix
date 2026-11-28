import { describe, expect, it } from "vitest";
import { decodeWaiting, encodeWaiting, forgetSent, mergeWaiting, stripWaiting } from "../../client/handoff";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("dashboard hand-off of waiting comments", () => {
  it("round-trips a site's comment ids through the fragment, leaving out empty pages", () => {
    const part = encodeWaiting("fixture", { "/index.html": [A, B], "/other path?&x": [C], "/none": [] });
    expect(part).not.toMatch(/[&#]/); // safe inside "#ttf=…&<part>"
    expect(decodeWaiting("#ttf=tok&" + part)).toEqual({ site: "fixture", pages: { "/index.html": [A, B], "/other path?&x": [C] } });
  });
  it("a report of nothing waiting still parses (it clears the site)", () => {
    expect(decodeWaiting("#ttf=tok&" + encodeWaiting("fixture", {}))).toEqual({ site: "fixture", pages: {} });
  });
  it("is null when absent or malformed, and drops bad entries", () => {
    expect(decodeWaiting("#ttf=tok")).toBeNull();
    expect(decodeWaiting("#ttf=tok&waiting=%7Bnope")).toBeNull();
    expect(decodeWaiting("#waiting=" + encodeURIComponent(JSON.stringify({ pages: {} })))).toBeNull();
    expect(decodeWaiting("#waiting=" + encodeURIComponent(JSON.stringify({ site: "s", pages: [1] })))).toBeNull();
    const odd = { site: "s", pages: { "/ok": [A, "bad id!", 3, A], nopath: [B], "/count": 2, "/empty": [] } };
    // A bare count (the old link) can't be checked against the service, so it is dropped.
    expect(decodeWaiting("#waiting=" + encodeURIComponent(JSON.stringify(odd)))).toEqual({ site: "s", pages: { "/ok": [A] } });
  });
  it("does not mistake another param ending in waiting=", () => {
    expect(decodeWaiting("#notwaiting=" + encodeURIComponent(JSON.stringify({ site: "s", pages: { "/a": [A] } })))).toBeNull();
  });
  it("strips only the waiting part", () => {
    expect(stripWaiting("#ttf=tok&" + encodeWaiting("s", { "/a": [A] }))).toBe("#ttf=tok");
    expect(stripWaiting("#" + encodeWaiting("s", {}))).toBe("");
    expect(stripWaiting("#ttf=tok&x=1")).toBe("#ttf=tok&x=1");
  });
  it("a site's report replaces what was known for that site only", () => {
    const known = { a: { "/1": [A] }, b: { "/2": [B] } };
    expect(mergeWaiting(known, { site: "a", pages: { "/3": [C] } })).toEqual({ a: { "/3": [C] }, b: { "/2": [B] } });
    expect(mergeWaiting(known, { site: "b", pages: {} })).toEqual({ a: { "/1": [A] } });
    expect(known).toEqual({ a: { "/1": [A] }, b: { "/2": [B] } }); // not mutated
  });
  it("forgetSent drops the ids the service already has, and empty pages and sites with them", () => {
    const known = { a: { "/1": [A, B], "/2": [C] }, b: { "/1": [A] } };
    expect(forgetSent(known, "a", "/1", new Set([A]))).toEqual({ a: { "/1": [B], "/2": [C] }, b: { "/1": [A] } });
    expect(forgetSent(known, "a", "/2", new Set([C]))).toEqual({ a: { "/1": [A, B] }, b: { "/1": [A] } });
    expect(forgetSent(known, "b", "/1", new Set([A]))).toEqual({ a: { "/1": [A, B], "/2": [C] } });
    expect(forgetSent(known, "a", "/1", new Set())).toBe(known); // nothing sent: same object
    expect(known).toEqual({ a: { "/1": [A, B], "/2": [C] }, b: { "/1": [A] } }); // not mutated
  });
});
