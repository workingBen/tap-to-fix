import { expect, test, type Page } from "@playwright/test";

const SERVICE = "http://localhost:8788";
/** The overlay's wait for the screenshot before it saves without one (index.ts SHOT_WAIT_MS). */
const SHOT_WAIT_MS = 12_000;
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

/** Opens a page the way a reviewer's link does: the token rides in the fragment. */
async function openAsReviewer(page: Page, path = "/index.html", t = token()): Promise<void> {
  // A fragment-only change is a same-document navigation; start from blank so it really loads.
  if (page.url() !== "about:blank") await page.goto("about:blank");
  await page.goto(`${path}#ttf=${encodeURIComponent(t)}`);
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

test("the older ?ttf= link still works and is stripped too", async ({ page }) => {
  await page.goto(`/index.html?keep=1&ttf=${encodeURIComponent(token())}#top`);
  await expect(bar(page)).toContainText("Reviewing");
  const url = new URL(page.url());
  expect(page.url()).not.toContain("ttf");
  expect(url.search + url.hash).toBe("?keep=1#top");
});

test("an empty ttf= counts as no token", async ({ page }) => {
  await page.goto("/index.html#ttf=");
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);
  await expect(overlay(page)).toHaveCount(0);
  expect(page.url()).not.toContain("ttf");
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
  expect(pin.width).toBeGreaterThanOrEqual(44);
  expect(pin.height).toBeGreaterThanOrEqual(44);
  // The tail's point (the 1px svg origin) is the tap spot.
  const pt = (await pins(page).first().locator("svg").boundingBox())!;
  expect(Math.abs(pt.x - at.x)).toBeLessThan(6);
  expect(Math.abs(pt.y - at.y)).toBeLessThan(6);
  // The body sits well above the point, so the line of text at the tap stays readable.
  const dot = (await pins(page).first().locator(".dot").boundingBox())!;
  expect(dot.y + dot.height).toBeLessThanOrEqual(at.y - 10);
  expect(dot.x).toBeGreaterThanOrEqual(at.x - 6);
  // 8px left of the tap point is not the pin (a draft is pointer-events:none, so the box check above counts too).
  const hit = await page.evaluate(({ x, y }) => {
    const hitEl = document.querySelector("tap-to-fix-overlay")?.shadowRoot?.elementFromPoint(x - 8, y);
    return hitEl ? hitEl.closest("[data-ttf=pin]") !== null : false;
  }, at);
  expect(hit).toBe(false);
});

test("near the right edge the pin leans left and stays on screen", async ({ page }) => {
  await openReady(page);
  const vw = page.viewportSize()!.width;
  const box = (await page.locator("h1").boundingBox())!;
  const at = { x: vw - 12, y: box.y + box.height / 2 };
  await page.touchscreen.tap(at.x, at.y);
  await expect(pins(page)).toHaveCount(1);
  await expect(pins(page).first()).toHaveClass(/flip/);
  const pt = (await pins(page).first().locator("svg").boundingBox())!;
  expect(Math.abs(pt.x - at.x)).toBeLessThan(6);
  expect(Math.abs(pt.y - at.y)).toBeLessThan(6);
  const dot = (await pins(page).first().locator(".dot").boundingBox())!;
  expect(dot.x + dot.width).toBeLessThanOrEqual(vw);
  expect(dot.x + dot.width).toBeLessThanOrEqual(at.x + 6);
  const pin = (await pins(page).first().boundingBox())!;
  expect(pin.x + pin.width).toBeLessThanOrEqual(vw);
});

test("a page touchend preventDefault still lets a tap drop a pin", async ({ page }) => {
  await openReady(page);
  await page.evaluate(() => {
    // Runs before the overlay's document listeners, and suppresses the tap's click.
    window.addEventListener("touchend", (e) => e.preventDefault(), { capture: true, passive: false });
    // The page's own handlers must not see a review tap.
    const h1 = document.querySelector("h1")!;
    for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup", "click"]) {
      h1.addEventListener(type, () => (document.body.dataset["saw" + type] = "1"));
    }
  });
  await page.locator("h1").tap();
  await expect(pins(page)).toHaveCount(1);
  await expect(sheet(page)).toBeVisible();
  expect(await page.evaluate(() => Object.keys(document.body.dataset).filter((k) => k.startsWith("saw")))).toEqual([]);
});

