// Layout measurements for the visual-QA screenshots: overflow, smallest text, small tap targets.
import type { Page } from "@playwright/test";

export type Measure = { scrollWidth: number; innerWidth: number; minFont: { px: number; text: string }; smallTargets: string[] };

export async function measure(page: Page, only?: string): Promise<Measure> {
  await page.evaluate('globalThis.__name = (f) => f'); // tsx wraps named functions in __name()
  return page.evaluate((only) => {
    const roots: (Document | ShadowRoot)[] = [document];
    // `only`: measure just inside that host's shadow root (the page under review is not ours).
    if (only) roots[0] = document.querySelector(only)!.shadowRoot!;
    const all: Element[] = [];
    for (let i = 0; i < roots.length; i++) {
      for (const el of Array.from(roots[i].querySelectorAll("*"))) {
        all.push(el);
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    let min = { px: 999, text: "" };
    for (const el of all) {
      if (["STYLE", "SCRIPT", "HEAD", "TITLE", "META", "LINK"].includes(el.tagName) || !visible(el)) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim());
      if (!own) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < min.px) min = { px, text: (el.textContent || "").trim().slice(0, 40) };
    }
    const small: string[] = [];
    for (const el of all) {
      if (!el.matches("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]") || !visible(el)) continue;
      const h = Math.round(el.getBoundingClientRect().height);
      if (h < 44) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim().slice(0, 24)}" ${h}px`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, minFont: min, smallTargets: small };
  }, only);
}
