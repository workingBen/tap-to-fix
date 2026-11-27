/** Which edge of the viewport a site's own fixed or sticky bar runs along. */
export type Edge = "top" | "bottom";

/** How far in from the edge the bar is looked for. */
const EDGE_PROBE_PX = 4;

/**
 * The site's fixed or sticky bar along one edge of the viewport (a sticky header at the top, a
 * cookie banner at the bottom), or null. Looks at the point 4 px in from that edge, at the
 * middle of the width, and walks up from each element there to the first fixed or sticky one
 * that is visible and has a size. Full-screen fixed backdrops cover both halves of the viewport,
 * so they are not a bar: a bottom bar must start in the lower half, a top bar end in the upper.
 */
export function edgeBar(doc: Document, win: Window, exclude: Element, edge: Edge): { el: Element; rect: DOMRect } | null {
  const half = win.innerHeight * 0.5;
  const x = win.innerWidth / 2;
  const y = edge === "top" ? EDGE_PROBE_PX : win.innerHeight - EDGE_PROBE_PX;
  for (const hit of doc.elementsFromPoint(x, y)) {
    if (hit === exclude || exclude.contains(hit)) continue;
    for (let n: Element | null = hit; n; n = n.parentElement) {
      const cs = win.getComputedStyle(n);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const r = n.getBoundingClientRect();
      const visible = cs.visibility !== "hidden" && cs.opacity !== "0" && r.width > 0 && r.height > 0;
      if (visible && (edge === "top" ? r.bottom < half : r.top > half)) return { el: n, rect: r };
    }
  }
  return null;
}