test("a scroll gesture drops no pin and still scrolls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.browserName !== "chromium", "touch drag through CDP");
  await openReady(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: 200, y, id: 1 }],
    });
  await touch("touchStart", 600);
  for (let y = 590; y >= 300; y -= 10) await touch("touchMove", y);
  await touch("touchEnd", 300);
  await page.waitForTimeout(500);
  await expect(pins(page)).toHaveCount(0);
  await expect(sheet(page)).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
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

test("typing in the comment box does not trigger page shortcuts", async ({ page }) => {
  await openReady(page);
  // The fixture's shortcut reacts to "/", "j" and space outside of fields.
  await page.keyboard.press("j");
  expect(await page.evaluate(() => document.body.dataset.shortcut)).toBe("j");
  await page.evaluate(() => delete document.body.dataset.shortcut);
  await page.locator("h1").tap();
  const box = sheet(page).locator("textarea");
  await expect(box).toBeFocused();
  await page.keyboard.type("j / k and more");
  await expect(box).toHaveValue("j / k and more");
  const seen = await page.evaluate(() => ({ ...document.body.dataset }));
  expect(seen.shortcut).toBeUndefined();
  expect(seen.pageInput).toBeUndefined();
  // The overlay's own Escape still works (it asks first, since text was typed).
  page.once("dialog", (d) => void d.accept());
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
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

test("a Turbo-style body swap restarts the overlay for the new path", async ({ page }) => {
  const r = await freshReviewer("Turbo traveler");
  const form = new FormData();
  form.append(
    "data",
    JSON.stringify({
      site: "fixture",
      path: "/index.html",
      device: "phone",
      viewport_w: 390,
      viewport_h: 844,
      body: "Saved before the swap",
      selector: "h1",
      element_text: "Welcome to the fixture",
      element_x: 0.1,
      element_y: 0.5,
      page_x: 40,
      page_y: 60,
    }),
  );
  const res = await fetch(`${SERVICE}/api/me/comments`, { method: "POST", headers: { Authorization: `Bearer ${r.token}` }, body: form });
  expect(res.status).toBe(201);

  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("1 comment");
  await expect(pins(page)).toHaveCount(1);
  const original = await page.evaluate(() => document.body.outerHTML);

  // Turbo Drive: push the new URL, replace <body>, fire turbo:load. t.js does not run again.
  const swap = (path: string, html: string) =>
    page.evaluate(
      ([p, h]) => {
        history.pushState({}, "", p);
        const next = new DOMParser().parseFromString(`<!doctype html><html>${h}</html>`, "text/html").body;
        document.body.replaceWith(document.adoptNode(next));
        document.dispatchEvent(new Event("turbo:load", { bubbles: true }));
      },
      [path, html],
    );
  await swap(
    "/other.html",
    '<body><div style="height: 200px"></div><h1>The other page</h1><button id="b" type="button" onclick="document.body.dataset.clicked=1">Press</button></body>',
  );
  await expect(bar(page)).toContainText("This page isn't on your review list");
  await expect(overlay(page)).toHaveCount(1);
  await expect(pins(page)).toHaveCount(0);
  await page.locator("#b").tap();
  await expect.poll(() => page.evaluate(() => document.body.dataset.clicked)).toBe("1");
  await expect(sheet(page)).toBeHidden();

  await swap("/index.html", original);
  await expect(bar(page)).toContainText("1 comment");
  await expect(overlay(page)).toHaveCount(1);
  await expect(pins(page)).toHaveCount(1);
  await page.locator("#intro").tap();
  await expect(sheet(page)).toBeVisible();
  await expect(pins(page)).toHaveCount(2);
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
    body: '<img src=x onerror="document.body.dataset.xss=1">',
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
  await expect(sheet(page).locator(".status")).toHaveText("Kept as is");
  const settledColor = await pins(page).nth(0).locator(".body").evaluate((el) => getComputedStyle(el).fill);
  expect(settledColor).toMatch(/0\.309804 \/ 0\.8\)|rgba\(47, 107, 79, 0\.8\)/); // --acc at 80%
  await expect(sheet(page)).toContainText("We like it as it is");
  await sheet(page).getByRole("button", { name: "Close" }).tap();
  await expect(sheet(page)).toBeHidden();

  await pins(page).nth(1).tap();
  await expect(sheet(page).locator(".body")).toHaveText('<img src=x onerror="document.body.dataset.xss=1">');
  await expect(sheet(page).locator(".status")).toHaveText("Open");
  await expect(sheet(page).locator(".note")).toHaveCount(0);
  await expect(sheet(page)).toContainText("moved");
  expect(await page.evaluate(() => document.body.dataset.xss)).toBeUndefined();
  await sheet(page).getByRole("button", { name: "Close" }).tap();
  expect(new URL(page.url()).pathname).toBe("/index.html");
});

test("cancel asks before throwing away typed text", async ({ page }) => {
  await openReady(page);
  await page.locator("h1").tap();
  const box = sheet(page).locator("textarea");
  await box.fill("Half a thought");

  // Dismissed: nothing is lost.
  const asked: string[] = [];
  page.once("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await sheet(page).getByRole("button", { name: "Cancel" }).tap();
  expect(asked).toEqual(["Discard this comment?"]);
  await expect(sheet(page)).toBeVisible();
  await expect(box).toHaveValue("Half a thought");
  await expect(pins(page)).toHaveCount(1);

  // Escape asks too; accepting discards the draft.
  page.once("dialog", (d) => {
    asked.push(d.message());
    void d.accept();
  });
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(pins(page)).toHaveCount(0);
  expect(asked).toEqual(["Discard this comment?", "Discard this comment?"]);
});

// ---- Saving. Each test gets its own reviewer, so counts never depend on test order. ----

async function freshReviewer(name: string): Promise<{ id: string; token: string }> {
  const r = await owner<{ id: string; token: string }>("POST", "/reviewers", { name });
  await owner("POST", "/assignments", { site: "fixture", reviewer_id: r.id, path: "/index.html", title: "Fixture home" });
  return r;
}

type BatchComment = {
  id: string;
  body: string;
  selector: string | null;
  element_text: string | null;
  device: string | null;
  viewport_w: number | null;
  has_screenshot: boolean;
};

async function batch(reviewerId: string): Promise<BatchComment[]> {
  const res = await fetch(`${SERVICE}/api/owner/batch?reviewer=${reviewerId}&site=fixture&status=open`, {
    headers: ownerHeaders(),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { comments: BatchComment[] }).comments;
}

test("a lazy image below the fold does not hold up the screenshot", async ({ page }, testInfo) => {
  const touch = !!testInfo.project.use.hasTouch;
  const press = (l: ReturnType<Page["locator"]>) => (touch ? l.tap() : l.click());
  const r = await freshReviewer(`Lazy ${testInfo.project.name}`);
  await openAsReviewer(page, "/index.html", r.token);
  await press(page.locator("h1"));
  await sheet(page).locator("textarea").fill("Check the lazy image");
  const save = sheet(page).getByRole("button", { name: "Save comment" });
  const started = Date.now();
  await press(save);
  await expect(bar(page)).toContainText("Saved");
  expect(Date.now() - started).toBeLessThan(6000);
  const [c] = await batch(r.id);
  expect(c.has_screenshot).toBe(true);
});

test("saving records the spot and a screenshot", async ({ page }, testInfo) => {
  const touch = !!testInfo.project.use.hasTouch;
  const press = (l: ReturnType<Page["locator"]>) => (touch ? l.tap() : l.click());
  const r = await freshReviewer(`Saver ${testInfo.project.name}`);
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("0 comments");
  const heading = ((await page.locator("h1").textContent()) ?? "").trim();

  await press(page.locator("h1"));
  const save = sheet(page).getByRole("button", { name: "Save comment" });
  await expect(save).toBeDisabled(); // nothing typed yet
  await sheet(page).locator("textarea").fill("Make this bigger");
  await expect(save).toBeEnabled();
  await press(save);

  await expect(bar(page)).toContainText("1 comment");
  await expect(bar(page)).toContainText("Saved");
  await expect(sheet(page)).toBeHidden();
  await expect(pins(page)).toHaveCount(1);
  await expect(pins(page).first()).not.toHaveClass(/new/);

  const [c] = await batch(r.id);
  expect(c.body).toBe("Make this bigger");
  expect(await page.evaluate((sel) => document.querySelector(sel!) === document.querySelector("h1"), c.selector)).toBe(true);
  expect(c.element_text!.startsWith(heading.slice(0, 20))).toBe(true);
  const vw = testInfo.project.use.viewport!.width;
  expect(c.device).toBe(vw < 768 ? "phone" : "desktop");
  expect(c.viewport_w).toBe(vw);
  expect(c.has_screenshot).toBe(true);

  const shot = await fetch(`${SERVICE}/api/owner/comments/${c.id}/screenshot`, { headers: ownerHeaders() });
  expect(shot.status).toBe(200);
  const type = shot.headers.get("content-type") ?? "";
  expect(["image/webp", "image/jpeg"]).toContain(type);
  const bytes = Buffer.from(await shot.arrayBuffer());
  expect(bytes.length).toBeLessThanOrEqual(1_048_576);
  const width = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas.width;
  }, `data:${type};base64,${bytes.toString("base64")}`);
  expect(width).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(1200);
  // A high-density phone gets a sharp image (about 1170 px for 390 px at 3x), not a 390 px one.
  if ((testInfo.project.use.deviceScaleFactor ?? 1) > 1) expect(width).toBeGreaterThan(vw);

  await expect(bar(page)).not.toContainText("Saved", { timeout: 5000 });
});

test("cross-origin image does not block saving", async ({ page }) => {
  const r = await freshReviewer("Photo saver");
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("Reviewing");
  await page.locator("#photo").evaluate((img: HTMLImageElement) => img.decode().catch(() => {}));
  await expect(page.locator("#photo")).toBeInViewport();
  await page.locator("#photo").tap();
  await sheet(page).locator("textarea").fill("Swap this photo");
  await sheet(page).getByRole("button", { name: "Save comment" }).tap();
  await expect(bar(page)).toContainText("1 comment", { timeout: 20_000 });
  const comments = await batch(r.id);
  expect(comments.map((c) => c.body)).toEqual(["Swap this photo"]);
});

test("screenshot failure still saves the comment", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null);
    };
  });
  const r = await freshReviewer("No screenshot");
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("Reviewing");
  await page.locator("h1").tap();
  await sheet(page).locator("textarea").fill("Still saved");
  await sheet(page).getByRole("button", { name: "Save comment" }).tap();
  await expect(bar(page)).toContainText("1 comment");
  const [c] = await batch(r.id);
  expect(c.body).toBe("Still saved");
  expect(c.has_screenshot).toBe(false);
});

