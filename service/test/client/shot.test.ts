// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const canvas = { width: 100, height: 100, getContext: () => null, toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"])) };
const context: { timeout: number; [k: string]: unknown } = { timeout: 0 };
let timeoutAtCapture = -1;

vi.mock("modern-screenshot", () => ({
  createContext: vi.fn(async () => context),
  domToCanvas: vi.fn(async (ctx: { timeout: number }) => {
    timeoutAtCapture = ctx.timeout;
    return canvas;
  }),
  loadMedia: vi.fn(async () => undefined),
}));

import { createContext, domToCanvas, loadMedia } from "modern-screenshot";
import { skipForShot, takeScreenshot } from "../../client/overlay/shot";

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  context.timeout = 0;
  timeoutAtCapture = -1;
});

describe("skipForShot", () => {
  it("skips an element starting well below the viewport", () => {
    expect(skipForShot({ top: 900, bottom: 1000 }, "static", 750)).toBe(true);
  });
  it("keeps an element inside the 50 px margin", () => {
    expect(skipForShot({ top: 790, bottom: 900 }, "static", 750)).toBe(false);
  });
  it("keeps fixed and sticky elements", () => {
    expect(skipForShot({ top: 900, bottom: 1000 }, "fixed", 750)).toBe(false);
    expect(skipForShot({ top: 900, bottom: 1000 }, "sticky", 750)).toBe(false);
  });
  it("keeps an element above the viewport, since removing it would shift the layout", () => {
    expect(skipForShot({ top: -500, bottom: -100 }, "static", 750)).toBe(false);
  });
});

describe("takeScreenshot", () => {
  it("creates the context with a 1 ms timeout, then raises it to 8 s before capturing", async () => {
    const exclude = document.createElement("div");
    document.body.append(exclude);
    await takeScreenshot({ x: 1, y: 1, n: 1 }, exclude);
    expect(createContext).toHaveBeenCalledTimes(1);
    const options = vi.mocked(createContext).mock.calls[0][1] as { timeout: number; filter: (n: Node) => boolean };
    expect(options.timeout).toBe(1);
    expect(domToCanvas).toHaveBeenCalledWith(context);
    expect(timeoutAtCapture).toBe(8000);
    expect(options.filter(exclude)).toBe(false);
    expect(options.filter(document.createElement("p"))).toBe(true);
  });

  it("waits only for incomplete images that intersect the viewport, 3 s each", async () => {
    const mk = (top: number, complete: boolean) => {
      const img = document.createElement("img");
      Object.defineProperty(img, "complete", { value: complete });
      img.getBoundingClientRect = () => ({ top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON() {} });
      document.body.append(img);
      return img;
    };
    const loading = mk(10, false);
    mk(20, true); // already loaded
    mk(5000, false); // far below the fold
    await takeScreenshot({ x: 1, y: 1, n: 1 }, document.createElement("div"));
    expect(loadMedia).toHaveBeenCalledTimes(1);
    expect(loadMedia).toHaveBeenCalledWith(loading, { timeout: 3000 });
  });
});
