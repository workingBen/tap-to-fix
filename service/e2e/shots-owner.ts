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

  await owner("POST", "/sites", { slug: "bonus-decade", name: "Bonus Decade", origin: "https://bonusdecade.com", repo: "workingBen/longevity-tracker" });
  await owner("POST", "/sites", { slug: "greensprings", name: "Greensprings Longevity", origin: "https://greensprings.life", repo: "workingBen/longevity-tracker" });
  const chris = await owner<{ id: string; token: string }>("POST", "/reviewers", { name: "Chris Tosswill" });
  const john = await owner<{ id: string; token: string }>("POST", "/reviewers", { name: "John Pellow" });

  type Seed = { who: { id: string; token: string }; site: string; path: string; title: string; after: (string | null)[]; pr?: string };
  const PR = "https://github.com/workingBen/longevity-tracker/pull/";
  // `after`: one entry per comment; null leaves it open.
  const seeds: Seed[] = [
    { who: alexis, site: "bonus-decade", path: "/protocols/sauna", title: "Sauna protocol", after: [null, null, null, null, "done"], pr: PR + "712" },
    { who: alexis, site: "bonus-decade", path: "/", title: "Home page", after: [null, null] },
    { who: alexis, site: "greensprings", path: "/digital-detox", title: "Digital Detox Retreat", after: [null, null, "in_progress"] },
    { who: alexis, site: "greensprings", path: "/reports/emf/2026-loft-assessment-with-a-long-path", title: "EMF report for the loft, with a long title that wraps", after: [] },
    { who: chris, site: "bonus-decade", path: "/protocols/cold-plunge", title: "Cold plunge guide", after: ["in_progress", "done", "done"], pr: PR + "715" },
    { who: chris, site: "greensprings", path: "/stack-test", title: "The Stack Test", after: ["done", "done"], pr: PR + "698" },
    { who: john, site: "bonus-decade", path: "/protocols/red-light", title: "Red light therapy", after: [] },
    { who: john, site: "greensprings", path: "/gifts", title: "Gifts buying club", after: ["kept"] },
  ];
  for (const s of seeds) {
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
  await owner("POST", `/reviewers/${john.id}/revoke`);

  const browser = await chromium.launch();
  for (const [name, viewport, mobile] of [
    ["o-1440.png", { width: 1440, height: 900 }, false],
    ["o-1280.png", { width: 1280, height: 800 }, false],
    ["o-390.png", { width: 390, height: 844 }, true],
  ] as const) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    await page.goto(`${SERVICE}/o/#owner=${encodeURIComponent(OWNER_TOKEN)}`);
    await page.locator("tr[data-row]").first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) console.warn(`${name}: horizontal overflow`);
    console.log("MEASURE", name, JSON.stringify(await measure(page)));
    await page.screenshot({ path: join(out, name), fullPage: true });

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
