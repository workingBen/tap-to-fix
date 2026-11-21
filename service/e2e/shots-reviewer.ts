// Screenshots of the reviewer dashboard with realistic data, for design checks.
// Run: npm run build:client && npx tsx e2e/shots-reviewer.ts <out-dir>
// Boots the same servers as the e2e suite (ports 8788/4173/4174 must be free).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { measure } from "./measure";
import globalSetup, { OWNER_TOKEN, SERVICE } from "./global-setup";

const out = process.argv[2];
if (!out) throw new Error("usage: tsx e2e/shots-reviewer.ts <out-dir>");
mkdirSync(out, { recursive: true });

async function call<T>(method: string, path: string, token: string, body?: object): Promise<T> {
  const res = await fetch(`${SERVICE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
const owner = <T>(method: string, path: string, body?: object) => call<T>(method, `/api/owner${path}`, OWNER_TOKEN, body);
const tick = () => new Promise((r) => setTimeout(r, 15));

const teardown = await globalSetup();
try {
  await owner("POST", "/sites", { slug: "bonus-decade", name: "Bonus Decade", origin: "https://bonusdecade.com", repo: "workingBen/longevity-tracker" });
  await owner("POST", "/sites", { slug: "greensprings", name: "Greensprings Longevity", origin: "https://greensprings.life", repo: "workingBen/longevity-tracker" });
  const r = await owner<{ id: string; token: string }>("POST", "/reviewers", { name: "Alexis Rivera" });

  type Seed = { site: string; path: string; title: string; comments: string[]; opened: boolean; after: string[] };
  const seeds: Seed[] = [
    { site: "bonus-decade", path: "/protocols/sauna", title: "Sauna protocol", comments: [], opened: false, after: [] },
    { site: "bonus-decade", path: "/protocols/cold-plunge", title: "Cold plunge guide", comments: ["a", "b", "c"], opened: true, after: ["in_progress", "done", "done"] },
    { site: "bonus-decade", path: "/", title: "Home page", comments: ["a", "b"], opened: false, after: [] },
    { site: "greensprings", path: "/digital-detox", title: "Digital Detox Retreat", comments: ["a", "b", "c"], opened: false, after: [] },
    { site: "greensprings", path: "/reports/emf/2026-loft-assessment-with-a-long-path", title: "EMF report for the loft, with a long title that wraps", comments: [], opened: true, after: [] },
  ];
  for (const s of seeds) {
    const a = await owner<{ id: string }>("POST", "/assignments", { site: s.site, reviewer_id: r.id, path: s.path, title: s.title });
    const ids: string[] = [];
    for (const body of s.comments) {
      const form = new FormData();
      form.set("data", JSON.stringify({ site: s.site, path: s.path, body: `Comment ${body}` }));
      const res = await fetch(`${SERVICE}/api/me/comments`, { method: "POST", headers: { Authorization: `Bearer ${r.token}` }, body: form });
      ids.push(((await res.json()) as { id: string }).id);
    }
    if (s.path === "/") for (const id of ids) await owner("PATCH", `/comments/${id}`, { status: "done" });
    if (s.path === "/digital-detox") await owner("PATCH", `/comments/${ids[0]}`, { status: "in_progress" });
    if (s.opened || s.path === "/" || s.path === "/digital-detox") {
      await tick();
      await call("POST", `/api/me/assignments/${a.id}/opened`, r.token);
      await tick();
    }
    for (const [i, status] of s.after.entries()) await owner("PATCH", `/comments/${ids[i]}`, { status });
  }

  const browser = await chromium.launch();
  for (const [name, viewport, mobile] of [
    ["r-1440.png", { width: 1440, height: 900 }, false],
    ["r-1280.png", { width: 1280, height: 800 }, false],
    ["r-390.png", { width: 390, height: 844 }, true],
  ] as const) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    await page.goto(`${SERVICE}/r/#ttf=${encodeURIComponent(r.token)}`);
    await page.locator("a[data-assignment]").first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) console.warn(`${name}: horizontal overflow`);
    console.log("MEASURE", name, JSON.stringify(await measure(page)));
    await page.screenshot({ path: join(out, name), fullPage: true });
    await ctx.close();
  }
  await browser.close();
  console.log(`wrote ${out}`);
} finally {
  await teardown();
}
