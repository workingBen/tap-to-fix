// Screenshots of offline mode on the fixture page at 390 px: the offline line and its sheet,
// hollow pins with the waiting count, an unsent pin's read sheet, sending, all sent, the
// "didn't send" line and sheet, and the reviewer dashboard's waiting line.
// Run (from service/, one run at a time): npm run build:client && npx tsx e2e/shots-offline.ts <out-dir>
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import globalSetup, { FIXTURE, OWNER_TOKEN, SERVICE } from "./global-setup";

const out = process.argv[2];
if (!out) throw new Error("usage: tsx e2e/shots-offline.ts <out-dir>");
mkdirSync(out, { recursive: true });

async function owner<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${SERVICE}/api/owner${path}`, { method: "POST", headers: { Authorization: `Bearer ${OWNER_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

const teardown = await globalSetup();
try {
  const browser = await chromium.launch({ args: ["--disable-features=MacAppCodeSignClone"] });
  const rv = await owner<{ id: string; token: string }>("/reviewers", { name: "Ben" });
  await owner("/assignments", { site: "fixture", reviewer_id: rv.id, path: "/index.html", title: "Fixture home" });
  await owner("/assignments", { site: "fixture", reviewer_id: rv.id, path: "/other.html", title: "Fixture other page" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("ttf:mode", "comment");
    } catch {}
  });
  await page.goto(`${FIXTURE}/index.html#ttf=${encodeURIComponent(rv.token)}`);
  const overlay = page.locator("tap-to-fix-overlay");
  const bar = overlay.locator("[data-ttf=bar]");
  const line = bar.locator("[data-ttf=line]");
  const sheet = overlay.locator("[data-ttf=sheet]");
  await bar.locator("[data-ttf=mode]").waitFor();
  const shoot = async (name: string, p: Page = page) => {
    await p.waitForTimeout(700); // let a sheet finish sliding in
    await p.screenshot({ path: join(out, name) });
    console.log("wrote", join(out, name));
  };
  const comment = async (sel: string, text: string) => {
    const b = (await page.locator(sel).boundingBox())!;
    await page.touchscreen.tap(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2);
    await sheet.locator("textarea").fill(text);
    await sheet.getByRole("button", { name: "Save comment" }).tap();
    await sheet.waitFor({ state: "hidden" });
  };

  // One comment sent while online, so the page has a filled pin.
  await comment("h1", "The heading is too small to read from across the room.");
  await page.waitForTimeout(3500);

  await ctx.setOffline(true);
  await line.getByText("Comments still save").waitFor();
  await shoot("01-offline-line.png");
  await line.tap();
  await sheet.getByText("You're offline").waitFor();
  await shoot("02-offline-sheet.png");
  await sheet.getByRole("button", { name: "OK" }).tap();

  await comment("#intro", "Make this sentence bigger. It's hard to read on a phone.");
  await comment("#photo", "Swap this photo for one of the cabins.");
  await comment("#counter", "Say how many guests fit.");
  await line.getByText("3 waiting to send").waitFor({ timeout: 6000 });
  await shoot("03-waiting-hollow-pins.png");
  await overlay.locator("[data-ttf=pin].unsent").first().tap();
  await sheet.getByText("Not sent yet").waitFor();
  await shoot("04-unsent-read-sheet.png");
  await sheet.getByRole("button", { name: "Close" }).tap();

  // Back online: the second send is held until the "Sending 2 of 3" shot is taken.
  let n = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/me/comments", async (route) => {
    if (++n === 2) await held;
    await route.continue();
  });
  await ctx.setOffline(false);
  await line.getByText("Sending 2 of 3").waitFor();
  await shoot("05-sending.png");
  release();
  await line.getByText("All 3 sent").waitFor();
  await page.screenshot({ path: join(out, "06-all-sent.png") });
  console.log("wrote", join(out, "06-all-sent.png"));
  await line.waitFor({ state: "hidden", timeout: 6000 });
  await shoot("07-back-to-normal.png");
  // The screenshots taken in airplane mode, as the owner sees them (images not yet loaded may be blank).
  const batch = await fetch(`${SERVICE}/api/owner/batch?reviewer=${rv.id}&site=fixture&status=open`, { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } });
  for (const c of ((await batch.json()) as { comments: { id: string; body: string }[] }).comments.slice(1)) {
    const shot = await fetch(`${SERVICE}/api/owner/comments/${c.id}/screenshot`, { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } });
    const ext = (shot.headers.get("content-type") ?? "").includes("webp") ? "webp" : "jpg";
    const name = `offline-capture-${c.body.slice(0, 12).replace(/\W+/g, "-")}.${ext}`;
    if (shot.ok) writeFileSync(join(out, name), Buffer.from(await shot.arrayBuffer()));
    console.log(shot.ok ? `wrote ${join(out, name)}` : `no screenshot for "${c.body}" (${shot.status})`);
  }
  await page.unroute("**/api/me/comments");

  // A refusal retrying can't fix (here: the page was taken off the list).
  await ctx.setOffline(true);
  await comment("#other-link", "Say how many guests fit.");
  await page.route("**/api/me/comments", (route) => route.fulfill({ status: 403, body: "{}" }));
  await ctx.setOffline(false);
  await line.getByText("didn't send").waitFor();
  await shoot("08-failed-line.png");
  await line.tap();
  await sheet.getByText("Try again now").waitFor();
  await shoot("09-failed-sheet.png");
  await sheet.getByRole("button", { name: "Close" }).tap();

  // Dashboard: Done carries the count over (the refused comment is still on the phone).
  const href = (await overlay.getByRole("link", { name: "Done" }).getAttribute("href"))!;
  await page.goto(href);
  await page.locator("[data-waiting-line]").waitFor();
  await shoot("10-dashboard-waiting.png");
  await browser.close();
} finally {
  await teardown();
}
