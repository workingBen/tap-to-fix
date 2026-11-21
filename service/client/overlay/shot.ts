import { domToCanvas } from "modern-screenshot";
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

/** Teardrop path: sharp corner at (0,0), body toward (dir*s, -s), other corners round. */
function teardrop(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dir: 1 | -1): void {
  const r = s / 2;
  const px = (v: number) => x + dir * v;
  ctx.moveTo(px(0), y);
  ctx.lineTo(px(0), y - r);
  ctx.arcTo(px(0), y - s, px(r), y - s, r);
  ctx.arcTo(px(s), y - s, px(s), y - r, r);
  ctx.arcTo(px(s), y, px(r), y, r);
  ctx.closePath();
}

/** Same pin as the on-page one: its point at (pin.x, pin.y), body up and to the right (left near the right edge). */
function drawPin(canvas: HTMLCanvasElement, pin: { x: number; y: number; n: number }, scale: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dir: 1 | -1 = pin.x + 44 > window.innerWidth ? -1 : 1;
  const x = pin.x * scale;
  const y = pin.y * scale;
  const s = 30 * scale;
  const ring = 3 * scale;
  ctx.save();
  // 3px ring, opaque, on the outside edge.
  ctx.beginPath();
  teardrop(ctx, x, y, s, dir);
  teardrop(ctx, x + dir * ring, y - ring, s - 2 * ring, dir);
  ctx.fillStyle = "#FBF8F2";
  ctx.fill("evenodd");
  // Body at 85% so words beside the point stay readable.
  ctx.beginPath();
  teardrop(ctx, x + dir * ring, y - ring, s - 2 * ring, dir);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#1F2A24";
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${17 * scale}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(pin.n), x + dir * (s / 2), y - s / 2 + scale);
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
