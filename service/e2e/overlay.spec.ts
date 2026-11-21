import { expect, test, type Page } from "@playwright/test";

const SERVICE = "http://localhost:8788";
const token = () => process.env.TTF_TOKEN ?? "";
const ownerHeaders = () => ({ Authorization: `Bearer ${process.env.TTF_OWNER_TOKEN}`, "Content-Type": "application/json" });

async function owner<T>(method: string, path: string, body: object): Promise<T> {
  const res = await fetch(`${SERVICE}/api/owner${path}`, { method, headers: ownerHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// Playwright CSS locators pierce open shadow roots.
const overlay = (page: Page) => page.locator("tap-to-fix-overlay");
const bar = (page: Page) => overlay(page).locator("[data-ttf=bar]");
const pins = (page: Page) => overlay(page).locator("[data-ttf=pin]");
const sheet = (page: Page) => overlay(page).locator("[data-ttf=sheet]");

async function openAsReviewer(page: Page, path = "/index.html", t = token()): Promise<void> {
  await page.goto(`${path}?ttf=${encodeURIComponent(t)}`);
}

async function openReady(page: Page): Promise<void> {
  await openAsReviewer(page);
  await expect(bar(page)).toContainText("Reviewing");
}

test("ordinary visitor sees nothing", async ({ page }) => {
  const serviceRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(SERVICE)) serviceRequests.push(new URL(r.url()).pathname);
  });
  await page.goto("/index.html");
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);
  await expect(overlay(page)).toHaveCount(0);
  expect(serviceRequests).toEqual(["/t.js"]);
  expect(serviceRequests.some((p) => p.startsWith("/api"))).toBe(false);
});

