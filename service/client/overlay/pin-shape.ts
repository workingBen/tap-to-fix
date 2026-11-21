/** The pin's geometry, shared by the on-page pin and the one drawn onto the screenshot.
 *  Origin (0,0) is the tap spot. The round body (r 15) sits 12px above it, 10px to the right
 *  (left when flipped), joined to the point by a short tapered tail. */
export const PIN_R = 15;
export const PIN_BODY_CX = 10;
export const PIN_BODY_CY = -27;
/** Space the pin needs to its right (hit area edge) before it flips to the left. */
export const PIN_FLIP_MARGIN = 32;

export type Dir = 1 | -1;

/** One closed, non-self-overlapping outline: the point, up the tail's edge, round the body, back down. */
export function pinPath(dir: Dir): string {
  const r = PIN_R;
  const dy = -12.86; // where the tail meets the body (5px either side of its bottom)
  const a = dir * 15;
  const b = dir * 5;
  return `M0 0L${a} ${dy}A${r} ${r} 0 1 ${dir === 1 ? 0 : 1} ${b} ${dy}Z`;
}
