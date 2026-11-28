import { expect, test, type Page } from "@playwright/test";

// Offline mode: comments save to the phone (the site's IndexedDB) and send when the service can
// be reached. context.setOffline is airplane mode: navigator.onLine goes false and every request
// fails. A page opened while the service can't be reached is simulated by failing only the API.

const SERVICE = "http://localhost:8788";
const ownerHeaders = () => ({ Authorization: `Bearer ${process.env.TTF_OWNER_TOKEN}`, "Content-Type": "application/json" });

async function owner<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${SERVICE}/api/owner${path}`, { method: "POST", headers: ownerHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function freshReviewer(name: string): Promise<{ id: string; token: string }> {
  const r = await owner<{ id: string; token: string }>("/reviewers", { name });
  await owner("/assignments", { site: "fixture", reviewer_id: r.id, path: "/index.html", title: "Fixture home" });
  return r;
}

async function bodies(reviewerId: string): Promise<string[]> {
  const res = await fetch(`${SERVICE}/api/owner/batch?reviewer=${reviewerId}&site=fixture&status=open`, { headers: ownerHeaders() });
  return ((await res.json()) as { comments: { body: string }[] }).comments.map((c) => c.body);
}

const overlay = (page: Page) => page.locator("tap-to-fix-overlay");
const bar = (page: Page) => overlay(page).locator("[data-ttf=bar]");
const line = (page: Page) => bar(page).locator("[data-ttf=line]");
const pins = (page: Page) => overlay(page).locator("[data-ttf=pin]");
const sheet = (page: Page) => overlay(page).locator("[data-ttf=sheet]");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("ttf:mode")) sessionStorage.setItem("ttf:mode", "comment");
    } catch {
      // about:blank has no storage.
    }
  });
});

async function open(page: Page, token: string): Promise<void> {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  await page.goto(`/index.html#ttf=${encodeURIComponent(token)}`);
  await expect(bar(page)).toContainText("Reviewing");
}

async function comment(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).first().tap();
  await sheet(page).locator("textarea").fill(text);
  await sheet(page).getByRole("button", { name: "Save comment" }).tap();
  await expect(sheet(page)).toBeHidden();
}

test("saved offline: hollow pins and a count; back online they send, then fill in", async ({ page, context }) => {
  const r = await freshReviewer("Airplane reviewer");
  await open(page, r.token);
  await context.setOffline(true);
  await expect(line(page)).toHaveText("Offline · Comments still save");
  // Gray, not amber: being offline is not a fault.
  expect(await line(page).evaluate((el) => getComputedStyle(el).color)).toBe("rgb(94, 101, 95)");

  await comment(page, "h1", "Make this bigger");
  await expect(bar(page).locator("[data-ttf=saved]")).toHaveText("Saved on this phone");
  await expect(pins(page)).toHaveCount(1);
  await expect(pins(page).first()).toHaveClass(/unsent/);
  await comment(page, "#intro", "Say how many guests fit");
  await expect(line(page)).toHaveText("Offline · 2 waiting to send", { timeout: 6_000 });
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(2);

  // An unsent pin's read sheet says so.
  await pins(page).nth(1).tap();
  await expect(sheet(page).locator("[data-ttf=unsent]")).toHaveText("Not sent yet");
  await expect(sheet(page)).toContainText("Saved on this phone. It sends when you're back online.");
  await sheet(page).getByRole("button", { name: "Close" }).tap();

  // The line explains itself.
  await line(page).tap();
  await expect(sheet(page)).toContainText("You're offline");
  await expect(sheet(page)).toContainText("Keep commenting. Each comment and its screenshot is saved on this phone.");
  await sheet(page).getByRole("button", { name: "OK" }).tap();
  expect(await bodies(r.id)).toEqual([]);

  // Back online: slow each POST a little, so "Sending" can be seen.
  await page.route("**/api/me/comments", async (route) => {
    await new Promise((res) => setTimeout(res, 700));
    await route.continue();
  });
  await context.setOffline(false);
  await expect(line(page)).toContainText(/Sending [12] of 2/);
  await expect(line(page)).toHaveText("All 2 sent");
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(0);
  await expect(pins(page)).toHaveCount(2);
  await expect(line(page)).toBeHidden({ timeout: 5_000 });
  expect((await bodies(r.id)).sort()).toEqual(["Make this bigger", "Say how many guests fit"]);
});

