// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { edgeBar } from "../../client/overlay/edges";
import { OverlayUI } from "../../client/overlay/ui";

const rect = (l: number, t: number, w: number, h: number) =>
  ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect;

/** An element with an inline style and a fixed box, and the point probe hitting `hits`. */
function box(html: string, r: DOMRect): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  const el = t.content.firstElementChild as HTMLElement;
  document.body.append(el);
  el.getBoundingClientRect = () => r;
  return el;
}
const probe = (byY: (y: number) => Element[]) => {
  document.elementsFromPoint = (_x: number, y: number) => byY(y);
};

const host = () => document.createElement("tap-to-fix-overlay");
const H = () => window.innerHeight;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("edgeBar", () => {
  it("finds a sticky header along the top edge from a child under the probe", () => {
    const header = box(`<header style="position: sticky; top: 0"><a href="/">Logo</a></header>`, rect(0, 0, 390, 64));
    const link = header.querySelector("a")!;
    probe((y) => (y < 10 ? [link, header, document.body, document.documentElement] : []));
    const bar = edgeBar(document, window, host(), "top");
    expect(bar?.el).toBe(header);
    expect(bar?.rect.bottom).toBe(64);
  });
  it("finds a fixed banner along the bottom edge, and only for the bottom", () => {
    const banner = box(`<div style="position: fixed; bottom: 0">Cookies</div>`, rect(0, H() - 80, 390, 80));
    probe((y) => (y > H() - 10 ? [banner] : []));
    expect(edgeBar(document, window, host(), "bottom")?.el).toBe(banner);
    expect(edgeBar(document, window, host(), "top")).toBeNull();
  });
  it("skips a full-screen fixed backdrop at either edge", () => {
    const backdrop = box(`<div style="position: fixed; inset: 0"></div>`, rect(0, 0, 390, H()));
    probe(() => [backdrop]);
    expect(edgeBar(document, window, host(), "top")).toBeNull();
    expect(edgeBar(document, window, host(), "bottom")).toBeNull();
  });
  it("skips hidden, see-through and empty bars", () => {
    const hidden = box(`<div style="position: fixed; visibility: hidden"></div>`, rect(0, 0, 390, 60));
    const clear = box(`<div style="position: fixed; opacity: 0"></div>`, rect(0, 0, 390, 60));
    const empty = box(`<div style="position: fixed"></div>`, rect(0, 0, 0, 0));
    probe(() => [hidden, clear, empty]);
    expect(edgeBar(document, window, host(), "top")).toBeNull();
  });
  it("gives null for ordinary page content, and never picks the overlay", () => {
    const p = box(`<p>Just text</p>`, rect(0, 0, 390, 20));
    const overlay = box(`<tap-to-fix-overlay style="position: fixed"></tap-to-fix-overlay>`, rect(0, 0, 390, 60));
    probe(() => [overlay, p, document.body]);
    expect(edgeBar(document, window, overlay, "top")).toBeNull();
  });
});

describe("OverlayUI top clip", () => {
  const layer = (ui: OverlayUI, name: string) => ui.host.shadowRoot!.querySelector(`[data-ttf=${name}]`) as HTMLElement;
  it("clips the pins layer at the header's bottom edge, measured from the layer's own top", () => {
    const ui = new OverlayUI(document, "https://example.test/r");
    const pins = layer(ui, "pins");
    pins.getBoundingClientRect = () => rect(0, -500, 0, 0); // the page is scrolled 500 px
    ui.clipTop(64, document.body);
    expect(pins.style.clipPath).toBe("inset(564px -100000px -100000px -100000px)");
    ui.clipTop(null, null);
    expect(pins.style.clipPath).toBe("");
  });
  it("puts pins on the bar itself in a layer that is never clipped", () => {
    const ui = new OverlayUI(document, "https://example.test/r");
    ui.setPins([
      { n: 1, x: 40, y: 30, onBar: true },
      { n: 2, x: 40, y: 300 },
      { n: 3, x: 80, y: 30, draft: true, onBar: true },
    ]);
    ui.clipTop(64, document.body);
    expect(layer(ui, "pins").querySelectorAll("[data-ttf=pin]")).toHaveLength(1);
    expect(layer(ui, "bar-pins").querySelectorAll("[data-ttf=pin]")).toHaveLength(2);
    expect(layer(ui, "bar-pins").style.clipPath).toBe("");
  });
  it("clips the hover ring under the header, but not a ring around the header's own content", () => {
    const ui = new OverlayUI(document, "https://example.test/r");
    const ring = layer(ui, "ring");
    const header = box(`<header><a href="/">Logo</a></header>`, rect(0, 0, 390, 64));
    const under = box(`<p>Under the header</p>`, rect(0, 40, 390, 100));
    ui.clipTop(64, header);
    ui.moveCursor(10, 100, under);
    expect(ring.style.clipPath).toBe("inset(27px 0 0 0)"); // ring top is 3 px above the element
    ui.moveCursor(10, 20, header.querySelector("a")!);
    expect(ring.style.clipPath).toBe("");
    ui.moveCursor(10, 200, box(`<p>Well below</p>`, rect(0, 200, 390, 40)));
    expect(ring.style.clipPath).toBe("");
  });
});
