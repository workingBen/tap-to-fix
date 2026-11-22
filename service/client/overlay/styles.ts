import { PAPER_CSS } from "../paper";

// Everything lives in a shadow root. The host page's rules still reach the host element
// itself (and inherit through it), so `:host` resets with !important — inside-the-shadow
// !important beats the page's !important — and every visible element sets its own font size,
// color and family instead of inheriting them.
export const OVERLAY_CSS =
  PAPER_CSS +
  `
:host { all: initial !important; }
* { box-sizing: border-box; margin: 0; }
.root, .root * {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", system-ui, sans-serif;
  font-size: 17px; line-height: 1.4; color: var(--ink);
  -webkit-font-smoothing: antialiased; letter-spacing: normal; text-transform: none;
}
svg { flex: none; }

/* floating review pill, bottom center */
.bar {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: var(--lift, calc(18px + env(safe-area-inset-bottom)));
  z-index: 2147483647; width: max-content; max-width: calc(100vw - 16px); min-height: 52px; padding: 4px 6px 4px 16px;
  display: flex; align-items: center; gap: 6px;
  background: var(--surf); border: 1px solid var(--line); border-radius: 28px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .28);
}
.bar[hidden] { display: none; }
.root.sheet-open .bar { visibility: hidden; }
.bar .msg { color: var(--mut); display: inline-flex; align-items: center; gap: 8px; }
.bar .count { white-space: nowrap; padding-right: 6px; }
.bar b { color: var(--ink); font-weight: 600; }
.bar a {
  min-height: 44px; padding: 0 12px; flex: none;
  display: inline-flex; align-items: center;
  color: var(--acc); font-weight: 700; text-decoration: none;
}
.bar a:focus-visible, .sheet button:focus-visible, .pin:focus-visible { outline: 3px solid var(--acc); outline-offset: 2px; }
.bar .msg svg { color: var(--warn); }
.bar .seg { display: inline-flex; flex: none; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
.root .bar .seg button {
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 0; border-radius: 999px;
  background: transparent; color: var(--mut); font-weight: 600; white-space: nowrap; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.root .bar .seg button * { color: inherit; }
.root .bar .seg button.on { background: var(--acc); color: #fff; }
.bar .seg button:focus-visible { outline: 3px solid var(--acc); outline-offset: 2px; }
.bar .vr { width: 1px; align-self: stretch; background: var(--line); margin: 6px 2px; flex: none; }
/* "Saved" floats just above the pill, so it never widens it. */
.root .bar .saved {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 8px);
  white-space: nowrap; color: var(--acc); font-weight: 600; display: inline-flex; align-items: center; gap: 6px;
}
.root .bar .saved:empty { display: none; }
.bar .saved svg { color: var(--acc); }
@media (max-width: 599px) {
  .bar .count { display: none; }
  /* 375px phones: nothing to the left of the switch, and tighter padding, so Done stays inside the pill. */
  .bar { padding-left: 6px; gap: 2px; }
  .root .bar .seg button { padding: 0 10px; gap: 4px; }
  .bar a { padding: 0 8px; }
  .bar .vr { margin: 6px 0; }
  .bar .msg { padding-left: 10px; }
}

/* Comment-mode cursor and hover ring (fine pointers only; the arrow is hidden by a page style while they show) */
/* The box is the dot's, centered on the pointer by the margin; the parts hang off it. */
.cur { position: fixed; left: 0; top: 0; width: 14px; height: 14px; margin: -7px 0 0 -7px; z-index: 2147483647; pointer-events: none; will-change: transform; }
.cur[hidden], .hover-ring[hidden], .root[data-mode="use"] .cur, .root[data-mode="use"] .hover-ring, .root.sheet-open .cur, .root.sheet-open .hover-ring { display: none; }
.cur .ripple { position: absolute; left: -3px; top: -3px; width: 20px; height: 20px; border-radius: 50%; border: 3px solid #7FD3A8; animation: ttf-ripple 1.4s ease-out infinite; }
.cur .ripple.r2 { animation-delay: .7s; }
.cur .cdot {
  position: absolute; left: 0; top: 0; width: 14px; height: 14px; border-radius: 50%;
  background: #fff; border: 3px solid var(--acc); box-shadow: 0 0 12px 3px rgba(127, 211, 168, .9);
  animation: ttf-glow 1.6s ease-in-out infinite;
}
.root .cur .ctag {
  position: absolute; left: 25px; top: 21px; background: var(--acc); color: #fff; font-weight: 700; font-size: 15px;
  padding: 4px 10px; border-radius: 999px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0, 0, 0, .3);
}
.hover-ring { position: fixed; left: 0; top: 0; z-index: 2147483645; border: 2px dashed #7FD3A8; border-radius: 6px; pointer-events: none; }
@keyframes ttf-ripple { 0% { transform: scale(.6); opacity: 1; } 100% { transform: scale(2.6); opacity: 0; } }
@keyframes ttf-glow { 0%, 100% { filter: drop-shadow(0 0 4px rgba(127, 211, 168, .7)); } 50% { filter: drop-shadow(0 0 10px rgba(127, 211, 168, 1)) drop-shadow(0 0 20px rgba(127, 211, 168, .6)); } }
@media (prefers-reduced-motion: reduce) {
  .cur .ripple, .cur .cdot { animation: none; }
  .cur .ripple { transform: scale(1.6); opacity: .8; }
  .cur .ripple.r2 { display: none; }
}

/* Text zoom on a 375px phone leaves under 360 CSS px: drop the icons, keep the text size. */
@media (max-width: 359px) {
  .bar { padding-right: 2px; }
  .bar .seg { padding: 2px; }
  .root .bar .seg button { padding: 0 8px; }
  .root .bar .seg button svg { display: none; }
  .bar a { padding: 0 6px; }
}

/* pins: a zero-size layer in document coordinates */
.pins { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none; }
.pin {
  position: absolute; width: 44px; height: 44px; padding: 0; border: 0; background: transparent;
  cursor: pointer; pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
/* A map pin: the button is the 44px hit area around the round body; the tail's point (the 1px svg
   origin) is the tap spot, 12px below the body. Flipped near the right edge, the body leans left. */
.root .pin svg {
  position: absolute; left: 12px; top: 49px; width: 1px; height: 1px; overflow: visible; pointer-events: none;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .22));
}
.root .pin.flip svg { left: 32px; }
.root .pin .body { fill: color-mix(in srgb, var(--ink) 80%, transparent); }
.root .pin.settled .body, .root .pin.new .body { fill: color-mix(in srgb, var(--acc) 80%, transparent); }
.root .pin .ring { fill: none; stroke: color-mix(in srgb, var(--bg) 70%, transparent); stroke-width: 6; stroke-linejoin: round; }
.root .pin .mv { display: none; fill: none; stroke: var(--ink); stroke-width: 2; stroke-dasharray: 4 3; }
.root .pin.moved .mv { display: block; }
.root .pin .dot {
  position: absolute; left: 7px; top: 7px; width: 30px; height: 30px;
  display: grid; place-items: center;
  font-weight: 700; font-size: 17px; line-height: 1; color: #fff;
}
/* The read sheet's badge keeps the plain round number. */
.root .badge .dot {
  width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
  font-weight: 700; font-size: 17px; line-height: 1; background: var(--ink); color: #fff;
  box-shadow: 0 0 0 3px var(--bg), 0 4px 10px rgba(0, 0, 0, .25);
}
.root .badge.settled .dot { background: var(--acc); }
.root .badge.moved .dot { outline: 2px dashed var(--ink); outline-offset: 4px; }
.pin.new { pointer-events: none; }
.root .pin.new svg { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--acc) 55%, transparent)); }

/* bottom sheet */
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
  max-width: 600px; margin: 0 auto; max-height: 85vh; overflow-y: auto;
  background: var(--surf); border: 1px solid var(--line); border-bottom: 0;
  border-radius: 22px 22px 0 0; padding: 10px 18px 22px;
  box-shadow: 0 -10px 30px rgba(0, 0, 0, .12);
  transform: translateY(100%); transition: transform .22s ease-out;
}
.sheet.open { transform: none; }
.sheet[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .sheet { transition: none; } }
.grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 0 auto 12px; }
.root .sheet-h { font: 600 21px/1.25 var(--hf); color: var(--ink); margin-bottom: 4px; }
.root .sub { color: var(--mut); margin-bottom: 12px; overflow-wrap: anywhere; }
.root textarea {
  display: block; width: 100%; resize: vertical; min-height: 104px;
  border: 1.5px solid var(--line); border-radius: var(--r); padding: 12px 14px;
  background: var(--bg); line-height: 1.45;
}
.root textarea:focus { outline: none; border-color: var(--acc); }
.root .save-error {
  display: flex; gap: 8px; align-items: flex-start; margin-top: 12px; padding: 10px 14px;
  border-radius: var(--r); background: var(--warn-bg); color: var(--warn); font-weight: 600;
}
.root .save-error * { color: var(--warn); font-weight: 600; }
.save-error svg { margin-top: 2px; }
.save-error[hidden] { display: none; }
.root .btn:disabled { opacity: .55; cursor: default; }
.root .btn[aria-busy="true"]:disabled { opacity: .85; }
.actions { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.root .btn {
  min-height: 48px; width: 100%; padding: 10px 18px; border-radius: 999px; border: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.root .btn.primary { background: var(--acc); color: var(--acc-ink); }
.root .btn.primary * { color: var(--acc-ink); }
.root .btn.ghost { background: transparent; color: var(--mut); font-weight: 500; min-height: 44px; }

/* read sheet */
.read-head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 10px; }
.badge { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: none; }
.root .moved-label { color: var(--mut); }
.root .body { white-space: pre-wrap; overflow-wrap: anywhere; }
.root .status {
  display: inline-flex; align-items: center; min-height: 32px; padding: 3px 12px; border-radius: 999px;
  background: var(--soft); color: var(--ink); font-weight: 600; margin-top: 6px;
}
.root .status.settled { background: var(--acc); color: var(--acc-ink); }
.root .note { color: var(--mut); margin-top: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
`;