test("a page reopened while the service can't be reached shows the pins it had, and unsent ones", async ({ page, context }) => {
  const r = await freshReviewer("Cached reviewer");
  await open(page, r.token);
  await comment(page, "h1", "Saved while online");
  await expect(bar(page).locator("[data-ttf=saved]")).toHaveText("Saved");
  await context.setOffline(true);
  await comment(page, "#other-link", "Saved on the plane");
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(1);

  // Reload with the service unreachable (only the API fails, so the page itself still loads).
  await page.route(`${SERVICE}/api/**`, (route) => route.abort("internetdisconnected"));
  await context.setOffline(false);
  await open(page, r.token);
  await expect(pins(page)).toHaveCount(2);
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(1);
  await expect(line(page)).toHaveText("Offline · 1 waiting to send");
  await pins(page).first().tap();
  await expect(sheet(page)).toContainText("Saved while online");
  await expect(sheet(page).locator(".status")).toHaveText("Open");
  await sheet(page).getByRole("button", { name: "Close" }).tap();

  // The service comes back: the retry sends it, and the list catches up without a second copy.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(0, { timeout: 10_000 });
  await expect(pins(page)).toHaveCount(2);
  expect((await bodies(r.id)).sort()).toEqual(["Saved on the plane", "Saved while online"]);
});

test("a page opened offline that never loaded its comments still takes new ones", async ({ page }) => {
  const r = await freshReviewer("First visit offline");
  await page.route(`${SERVICE}/api/**`, (route) => route.abort("internetdisconnected"));
  await open(page, r.token);
  await expect(line(page)).toHaveText("Offline · Comments still save");
  await expect(bar(page)).not.toContainText("Can't reach");
  await comment(page, "h1", "Commented before the list ever loaded");
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(1);
});

test("a reply lost on the way back is retried and still saved once", async ({ page }) => {
  const r = await freshReviewer("Lost reply");
  await open(page, r.token);
  let first = true;
  await page.route("**/api/me/comments", async (route) => {
    if (route.request().method() !== "POST" || !first) return route.continue();
    first = false;
    await route.fetch(); // the service stores it…
    await route.abort("connectionreset"); // …but the phone never hears back
  });
  await comment(page, "h1", "Only once, please");
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(1);
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(0, { timeout: 10_000 });
  expect(await bodies(r.id)).toEqual(["Only once, please"]);
});

