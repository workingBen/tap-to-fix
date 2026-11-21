import { domToCanvas } from "modern-screenshot";
import { PIN_BODY_CX, PIN_BODY_CY, PIN_FLIP_MARGIN, pinPath, type Dir } from "./pin-shape";
import { shrinkToFit, targetSize } from "./locate";

const MAX_BYTES = 1_000_000;
const PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8d+/ePQAGsAK/Bc1m1QAAAABJRU5ErkJggg==";

// Crops by capturing only a viewport-sized window: width/height = viewport and the
// cloned root is shifted by the scroll offset, so only the viewport is painted. (The
// library still clones the whole document and fetches its images to inline them.)
// Scale follows the screen's pixel density, so a 390 px phone at 3x gives ~1170 px,
// capped so the image is never wider than 1200 px.
async function captureViewport(exclude: Element): Promise<HTMLCanvasElement> {
  return domToCanvas(document.documentElement, {
    width: window.innerWidth,
    height: window.innerHeight,
    style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
    filter: (n) => n !== exclude,
    fetch: { placeholderImage: PLACEHOLDER },
    timeout: 8000,
    scale: Math.min(window.devicePixelRatio || 1, 1200 / window.innerWidth),
  });
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
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 10_000);
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
