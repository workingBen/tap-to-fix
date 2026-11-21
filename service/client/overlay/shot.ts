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

function drawPin(canvas: HTMLCanvasElement, pin: { x: number; y: number; n: number }, scale: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const r = 15 * scale;
  ctx.beginPath();
  ctx.arc(pin.x * scale, pin.y * scale, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1F2A24";
  ctx.fill();
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = "#FBF8F2";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${14 * scale}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(pin.n), pin.x * scale, pin.y * scale + scale);
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
