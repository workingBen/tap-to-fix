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
  font-family: -apple-system, "Helvetica Neue", system-ui, sans-serif;
  font-size: 17px; line-height: 1.4; color: var(--ink);
  -webkit-font-smoothing: antialiased; letter-spacing: normal; text-transform: none;
}
svg { flex: none; }

/* top bar */
.bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
  min-height: 52px; padding: 4px 8px 4px 16px;
  display: flex; flex-wrap: wrap; align-items: center; column-gap: 10px;
  background: var(--surf); border-bottom: 1px solid var(--line);
  box-shadow: 0 2px 10px rgba(0, 0, 0, .06);
}
.bar[hidden] { display: none; }
.bar .msg { color: var(--mut); display: inline-flex; align-items: center; gap: 8px; }
.bar b { color: var(--ink); font-weight: 600; }
.bar a {
  margin-left: auto; min-height: 44px; padding: 0 8px;
  display: inline-flex; align-items: center;
  color: var(--acc); font-weight: 700; text-decoration: none;
}
.bar a:focus-visible, .sheet button:focus-visible, .pin:focus-visible { outline: 3px solid var(--acc); outline-offset: 2px; }
.bar .msg svg { color: var(--warn); }
.root .bar .saved { color: var(--acc); font-weight: 600; display: inline-flex; align-items: center; gap: 6px; order: 1; }
.root .bar .saved:empty { display: none; }
.bar a { order: 2; }
.bar .saved svg { color: var(--acc); }

/* pins: a zero-size layer in document coordinates */
.pins { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none; }
.pin {
  position: absolute; width: 44px; height: 44px; padding: 0; border: 0; background: transparent;
  display: grid; place-items: center; cursor: pointer; pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
.root .dot {
  width: 30px; height: 30px; border-radius: 50%;
  display: grid; place-items: center;
  font-weight: 700; font-size: 17px; line-height: 1;
  background: var(--ink); color: var(--bg);
  box-shadow: 0 0 0 3px var(--bg), 0 4px 10px rgba(0, 0, 0, .25);
}
.root .settled .dot { background: var(--acc); color: var(--acc-ink); }
.root .moved .dot { outline: 2px dashed var(--ink); outline-offset: 4px; }
.pin.new { pointer-events: none; }
.root .pin.new .dot {
  background: var(--acc); color: var(--acc-ink);
  box-shadow: 0 0 0 3px var(--bg), 0 0 0 9px color-mix(in srgb, var(--acc) 30%, transparent);
}

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
