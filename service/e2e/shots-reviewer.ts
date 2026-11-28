// Screenshots of the reviewer dashboard with realistic data, for design checks.
// Run: npm run build:client && npx tsx e2e/shots-reviewer.ts <out-dir>
// Boots the same servers as the e2e suite (ports 8788/4173/4174 must be free).
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { measure } from "./measure";
import globalSetup, { OWNER_TOKEN, SERVICE } from "./global-setup";

// Comments must carry the Origin of the site they are for.
const ORIGIN = "https://greensprings.life";

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
  await owner("POST", "/sites", { slug: "greensprings", name: "Greensprings Longevity", origin: ORIGIN, repo: "workingBen/longevity-tracker" });
  const r = await owner<{ id: string; token: string }>("POST", "/reviewers", { name: "Alexis Rivera" });
  const empty = await owner<{ id: string; token: string }>("POST", "/reviewers", { name: "Morgan Lee" });
  const me = <T>(method: string, path: string, body?: object) => call<T>(method, `/api/me${path}`, r.token, body);

  // Every row state, every section, a Finished page, and a "since you last looked" notice.
  // `before`: statuses set before the last Got it; `after`: set after it, so the notice counts them.
  type Seed = { path: string; title: string; n: number; opened: boolean; before?: string[]; after?: string[]; finished?: boolean };
  const seeds: Seed[] = [
    { path: "/digital-detox", title: "Digital Detox Retreat", n: 0, opened: false },
    { path: "/stack-test", title: "The Stack Test", n: 0, opened: false },
    { path: "/red-light-therapy", title: "Red Light Therapy", n: 0, opened: false },
    { path: "/virtual-emf-assessment", title: "Virtual EMF Assessment", n: 4, opened: true, before: ["done", "done"], after: ["", "", "done", "done"] },
    { path: "/articles/mold-protocol", title: "Mold protocol article", n: 3, opened: true, after: ["in_progress"] },
    { path: "/bio-well-scan", title: "Bio-Well Scan", n: 2, opened: true },
    { path: "/", title: "Home page", n: 2, opened: true, before: ["done"], after: ["", "done"], finished: true },
    { path: "/protocols/sauna", title: "Sauna protocol", n: 3, opened: true, before: ["done", "done", "kept"] },
    { path: "/protocols/cold-plunge", title: "Cold plunge guide", n: 4, opened: true, before: ["done", "done", "in_progress"] },
  ];
  const made: { seed: Seed; id: string; comments: string[] }[] = [];
  for (const s of seeds) {
    const a = await owner<{ id: string }>("POST", "/assignments", { site: "greensprings", reviewer_id: r.id, path: s.path, title: s.title });
    const comments: string[] = [];
    for (let i = 0; i < s.n; i++) {
      const form = new FormData();
      form.set("data", JSON.stringify({ site: "greensprings", path: s.path, body: `Comment ${i + 1}` }));
      const res = await fetch(`${SERVICE}/api/me/comments`, { method: "POST", headers: { Authorization: `Bearer ${r.token}`, Origin: ORIGIN }, body: form });
      comments.push(((await res.json()) as { id: string }).id);
    }
    made.push({ seed: s, id: a.id, comments });
  }
  const apply = async (key: "before" | "after") => {
    for (const m of made) {
      for (const [i, status] of (m.seed[key] ?? []).entries()) if (status) await owner("PATCH", `/comments/${m.comments[i]}`, { status, ...(status === "kept" ? { note: "Kept as is." } : {}) });
    }
  };
  await apply("before");
  await tick();
  for (const m of made) if (m.seed.opened) await me("POST", `/assignments/${m.id}/opened`);
  for (const m of made) if (m.seed.finished) await me("POST", `/assignments/${m.id}/finished`);
  await tick();
  await me("POST", "/acknowledge");
  await tick();
  await apply("after");

  const browser = await chromium.launch({ args: ["--disable-features=MacAppCodeSignClone"] });
  type Shot = { name: string; width: number; height: number; token: string; full?: boolean; act?: (page: Page) => Promise<void> };
  // The Got it shot acknowledges everything, so it comes after every shot that shows the notice.
  const shots: Shot[] = [
    { name: "r-390.png", width: 390, height: 844, token: r.token, full: true },
    { name: "r-390-screen.png", width: 390, height: 844, token: r.token },
    { name: "r-1440.png", width: 1440, height: 900, token: r.token, full: true },
    { name: "r-1280.png", width: 1280, height: 800, token: r.token, full: true },
    {
      name: "r-390-sheet.png", width: 390, height: 844, token: r.token,
      act: async (page) => {
        await page.getByRole("button", { name: "Actions for Virtual EMF Assessment" }).click();
        await page.getByRole("dialog").waitFor();
      },
    },
    {
      name: "r-390-finished-open.png", width: 390, height: 844, token: r.token, full: true,
      act: async (page) => {
        await page.locator("details[data-section=finished] summary").click();
      },
    },
    {
      name: "r-390-after-got-it.png", width: 390, height: 844, token: r.token,
      act: async (page) => {
        await page.getByRole("button", { name: "Got it" }).click();
        await page.locator("[data-notice]").waitFor({ state: "detached" });
      },
    },
    { name: "r-390-empty.png", width: 390, height: 844, token: empty.token },
    { name: "r-1440-empty.png", width: 1440, height: 900, token: empty.token },
  ];
  for (const shot of shots) {
    const mobile = shot.width < 640;
    const ctx = await browser.newContext({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    await page.goto(`${SERVICE}/r/#ttf=${encodeURIComponent(shot.token)}`);
    await page.locator("h1.hello").waitFor();
    if (shot.act) await shot.act(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) console.warn(`${shot.name}: horizontal overflow`);
    const rows = await page.evaluate(() => [...document.querySelectorAll("a[data-assignment]")].map((a) => Math.round(a.getBoundingClientRect().height)));
    console.log("MEASURE", shot.name, JSON.stringify({ ...(await measure(page)), rowHeights: rows }));
    await page.screenshot({ path: join(out, shot.name), fullPage: !!shot.full });
    await ctx.close();
  }
  await browser.close();
  console.log(`wrote ${out}`);
} finally {
  await teardown();
}
