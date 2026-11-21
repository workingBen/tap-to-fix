import { PAPER_CSS } from "../paper";

// Dashboard styles; views add their own rules in later tasks.
export const DASH_CSS = `${PAPER_CSS}
html, body { margin: 0; }
body { background: var(--bg, #fff); color: var(--ink, #222); font: 17px/1.5 system-ui, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
a { color: inherit; }
`;