test("a refusal retrying can't fix: amber line, the words kept, Copy text, Try again", async ({ page, context }) => {
  const r = await freshReviewer("Refused later");
  await open(page, r.token);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.setOffline(true);
  await comment(page, "h1", "Say how many guests fit.");
  await page.route("**/api/me/comments", (route) => route.fulfill({ status: 403, body: "{}" }));
  await context.setOffline(false);
  await expect(line(page)).toHaveText("1 didn't send · See why");
  expect(await line(page).evaluate((el) => getComputedStyle(el).color)).toBe("rgb(154, 91, 19)"); // --warn
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(1); // still on the phone

  await line(page).tap();
  await expect(sheet(page)).toContainText("1 comment didn't send");
  await expect(sheet(page).locator("[data-ttf=failed] .quote")).toHaveText("Say how many guests fit.");
  await expect(sheet(page)).toContainText("This page isn't on your review list.");
  await expect(sheet(page)).toContainText("It's still saved on this phone.");
  await sheet(page).locator("[data-ttf=copy]").tap();
  await expect(sheet(page).locator("[data-ttf=copy]")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Say how many guests fit.");

  // Whatever refused it is sorted out: Try again sends it.
  await page.unroute("**/api/me/comments");
  await sheet(page).getByRole("button", { name: "Try again now" }).tap();
  await expect(line(page)).toHaveText("1 comment sent");
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(0);
  expect(await bodies(r.id)).toEqual(["Say how many guests fit."]);
});

test("Done hands the waiting count to the dashboard, which clears it once they are sent", async ({ page, context }) => {
  const r = await freshReviewer("Handed over");
  await open(page, r.token);
  await context.setOffline(true);
  await comment(page, "h1", "One");
  await comment(page, "#intro", "Two");
  await expect(line(page)).toHaveText("Offline · 2 waiting to send", { timeout: 6_000 });
  const done = overlay(page).getByRole("link", { name: "Done" });
  const href = (await done.getAttribute("href"))!;
  expect(href.startsWith(`${SERVICE}/r/#ttf=${r.token}&waiting=`)).toBe(true);

  // The dashboard is another origin and can't open in airplane mode; follow Done once online,
  // with the comments still held back.
  await page.route("**/api/me/comments", (route) => route.abort());
  await context.setOffline(false);
  await page.goto(href);
  await expect(page.locator("[data-waiting-line]")).toContainText("2 comments waiting to send");
  await expect(page.locator("[data-waiting-line]")).toContainText("Open each page while you're online and they send.");
  await expect(page.locator("a[data-assignment] [data-waiting]")).toHaveText("2 waiting to send");
  expect(new URL(page.url()).hash).toBe(`#ttf=${r.token}`); // the report itself is not kept in the address

  // Opening the page sends them; its Done reports none, and the line goes.
  await page.unroute("**/api/me/comments");
  await page.locator("a[data-assignment]").tap();
  await expect(bar(page)).toContainText("Reviewing");
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(0);
  await expect(pins(page)).toHaveCount(2);
  await overlay(page).getByRole("link", { name: "Done" }).tap();
  await expect(page.locator("a[data-assignment]")).toBeVisible();
  await expect(page.locator("[data-waiting-line]")).toHaveCount(0);
  await expect(page.locator("a[data-assignment] [data-waiting]")).toHaveCount(0);
});

test("a dashboard reached without Done still drops comments that have since sent", async ({ page, context }) => {
  const r = await freshReviewer("Came back another way");
  await open(page, r.token);
  await context.setOffline(true);
  await comment(page, "h1", "One");
  await expect(line(page)).toHaveText("Offline · 1 waiting to send", { timeout: 6_000 });
  const href = (await overlay(page).getByRole("link", { name: "Done" }).getAttribute("href"))!;

  await page.route("**/api/me/comments", (route) => route.abort());
  await context.setOffline(false);
  await page.goto(href);
  await expect(page.locator("[data-waiting-line]")).toContainText("1 comment waiting to send");

  // The page sends it, but the reviewer comes back by the Back button or a home-screen icon.
  await page.unroute("**/api/me/comments");
  await page.locator("a[data-assignment]").tap();
  await expect(overlay(page).locator("[data-ttf=pin].unsent")).toHaveCount(0);
  await expect(pins(page)).toHaveCount(1);
  await page.goto(`${SERVICE}/r/#ttf=${r.token}`);
  await expect(page.locator("a[data-assignment]")).toBeVisible();
  await expect(page.locator("[data-waiting-line]")).toHaveCount(0);
  await expect(page.locator("a[data-assignment] [data-waiting]")).toHaveCount(0);
});

test("Done while offline stays on the page and says why, instead of a browser error", async ({ page, context }) => {
  const r = await freshReviewer("Done offline");
  await open(page, r.token);
  await context.setOffline(true);
  await comment(page, "h1", "One");
  await expect(line(page)).toHaveText("Offline · 1 waiting to send", { timeout: 6_000 });
  const here = page.url();
  await overlay(page).getByRole("link", { name: "Done" }).tap();
  await expect(sheet(page)).toContainText("Your review list needs a connection");
  await expect(sheet(page)).toContainText("Your 1 comment is saved on this phone.");
  expect(page.url()).toBe(here);
  await sheet(page).getByRole("button", { name: "OK" }).tap();
  await expect(sheet(page)).toBeHidden();

  // Back online, Done goes to the list as before.
  await context.setOffline(false);
  await overlay(page).getByRole("link", { name: "Done" }).tap();
  await expect(page).toHaveURL(new RegExp(`/r/#ttf=${r.token}`));
});
