// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSelector,
  deepElementFromPoint,
  describeElement,
  findPin,
  frameOffset,
  framedSelector,
  locatorFor,
  resolveSelector,
  shrinkToFit,
  targetSize,
  toTopPoint,
  topRect,
} from "../../client/overlay/locate";

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

/**
 * An <iframe srcdoc> on this page, placed at (left, top) with a border. happy-dom loads srcdoc
 * frames but leaves the frame window's frameElement unset, so the test sets it, as a browser does.
 */
function frame(html: string, at: { left: number; top: number; border?: number }, parent: Document = document): HTMLIFrameElement {
  const f = parent.createElement("iframe");
  f.setAttribute("srcdoc", html);
  parent.body.append(f);
  const b = at.border ?? 0;
  f.getBoundingClientRect = () => rect(at.left, at.top, 600, 400);
  Object.defineProperty(f, "clientLeft", { value: b });
  Object.defineProperty(f, "clientTop", { value: b });
  Object.defineProperty(f.contentDocument!.defaultView!, "frameElement", { value: f, configurable: true });
  return f;
}

describe("frames", () => {
  it("offsets a frame's viewport by the frame's box and border", () => {
    const f = frame(`<p>inside</p>`, { left: 20, top: 300, border: 2 });
    const d = f.contentDocument!;
    expect(frameOffset(d, document)).toEqual({ x: 22, y: 302 });
    expect(frameOffset(document, document)).toEqual({ x: 0, y: 0 });
    expect(toTopPoint(d, document, 10, 5)).toEqual({ x: 32, y: 307 });
  });
  it("adds up nested frames", () => {
    const outer = frame(`<div></div>`, { left: 10, top: 100 });
    const inner = frame(`<p>deep</p>`, { left: 5, top: 50, border: 1 }, outer.contentDocument!);
    expect(frameOffset(inner.contentDocument!, document)).toEqual({ x: 16, y: 151 });
  });
  it("measures an element inside a frame on the top page", () => {
    const f = frame(`<p>inside</p>`, { left: 20, top: 300 });
    const p = f.contentDocument!.querySelector("p")!;
    p.getBoundingClientRect = () => rect(8, 40, 200, 30);
    expect(topRect(p, document)).toMatchObject({ left: 28, top: 340, right: 228, bottom: 370, width: 200, height: 30 });
  });
  it("chains the frame's selector and the selector inside it with >>>", () => {
    document.body.innerHTML = `<main><p>before</p></main>`;
    const f = frame(`<article><p>one</p><p>two</p></article>`, { left: 0, top: 0 });
    const p = f.contentDocument!.querySelectorAll("p")[1]!;
    const sel = framedSelector(p, document);
    expect(sel).toBe("body > iframe:nth-of-type(1) >>> body > article:nth-of-type(1) > p:nth-of-type(2)");
    expect(resolveSelector(document, sel)).toBe(p);
  });
  it("chains nested frames and resolves them back", () => {
    const outer = frame(`<div id="wrap"></div>`, { left: 0, top: 0 });
    outer.id = "story";
    const inner = frame(`<h2 id="t">Deep</h2>`, { left: 0, top: 0 }, outer.contentDocument!);
    const h = inner.contentDocument!.getElementById("t")!;
    const sel = framedSelector(h, document);
    expect(sel).toBe("#story >>> body > iframe:nth-of-type(1) >>> #t");
    expect(resolveSelector(document, sel)).toBe(h);
  });
  it("leaves selectors on the top page as they were", () => {
    document.body.innerHTML = `<p id="a">x</p>`;
    const p = document.getElementById("a")!;
    expect(framedSelector(p, document)).toBe("#a");
    expect(resolveSelector(document, "#a")).toBe(p);
  });
  it("gives null for a frame path that no longer resolves, or a bad selector", () => {
    document.body.innerHTML = `<div id="notframe"></div>`;
    expect(resolveSelector(document, "#notframe >>> p")).toBeNull();
    expect(resolveSelector(document, "#gone >>> p")).toBeNull();
    expect(resolveSelector(document, "p[")).toBeNull();
  });
  it("records a tap inside a frame in top-page coordinates", () => {
    const f = frame(`<p>Inside the article</p>`, { left: 20, top: 300 });
    const p = f.contentDocument!.querySelector("p")!;
    p.getBoundingClientRect = () => rect(0, 100, 200, 50);
    // The tap is at (70, 425) on the top page: (50, 125) in the frame, a quarter across, half down.
    const l = locatorFor(p, 70, 425, document);
    expect(l.selector).toContain(" >>> ");
    expect(resolveSelector(document, l.selector)).toBe(p);
    expect(l.element_x).toBeCloseTo(0.25);
    expect(l.element_y).toBeCloseTo(0.5);
    expect(l.page_x).toBe(70 + window.scrollX);
    expect(l.page_y).toBe(425 + window.scrollY);
    expect(l.element_text).toBe("Inside the article");
  });
  it("finds a pin through a frame selector, in top-page coordinates", () => {
    const f = frame(`<p id="a">Hello there</p>`, { left: 20, top: 300 });
    f.id = "story";
    f.contentDocument!.getElementById("a")!.getBoundingClientRect = () => rect(10, 20, 100, 40);
    const r = findPin(document, {
      selector: "#story >>> #a",
      element_text: "Hello there",
      element_x: 0.5,
      element_y: 0.5,
      page_x: 1,
      page_y: 1,
    });
    expect(r).toEqual({ x: 80 + window.scrollX, y: 340 + window.scrollY, moved: false });
  });
  it("falls back to a text search inside frames", () => {
    const f = frame(`<p>Other</p><p id="b">Only in the frame</p>`, { left: 0, top: 500 });
    f.contentDocument!.getElementById("b")!.getBoundingClientRect = () => rect(0, 10, 100, 20);
    const r = findPin(document, {
      selector: "#gone",
      element_text: "Only in the frame",
      element_x: 0,
      element_y: 0,
      page_x: 1,
      page_y: 1,
    });
    expect(r).toEqual({ x: window.scrollX, y: 510 + window.scrollY, moved: false });
  });
  it("finds the element under a point inside a frame", () => {
    const f = frame(`<p>inside</p>`, { left: 20, top: 300 });
    const d = f.contentDocument!;
    const p = d.querySelector("p")!;
    document.elementFromPoint = (x, y) => (x === 50 && y === 310 ? f : null);
    d.elementFromPoint = (x, y) => (x === 30 && y === 10 ? p : null);
    expect(deepElementFromPoint(document, 50, 310)).toBe(p);
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