test("reviewer link strips the token and shows the bar", async ({ page }) => {
  await openAsReviewer(page);
  await expect(bar(page)).toContainText("Reviewing");
  await expect(bar(page)).toContainText("0 comments");
  expect(page.url()).not.toContain("ttf");
  expect(new URL(page.url()).pathname).toBe("/index.html");
  await expect(overlay(page).getByRole("link", { name: "Done" })).toHaveAttribute("href", /\/r\/#ttf=/);
});

test("tapping a link drops a pin instead of navigating", async ({ page }) => {
  await openReady(page);
  await page.locator("#other-link").tap();
  await expect(sheet(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe("/index.html");
  await expect(pins(page)).toHaveCount(1);
  await expect(pins(page).first()).toHaveText("1");
  await expect(pins(page).first()).toBeVisible();
  await expect(sheet(page).getByRole("heading", { name: "What should change here?" })).toBeVisible();
  await expect(sheet(page)).toContainText("the link “Read the other page”");
  await expect(sheet(page).locator("textarea")).toBeFocused();
});

test("tapping a form button drops a pin instead of submitting", async ({ page }) => {
  await openReady(page);
  await page.locator("#go").tap();
  await expect(sheet(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe("/index.html");
  await expect(sheet(page)).toContainText("the button “Send the form”");
});

test("hostile host CSS does not reach the overlay", async ({ page }) => {
  await openReady(page);
  await page.locator("h1").tap();
  const heading = sheet(page).getByRole("heading", { name: "What should change here?" });
  await expect(heading).toBeVisible();
  const style = await heading.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: parseFloat(s.fontSize), color: s.color, family: s.fontFamily };
  });
  expect(style.size).toBeGreaterThanOrEqual(21);
  expect(style.color).not.toBe("rgb(255, 0, 0)");
  expect(style.family).not.toContain("Comic Sans");
  for (const sel of ["textarea", "button", "[data-ttf=sub]"]) {
    const size = await sheet(page).locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, sel).toBeGreaterThanOrEqual(17);
  }
  const barSize = await bar(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(barSize).toBeGreaterThanOrEqual(17);
  const barColor = await bar(page).evaluate((el) => getComputedStyle(el).color);
  expect(barColor).not.toBe("rgb(255, 0, 0)");
});

test("the pin lands where the reviewer tapped", async ({ page }) => {
  await openReady(page);
  const box = (await page.locator("h1").boundingBox())!;
  const at = { x: box.x + 30, y: box.y + box.height / 2 };
  await page.touchscreen.tap(at.x, at.y);
  await expect(pins(page)).toHaveCount(1);
  const pin = (await pins(page).first().boundingBox())!;
  expect(Math.abs(pin.x + pin.width / 2 - at.x)).toBeLessThan(3);
  expect(Math.abs(pin.y + pin.height / 2 - at.y)).toBeLessThan(3);
  expect(pin.width).toBeGreaterThanOrEqual(44);
});

test("cancel removes the unsaved pin", async ({ page }) => {
  await openReady(page);
  await page.locator("h1").tap();
  await expect(pins(page)).toHaveCount(1);
  await sheet(page).getByRole("button", { name: "Cancel" }).tap();
  await expect(pins(page)).toHaveCount(0);
  await expect(sheet(page)).toBeHidden();
  await expect(bar(page)).toContainText("0 comments");
});

test("escape cancels the open comment", async ({ page }) => {
  await openReady(page);
  await page.locator("h1").tap();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(pins(page)).toHaveCount(0);
});

test("the sheet never covers the new pin", async ({ page }) => {
  await openReady(page);
  const item = page.locator("#far");
  // Put the paragraph low in the viewport, where the sheet would land on it.
  await page.evaluate(() => {
    const r = document.querySelector("#far")!.getBoundingClientRect();
    window.scrollBy(0, r.top - window.innerHeight * 0.85);
  });
  const box = (await item.boundingBox())!;
  expect(box.y).toBeGreaterThan(844 * 0.55);
  await page.touchscreen.tap(box.x + 10, box.y + box.height / 2);
  await expect(sheet(page)).toBeVisible();
  await page.waitForTimeout(400); // let the slide-up finish
  const pin = (await pins(page).first().boundingBox())!;
  const panel = (await sheet(page).boundingBox())!;
  expect(pin.y + pin.height).toBeLessThanOrEqual(panel.y);
  expect(pin.y).toBeGreaterThan(52);
});

test("unassigned page lets taps through", async ({ page }) => {
  await openAsReviewer(page, "/other.html");
  await expect(bar(page)).toContainText("This page isn't on your review list");
  await expect(overlay(page).getByRole("link", { name: "Back to your list" })).toBeVisible();
  await page.locator("#home-link").tap();
  await page.waitForURL("**/index.html");
});

test("revoked link says so", async ({ page }) => {
  const r = await owner<{ id: string; token: string }>("POST", "/reviewers", { name: "Revoked reviewer" });
  await owner("POST", `/reviewers/${r.id}/revoke`, {});
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("This link no longer works. Ask for a new one.");
  await page.locator("#other-link").tap();
  await page.waitForURL("**/other.html");
});

test("tapping an existing pin opens the read sheet", async ({ page }) => {
  // A separate reviewer, so the saved comments here never change Alexis's counts.
  const r = await owner<{ id: string; token: string }>("POST", "/reviewers", { name: "Reader" });
  await owner("POST", "/assignments", { site: "fixture", reviewer_id: r.id, path: "/index.html", title: "Fixture home" });
  const post = async (data: object) => {
    const form = new FormData();
    form.append("data", JSON.stringify({ site: "fixture", path: "/index.html", device: "phone", viewport_w: 390, viewport_h: 844, ...data }));
    const res = await fetch(`${SERVICE}/api/me/comments`, { method: "POST", headers: { Authorization: `Bearer ${r.token}` }, body: form });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const kept = await post({
    body: "Make the heading friendlier",
    selector: "h1",
    element_text: "Welcome to the fixture",
    element_x: 0.1,
    element_y: 0.5,
    page_x: 40,
    page_y: 60,
  });
  await owner("PATCH", `/comments/${kept}`, { status: "kept", note: "We like it as it is" });
  await post({
    body: "This part went away",
    selector: "#gone",
    element_text: "Text that is no longer on the page",
    element_x: 0.5,
    element_y: 0.5,
    page_x: 200,
    page_y: 300,
  });

  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("2 comments");
  await expect(pins(page)).toHaveCount(2);

  await pins(page).nth(0).tap();
  await expect(sheet(page)).toContainText("Make the heading friendlier");
  await expect(sheet(page)).toContainText("Kept as is");
  await expect(sheet(page)).toContainText("We like it as it is");
  await sheet(page).getByRole("button", { name: "Close" }).tap();
  await expect(sheet(page)).toBeHidden();

  await pins(page).nth(1).tap();
  await expect(sheet(page)).toContainText("This part went away");
  await expect(sheet(page)).toContainText("Open");
  await expect(sheet(page)).toContainText("moved");
  await sheet(page).getByRole("button", { name: "Close" }).tap();
  expect(new URL(page.url()).pathname).toBe("/index.html");
});
