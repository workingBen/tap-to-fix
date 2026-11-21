// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { buildSelector, describeElement, findPin, locatorFor, shrinkToFit, targetSize } from "../../client/overlay/locate";

const rect = (l: number, t: number, w: number, h: number) =>
  ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("buildSelector", () => {
  it("uses a unique id", () => {
    document.body.innerHTML = `<div><p id="intro">a</p></div>`;
    const el = document.getElementById("intro")!;
    expect(buildSelector(el)).toBe("#intro");
  });
  it("falls back to a path for duplicate ids", () => {
    document.body.innerHTML = `<div><p id="x">a</p><p id="x">b</p></div>`;
    const el = document.querySelectorAll("p")[1]!;
    const sel = buildSelector(el);
    expect(sel).not.toBe("#x");
    expect(document.querySelector(sel)).toBe(el);
  });
  it("skips auto-generated looking ids", () => {
    document.body.innerHTML = `<div id="ember1234"><span>a</span></div>`;
    const el = document.querySelector("span")!;
    const sel = buildSelector(el);
    expect(sel).not.toContain("ember1234");
    expect(document.querySelector(sel)).toBe(el);
  });
  it("resolves three sibling paragraphs to themselves", () => {
    document.body.innerHTML = `<main><p>1</p><p>2</p><p>3</p></main>`;
    for (const p of Array.from(document.querySelectorAll("p"))) {
      expect(document.querySelector(buildSelector(p))).toBe(p);
    }
  });
  it("starts from a usable id ancestor", () => {
    document.body.innerHTML = `<section id="hero"><div><p>a</p></div></section>`;
    const p = document.querySelector("p")!;
    expect(buildSelector(p).startsWith("#hero")).toBe(true);
    expect(document.querySelector(buildSelector(p))).toBe(p);
  });
});

describe("describeElement", () => {
  it("describes headings, links and images", () => {
    document.body.innerHTML = `<h2>Find your calm</h2><a href="#">Go</a><img alt="A lake" src="x.png">`;
    expect(describeElement(document.querySelector("h2")!)).toBe("the heading “Find your calm”");
    expect(describeElement(document.querySelector("a")!)).toBe("the link “Go”");
    expect(describeElement(document.querySelector("img")!)).toBe("the image “A lake”");
  });
  it("cuts long text with an ellipsis and falls back to this spot", () => {
    document.body.innerHTML = `<p>${"word ".repeat(30)}</p><div>x</div>`;
    const d = describeElement(document.querySelector("p")!);
    expect(d.startsWith("the paragraph “")).toBe(true);
    expect(d.endsWith("…”")).toBe(true);
    expect(describeElement(document.querySelector("div")!)).toBe("this spot");
  });
});

describe("locatorFor", () => {
  it("clamps fractions and collapses text", () => {
    document.body.innerHTML = `<p>  hello \n   world </p>`;
    const p = document.querySelector("p")!;
    p.getBoundingClientRect = () => rect(100, 100, 200, 50);
    const l = locatorFor(p, 150, 500);
    expect(l.element_text).toBe("hello world");
    expect(l.element_x).toBeCloseTo(0.25);
    expect(l.element_y).toBe(1);
    expect(locatorFor(p, 0, 0).element_x).toBe(0);
    expect(l.page_x).toBe(150 + window.scrollX);
    expect(document.querySelector(l.selector)).toBe(p);
  });
});

describe("findPin", () => {
  const base = { selector: null, element_text: null, element_x: null, element_y: null, page_x: null, page_y: null };
  it("finds by selector", () => {
    document.body.innerHTML = `<p id="a">Hello there</p>`;
    document.getElementById("a")!.getBoundingClientRect = () => rect(10, 20, 100, 40);
    const r = findPin(document, { ...base, selector: "#a", element_text: "Hello there", element_x: 0.5, element_y: 0.5 });
    expect(r).toEqual({ x: 60 + window.scrollX, y: 40 + window.scrollY, moved: false });
  });
  it("falls back to a text search when the selector points elsewhere", () => {
    document.body.innerHTML = `<p id="a">Different</p><p id="b">Hello there</p>`;
    document.getElementById("b")!.getBoundingClientRect = () => rect(0, 100, 100, 100);
    const r = findPin(document, { ...base, selector: "#a", element_text: "Hello there", element_x: 0, element_y: 0 });
    expect(r).toEqual({ x: window.scrollX, y: 100 + window.scrollY, moved: false });
  });
  it("uses page coordinates, flagged moved, when nothing matches", () => {
    document.body.innerHTML = `<p>Other</p>`;
    expect(findPin(document, { ...base, selector: "#gone", element_text: "Missing", page_x: 5, page_y: 9 })).toEqual({
      x: 5,
      y: 9,
      moved: true,
    });
  });
  it("returns null with nothing to go on", () => {
    expect(findPin(document, base)).toBeNull();
  });
});

describe("shrinkToFit", () => {
  const blob = (n: number) => new Blob([new Uint8Array(n)]);
  it("returns the first blob that fits", async () => {
    const calls: [number, number][] = [];
    const r = await shrinkToFit(async (s, q) => (calls.push([s, q]), blob(q > 0.8 ? 500 : 100)), 1000);
    expect(r?.size).toBe(500);
    expect(calls).toEqual([[1, 0.85]]);
  });
  it("tries a smaller scale when scale 1 is always too big", async () => {
    const r = await shrinkToFit(async (s) => blob(s === 1 ? 5000 : 100), 1000);
    expect(r?.size).toBe(100);
  });
  it("returns null when nothing fits or encode throws", async () => {
    expect(await shrinkToFit(async () => blob(5000), 1000)).toBeNull();
    expect(
      await shrinkToFit(async () => {
        throw new Error("x");
      }, 1000),
    ).toBeNull();
  });
});

describe("targetSize", () => {
  it("scales down wide images only", () => {
    expect(targetSize(2400, 1600)).toEqual({ w: 1200, h: 800 });
    expect(targetSize(390, 844)).toEqual({ w: 390, h: 844 });
  });
});
