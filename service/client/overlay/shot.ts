import { createContext, domToCanvas, loadMedia } from "modern-screenshot";
import { PIN_BODY_CX, PIN_BODY_CY, PIN_FLIP_MARGIN, pinPath, type Dir } from "./pin-shape";
import { frameDocs, shrinkToFit, targetSize, topRect } from "./locate";

const MAX_BYTES = 1_000_000;
const PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8d+/ePQAGsAK/Bc1m1QAAAABJRU5ErkJggg==";

/** Elements starting more than this far below the viewport are left out of the capture. */
const SKIP_MARGIN_PX = 50;
/** How long to wait for one on-screen image that is still loading. */
const IMG_WAIT_MS = 3000;
/** Time the library's fetches and SVG-to-canvas step get once the wait is over. */
const CAPTURE_TIMEOUT_MS = 8000;
/** Last-resort cap on a capture. Save has its own, shorter wait (SHOT_WAIT_MS in index.ts). */
const SHOT_BACKSTOP_MS = 60_000;

/** True for an element that starts below the fold and cannot appear in the viewport crop.
 *  Fixed and sticky elements stay (they can be on screen anyway); anything above the
 *  viewport stays too, because removing it would shift the layout. */
export function skipForShot(rect: { top: number; bottom: number }, position: string, viewportH: number): boolean {
  if (position === "fixed" || position === "sticky") return false;
  return rect.top > viewportH + SKIP_MARGIN_PX;
}

// Waits for the images the reviewer can see, each at most IMG_WAIT_MS. A lazy image
// below the fold would otherwise hold the whole capture up to the library's timeout.
// Images inside same-origin frames count too, measured where they sit on this page.
async function waitForVisibleImages(): Promise<void> {
  const imgs = [document, ...frameDocs(document)].flatMap((d) => Array.from(d.querySelectorAll("img")));
  const pending = imgs.filter((img) => {
    if (img.complete) return false;
    const r = topRect(img, document);
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  });
  await Promise.all(pending.map((img) => loadMedia(img, { timeout: IMG_WAIT_MS }).catch(() => undefined)));
}

// Same-origin frames: the library clones a frame's own page in place of the <iframe> (its
// cloneIframe), so their content is in the capture. A frame it cannot read (cross-origin)
// comes out as an empty box; the capture still finishes. Nodes inside a frame belong to the
// frame's window, so the filter checks nodeType rather than instanceof, and measures them on
// this page (topRect) with the frame's own getComputedStyle.
//
// Crops by capturing only a viewport-sized window: width/height = viewport and the
// cloned root is shifted by the scroll offset, so only the viewport is painted.
// Scale follows the screen's pixel density, so a 390 px phone at 3x gives ~1170 px,
// capped so the image is never wider than 1200 px.
async function captureViewport(exclude: Element): Promise<HTMLCanvasElement> {
  await waitForVisibleImages();
  // The context starts with a 1 ms timeout so the library's own wait for every image in
  // the document is nearly free; it is raised before drawing so fetches still get 8 s.
  const ctx = await createContext(document.documentElement, {
    width: window.innerWidth,
    height: window.innerHeight,
    style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
    // Skipping below-the-fold nodes keeps the library from fetching what is never painted.
    // Trade-off: removing nodes below the fold can shift visible layout when visible content
    // depends on what follows it (flex space-between/end, margin-top:auto, centered min-height
    // containers). Accepted: it keeps the capture under the Save deadline on long pages.
    filter: (n) => {
      if (n === exclude) return false;
      if (n.nodeType !== 1) return true;
      const el = n as Element;
      const view = el.ownerDocument.defaultView ?? window;
      const r = topRect(el, document);
      return !skipForShot(r, view.getComputedStyle(el).position, window.innerHeight);
    },
    fetch: { placeholderImage: PLACEHOLDER },
    timeout: 1,
    scale: Math.min(window.devicePixelRatio || 1, 1200 / window.innerWidth),
  });
  ctx.timeout = CAPTURE_TIMEOUT_MS;
  return domToCanvas(ctx);
}

/** Same pin as the on-page one (see pin-shape.ts): point at (pin.x, pin.y), body up and to the right,
 *  left near the right edge. A draft pin is the accent color, as the reviewer saw it. */
function drawPin(canvas: HTMLCanvasElement, pin: { x: number; y: number; n: number }, scale: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dir: Dir = pin.x + PIN_FLIP_MARGIN > window.innerWidth ? -1 : 1;
  const body = new Path2D(pinPath(dir));
  ctx.save();
  ctx.translate(pin.x * scale, pin.y * scale);
  ctx.scale(scale, scale);
  // See-through ring: stroke outside the body only, so it is a 3px edge and never tints the fill.
  ctx.save();
  const cut = new Path2D();
  cut.rect(-80, -90, 160, 120);
  cut.addPath(body);
  ctx.clip(cut, "evenodd");
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = "#FBF8F2";
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.stroke(body);
  ctx.restore();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#2F6B4F";
  ctx.fill(body);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "bold 17px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(pin.n), dir * PIN_BODY_CX, PIN_BODY_CY + 1);
  ctx.restore();
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function takeScreenshot(
  pin: { x: number; y: number; n: number },
  exclude: Element,
): Promise<Blob | null> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A backstop only: the capture may keep working while the reviewer types.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SHOT_BACKSTOP_MS);
    });
    const canvas = await Promise.race([captureViewport(exclude), timeout]);
    clearTimeout(timer);
    if (!canvas) return null;
    // Pin is in viewport coordinates (the capture is already cropped to the viewport).
    const ratio = canvas.width / window.innerWidth || 1;
    drawPin(canvas, pin, ratio);
    const size = targetSize(canvas.width, canvas.height);
    let type = "image/webp";
    return await shrinkToFit(async (scale, quality) => {
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(size.w * scale));
      out.height = Math.max(1, Math.round(size.h * scale));
      out.getContext("2d")?.drawImage(canvas, 0, 0, out.width, out.height);
      let blob = await toBlob(out, type, quality);
      if (blob && blob.type !== "image/webp" && type === "image/webp") {
        type = "image/jpeg";
        blob = await toBlob(out, type, quality);
      }
      return blob;
    }, MAX_BYTES);
  } catch {
    return null;
  }
}