test("network failure keeps the text", async ({ page }) => {
  const r = await freshReviewer("Offline saver");
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("Reviewing");
  // Fail slowly, so the busy state can be seen.
  await page.route("**/api/me/comments", async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.abort();
  });
  await page.locator("h1").tap();
  const box = sheet(page).locator("textarea");
  await box.fill("Do not lose me");
  const save = sheet(page).locator("[data-ttf=save]");
  await save.tap();
  await expect(save).toHaveText("Saving…");
  await expect(save).toBeDisabled();
  await expect(sheet(page).getByRole("button", { name: "Cancel" })).toBeDisabled();
  const warning = sheet(page).locator("[data-ttf=save-error]");
  await expect(warning).toHaveText("Couldn't save. Check your connection and try again.");
  const colors = await warning.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, bg: s.backgroundColor };
  });
  expect(colors).toEqual({ color: "rgb(154, 91, 19)", bg: "rgb(251, 239, 217)" }); // --warn on --warn-bg
  await expect(sheet(page)).toBeVisible();
  await expect(box).toHaveValue("Do not lose me");
  await expect(save).toBeEnabled();
  await expect(save).toHaveText("Save comment");
  await expect(bar(page)).toContainText("0 comments");

  await page.unroute("**/api/me/comments");
  await save.tap();
  await expect(bar(page)).toContainText("1 comment");
  await expect(sheet(page)).toBeHidden();
  expect((await batch(r.id)).map((c) => c.body)).toEqual(["Do not lose me"]);
});

