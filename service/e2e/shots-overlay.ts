// Screenshots of the comment layer on the fixture page: bar + compose sheet, then bar + read sheet with two saved pins.
// Run: npm run build:client && npx tsx e2e/shots-overlay.ts <out-dir>
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { measure } from "./measure";
import globalSetup, { FIXTURE, OWNER_TOKEN, SERVICE } from "./global-setup";

const out = process.argv[2];
if (!out) throw new Error("usage: tsx e2e/shots-overlay.ts <out-dir>");
mkdirSync(out, { recursive: true });

async function owner<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${SERVICE}/api/owner${path}`, { method: "POST", headers: { Authorization: `Bearer ${OWNER_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

const teardown = await globalSetup();
try {
  const browser = await chromium.launch();
  for (const [w, viewport, mobile] of [
    [1440, { width: 1440, height: 900 }, false],
    [1280, { width: 1280, height: 800 }, false],
    [390, { width: 390, height: 844 }, true],
  ] as const) {
    // A fresh reviewer per width, so earlier widths' saved pins are not on this page.
    const rv = await owner<{ id: string; token: string }>("/reviewers", { name: `Alexis ${w}` });
    await owner("/assignments", { site: "fixture", reviewer_id: rv.id, path: "/index.html", title: "Fixture home" });
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    await page.goto(`${FIXTURE}/index.html#ttf=${encodeURIComponent(rv.token)}`);
    const overlay = page.locator("tap-to-fix-overlay");
    const sheet = overlay.locator("[data-ttf=sheet]");
    await overlay.locator("[data-ttf=bar]").waitFor();
    const tap = async (sel: string) => {
      const b = (await page.locator(sel).boundingBox())!;
      const x = b.x + Math.min(b.width / 2, 60);
      const y = b.y + b.height / 2;
      if (mobile) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
    };
    const press = async (loc: ReturnType<typeof page.locator>) => (mobile ? loc.tap() : loc.click());
    const shoot = async (name: string) => {
      await page.waitForTimeout(900); // let the sheet finish sliding in
      console.log("MEASURE", name, JSON.stringify(await measure(page, "tap-to-fix-overlay")));
      await page.screenshot({ path: join(out, name) });
    };

    await tap("h1");
    await sheet.waitFor();
    await sheet.locator("textarea").fill("The heading is too small to read from across the room. Can it be bigger?");
    await shoot(`overlay-compose-${w}.png`);
    await press(sheet.getByRole("button", { name: "Save comment" }));
    await overlay.locator("[data-ttf=bar]").getByText("Saved").waitFor();
    await sheet.waitFor({ state: "hidden" });

    await tap("#other-link");
    await sheet.waitFor();
    await sheet.locator("textarea").fill("Swap this link for a button.");
    await press(sheet.getByRole("button", { name: "Save comment" }));
    await sheet.waitFor({ state: "hidden" });

    await press(overlay.locator("[data-ttf=pin]").first());
    await sheet.waitFor();
    await shoot(`overlay-read-${w}.png`);
    if (w === 390) {
      // One saved screenshot as the owner API serves it, to check the pin drawn onto it.
      const h = { Authorization: `Bearer ${OWNER_TOKEN}` };
      type Listed = { comments: { id: string; has_screenshot: boolean }[] };
      const listed = async () => (await (await fetch(`${SERVICE}/api/owner/batch?reviewer=${rv.id}&site=fixture&status=open`, { headers: h })).json()) as Listed;
      const saveShot = async (id: string, name: string) => {
        const res = await fetch(`${SERVICE}/api/owner/comments/${id}/screenshot`, { headers: h });
        const ext = (res.headers.get("content-type") ?? "").includes("webp") ? "webp" : "jpg";
        writeFileSync(join(out, `${name}.${ext}`), Buffer.from(await res.arrayBuffer()));
      };
      const first = (await listed()).comments.find((x) => x.has_screenshot);
      if (first) await saveShot(first.id, "shot-sample");
      // A tap within 20px of the right edge: the pin leans left so it stays on screen.
      await sheet.getByRole("button", { name: "Close" }).tap();
      await sheet.waitFor({ state: "hidden" });
      const hb = (await page.locator("h1").boundingBox())!;
      await page.touchscreen.tap(viewport.width - 12, hb.y + hb.height / 2);
      await sheet.waitFor();
      await sheet.locator("textarea").fill("Flip check at the right edge.");
      await shoot(`overlay-flip-${w}.png`);
      const before = new Set((await listed()).comments.map((x) => x.id));
      await press(sheet.getByRole("button", { name: "Save comment" }));
      await sheet.waitFor({ state: "hidden" });
      const added = (await listed()).comments.find((x) => !before.has(x.id) && x.has_screenshot);
      if (added) await saveShot(added.id, "shot-flip");
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`wrote ${out}`);
} finally {
  await teardown();
}
