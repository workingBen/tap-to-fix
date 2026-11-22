// Screenshots of the owner dashboard with realistic data, for design checks.
// Run: npm run build:client && npx tsx e2e/shots-owner.ts <out-dir>
// Boots the same servers as the e2e suite (ports 8788/4173/4174 must be free).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { measure } from "./measure";
import globalSetup, { OWNER_TOKEN, SERVICE } from "./global-setup";

const out = process.argv[2];
if (!out) throw new Error("usage: tsx e2e/shots-owner.ts <out-dir>");
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

const teardown = await globalSetup();
try {
  // global-setup seeds a "Fixture" site and a reviewer called Alexis with one fixture page;
  // clear that page so the shots show only the realistic data below.
  const seeded = await owner<{ assignments: { id: string }[] }>("GET", "/overview");
  for (const a of seeded.assignments) await owner("DELETE", `/assignments/${a.id}`);
  const alexis = { id: process.env.TTF_REVIEWER_ID!, token: process.env.TTF_TOKEN! };

  // Seeded like the design-review mockup (1-dashboard-B): two reviewers, three sites, six pages.
  // The setup's "Fixture" site and "Alexis" reviewer cannot be deleted, so they stand in for
  // the mockup's Alexis Art and Alexis Rivera.
  await owner("POST", "/sites", { slug: "greensprings", name: "Greensprings Longevity", origin: "https://greensprings.life", repo: "workingBen/longevity-tracker" });
  await owner("POST", "/sites", { slug: "bonus-decade", name: "Bonus Decade", origin: "https://bonusdecade.com", repo: "workingBen/longevity-tracker" });
  const ben = await owner<{ id: string; token: string }>("POST", "/reviewers", { name: "Ben Pellow" });

  type Seed = { who: { id: string; token: string }; site: string; path: string; title: string; after: (string | null)[]; pr?: string };
  const PR = "https://github.com/workingBen/longevity-tracker/pull/";
  // `after`: one entry per comment; null leaves it open. Oldest first, so the overview lists them newest first.
  const seeds: Seed[] = [
    { who: alexis, site: "greensprings", path: "/virtual-emf-assessment", title: "Virtual EMF Assessment", after: [null, null, null, "in_progress"] },
    { who: alexis, site: "greensprings", path: "/digital-detox", title: "Digital Detox Retreat", after: [null, "done", "done"], pr: PR + "712" },
    { who: alexis, site: "bonus-decade", path: "/protocols/sauna", title: "Sauna protocol", after: [] },
    { who: ben, site: "bonus-decade", path: "/", title: "Home page", after: ["done", "done"], pr: PR + "706" },
    { who: ben, site: "greensprings", path: "/gifts", title: "Gifts buying club", after: [null, "in_progress"] },
    { who: alexis, site: "fixture", path: "/index.html", title: "Gallery", after: [null] },
  ];
  for (const s of seeds) {
    await new Promise((r) => setTimeout(r, 5)); // distinct created_at, so the order is stable
    await owner("POST", "/assignments", { site: s.site, reviewer_id: s.who.id, path: s.path, title: s.title });
    for (const [i, status] of s.after.entries()) {
      const form = new FormData();
      form.set("data", JSON.stringify({ site: s.site, path: s.path, body: `Comment ${i + 1}` }));
      const res = await fetch(`${SERVICE}/api/me/comments`, { method: "POST", headers: { Authorization: `Bearer ${s.who.token}` }, body: form });
      if (!res.ok) throw new Error(`comment → ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      if (status) {
        await owner("PATCH", `/comments/${id}`, {
          status,
          ...(status === "kept" ? { note: "Keeping as is" } : {}),
          ...(s.pr && status !== "kept" ? { pr_url: s.pr } : {}),
        });
      }
    }
  }

  const browser = await chromium.launch();
  for (const [name, viewport, mobile] of [
    ["o-1440.png", { width: 1440, height: 900 }, false],
    ["o-1280.png", { width: 1280, height: 800 }, false],
    ["o-390.png", { width: 390, height: 844 }, true],
  ] as const) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    await page.goto(`${SERVICE}/o/#owner=${encodeURIComponent(OWNER_TOKEN)}`);
    await page.locator("[data-person] [data-row]").first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) console.warn(`${name}: horizontal overflow`);
    console.log("MEASURE", name, JSON.stringify(await measure(page)));
    await page.screenshot({ path: join(out, name), fullPage: true });

    if (!mobile && viewport.width === 1440) {
      // The more menu open, and the stand-in assign form.
      await page.locator("[data-person] details.more > summary").first().click();
      await page.screenshot({ path: join(out, "o-menu-1440.png") });
      await page.locator("[data-person] details.more > summary").first().click();
      await page.locator("[data-person] [data-action=assign]").nth(1).click();
      await page.screenshot({ path: join(out, "o-assign-1440.png"), fullPage: true });
    }
    if (mobile) {
      // The link flash after adding a reviewer.
      await page.locator("[data-adder=reviewer] > summary").click();
      await page.locator("form[data-form=reviewer]").getByLabel("Name").fill("Shawn");
      await page.locator("form[data-form=reviewer]").getByRole("button", { name: "Add" }).click();
      const flash = page.locator("[data-flash]");
      await flash.waitFor();
      await flash.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.screenshot({ path: join(out, "o-flash-390.png") });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`wrote ${out}`);
} finally {
  await teardown();
}