test("a save the service refuses says why, and keeps the text", async ({ page }) => {
  const r = await freshReviewer("Refused saver");
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("Reviewing");
  await page.locator("h1").tap();
  const box = sheet(page).locator("textarea");
  await box.fill("Keep me through refusals");
  const save = sheet(page).locator("[data-ttf=save]");
  const warning = sheet(page).locator("[data-ttf=save-error]");
  for (const [status, text] of [
    [401, "This link no longer works. Ask for a new one."],
    [403, "This page isn't on your review list."],
    [500, "Couldn't save. Check your connection and try again."],
  ] as const) {
    await page.route("**/api/me/comments", (route) => route.fulfill({ status, body: "{}" }));
    await save.tap();
    await expect(warning).toHaveText(text);
    await expect(box).toHaveValue("Keep me through refusals");
    await expect(save).toBeEnabled();
    await page.unroute("**/api/me/comments");
  }
  await expect(bar(page)).toContainText("0 comments");
});

test("saved pins come back after reload", async ({ page }) => {
  const r = await freshReviewer("Reloader");
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("Reviewing");
  const box = (await page.locator("h1").boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.touchscreen.tap(at.x, at.y);
  await sheet(page).locator("textarea").fill("Come back after reload");
  await sheet(page).getByRole("button", { name: "Save comment" }).tap();
  await expect(bar(page)).toContainText("1 comment");

  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("1 comment");
  await expect(pins(page)).toHaveCount(1);
  // Pins are re-laid out as the page settles (image load, fonts), so poll the distance.
  await expect
    .poll(async () => {
      const pt = await pins(page).first().locator("svg").boundingBox();
      return pt ? Math.hypot(pt.x - at.x, pt.y - at.y) : Infinity;
    })
    .toBeLessThan(40);
  await pins(page).first().tap();
  await expect(sheet(page)).toContainText("Come back after reload");
  await expect(sheet(page).locator(".status")).toHaveText("Open");
});

test("a save that never answers times out and keeps the text", async ({ page }) => {
  // The page clock lets the overlay's 30 s save timeout pass without waiting for it.
  await page.clock.install();
  const r = await freshReviewer("Hung saver");
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("Reviewing");
  let sent!: () => void;
  const inFlight = new Promise<void>((resolve) => (sent = resolve));
  await page.route("**/api/me/comments", () => {
    // Never fulfilled: the request hangs until the overlay gives up on it.
    sent();
  });
  await page.locator("h1").tap();
  const box = sheet(page).locator("textarea");
  await box.fill("Still here after a hang");
  const save = sheet(page).locator("[data-ttf=save]");
  await save.tap();
  await expect(save).toHaveText("Saving…");
  // The screenshot can take a moment at 3x; once it lands the POST starts its 30 s timer.
  await page.clock.fastForward(SHOT_WAIT_MS);
  await inFlight;
  await page.waitForTimeout(300);
  await expect(save).toHaveText("Saving…"); // still waiting on the hung request

  await page.clock.fastForward(30_000);
  await expect(sheet(page).locator("[data-ttf=save-error]")).toHaveText(
    "Couldn't save. Check your connection and try again.",
  );
  await expect(box).toHaveValue("Still here after a hang");
  await expect(save).toBeEnabled();
  await expect(sheet(page).getByRole("button", { name: "Cancel" })).toBeEnabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await save.tap();
  await expect(bar(page)).toContainText("1 comment");
  await expect(sheet(page)).toBeHidden();
  expect((await batch(r.id)).map((c) => c.body)).toEqual(["Still here after a hang"]);
});

test("the Saved notice uses one lasting live region", async ({ page }) => {
  const r = await freshReviewer("Announcer");
  await openAsReviewer(page, "/index.html", r.token);
  await expect(bar(page)).toContainText("Reviewing");
  const live = bar(page).locator("[role=status]");
  await expect(live).toHaveCount(1);
  await expect(live).toHaveText("");
  const before = await live.elementHandle();
  await page.locator("h1").tap();
  await sheet(page).locator("textarea").fill("Announce me");
  await sheet(page).getByRole("button", { name: "Save comment" }).tap();
  await expect(live).toHaveText("Saved");
  await expect(bar(page)).toContainText("1 comment");
  expect(await live.evaluate((el, b) => el === b, before)).toBe(true);
});
