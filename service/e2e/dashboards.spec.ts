import { expect, test, type Page } from "@playwright/test";

const SERVICE = "http://localhost:8788";
const ownerHeaders = () => ({ Authorization: `Bearer ${process.env.TTF_OWNER_TOKEN}`, "Content-Type": "application/json" });

async function owner<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${SERVICE}/api/owner${path}`, {
    method,
    headers: ownerHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

type Reviewer = { id: string; token: string };

/** A fresh reviewer, so these tests never touch the overlay spec's Alexis. */
async function reviewerWith(name: string, pages: { path: string; title: string }[]) {
  const r = await owner<Reviewer>("POST", "/reviewers", { name });
  const ids: string[] = [];
  for (const p of pages) {
    const a = await owner<{ id: string }>("POST", "/assignments", { site: "fixture", reviewer_id: r.id, ...p });
    ids.push(a.id);
  }
  return { ...r, assignmentIds: ids };
}

async function comment(token: string, path: string, body: string): Promise<string> {
  const form = new FormData();
  form.set("data", JSON.stringify({ site: "fixture", path, body }));
  const res = await fetch(`${SERVICE}/api/me/comments`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`comment → ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function markOpened(token: string, id: string): Promise<void> {
  const res = await fetch(`${SERVICE}/api/me/assignments/${id}/opened`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`opened → ${res.status}`);
}

const dashboard = (page: Page, token: string) => page.goto(`${SERVICE}/r/#ttf=${encodeURIComponent(token)}`);
const row = (page: Page, title: string) => page.locator("a[data-assignment]", { hasText: title });

test("reviewer sees their pages with chips", async ({ page }) => {
  const r = await reviewerWith("Dana Chips", [
    { path: "/index.html", title: "Home page" },
    { path: "/other.html", title: "Other page" },
  ]);
  const c = await comment(r.token, "/index.html", "Make the heading bigger");
  await markOpened(r.token, r.assignmentIds[0]);
  await new Promise((res) => setTimeout(res, 20)); // status_changed_at must be later than last_opened_at
  await owner("PATCH", `/comments/${c}`, { status: "done" });

  await dashboard(page, r.token);
  await expect(page.getByRole("heading", { name: "Hi Dana." })).toBeVisible();
  await expect(row(page, "Home page")).toContainText("Updated since you looked");
  await expect(row(page, "Home page")).toContainText("1 comment · 1 settled");
  await expect(row(page, "Other page")).toContainText("New");
  await expect(row(page, "Other page")).toContainText("No comments yet");
  // One site: no site headings.
  await expect(page.locator("[data-site-heading]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("tapping a row marks it opened and goes to the page with ttf", async ({ page }) => {
  const r = await reviewerWith("Dana Tap", [{ path: "/other.html", title: "Other page" }]);
  await dashboard(page, r.token);
  const opened = page.waitForRequest(
    (req) => req.method() === "POST" && req.url() === `${SERVICE}/api/me/assignments/${r.assignmentIds[0]}/opened`,
  );
  await row(page, "Other page").click();
  const req = await opened;
  expect(req.headers()["authorization"]).toBe(`Bearer ${r.token}`);
  await page.waitForURL((u) => u.origin === "http://localhost:4173" && u.pathname === "/other.html");
  await expect(page.locator("tap-to-fix-overlay [data-ttf=bar]")).toContainText("Reviewing");

  // Back on the dashboard the page is no longer New.
  await dashboard(page, r.token);
  await expect(row(page, "Other page")).not.toContainText("New");
});

test("hash token survives reload and is kept in the address bar", async ({ page }) => {
  const r = await reviewerWith("Dana Reload", [{ path: "/index.html", title: "Home page" }]);
  await dashboard(page, r.token);
  await expect(row(page, "Home page")).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#ttf=${r.token}`);
  await page.reload();
  await expect(row(page, "Home page")).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#ttf=${r.token}`);
  // Without the hash, the stored token still works and the hash comes back.
  await page.goto(`${SERVICE}/r/`);
  await expect(row(page, "Home page")).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#ttf=${r.token}`);
});

test("revoked link shows the plain sentence", async ({ page }) => {
  const r = await reviewerWith("Dana Revoked", [{ path: "/index.html", title: "Home page" }]);
  await owner("POST", `/reviewers/${r.id}/revoke`);
  await dashboard(page, r.token);
  await expect(page.getByText("This link no longer works. Ask for a new one.")).toBeVisible();
  await expect(row(page, "Home page")).toHaveCount(0);
});

// ---- Owner dashboard (/o/) ----

const OWNER_URL = () => `${SERVICE}/o/#owner=${encodeURIComponent(process.env.TTF_OWNER_TOKEN!)}`;
const ownerRow = (page: Page, title: string) => page.locator("tr[data-row]", { hasText: title });
const reviewerButton = (page: Page, name: string) => page.locator("button.rv", { hasText: name });

/** Accepts the next confirm() and resolves to its message. */
function acceptNextDialog(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.once("dialog", (d) => {
      resolve(d.message());
      void d.accept();
    });
  });
}

test("owner adds a site, a reviewer and an assignment", async ({ page }) => {
  await page.goto(OWNER_URL());
  // The owner token does not stay in the address bar.
  await expect(page.getByRole("heading", { name: "Reviewers" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");

  await page.locator("[data-adder=site] > summary").click();
  const site = page.locator("form[data-form=site]");
  await site.getByLabel("Slug").fill("fixture-ui");
  await site.getByLabel("Name").fill("Fixture UI");
  await site.getByLabel("Origin").fill("http://localhost:4173");
  await site.getByLabel("Repo").fill("workingBen/fixture");
  await site.getByRole("button", { name: "Add site" }).click();
  await expect(page.locator(".site-row", { hasText: "Fixture UI" })).toBeVisible();

  // A service error shows next to the form that failed, and the form keeps its values.
  await page.locator("[data-adder=site] > summary").click();
  await site.getByLabel("Slug").fill("fixture-ui");
  await site.getByLabel("Name").fill("Again");
  await site.getByLabel("Origin").fill("http://localhost:4173");
  await site.getByLabel("Repo").fill("workingBen/fixture");
  await site.getByRole("button", { name: "Add site" }).click();
  await expect(site.locator("[data-error]")).toHaveText("Site slug already exists");
  await expect(site.getByLabel("Name")).toHaveValue("Again");

  await page.locator("[data-adder=reviewer] > summary").click();
  await page.locator("form[data-form=reviewer]").getByLabel("Name").fill("Morgan Owner");
  await page.locator("form[data-form=reviewer]").getByRole("button", { name: "Add" }).click();
  const flash = page.locator("[data-flash]");
  await expect(flash).toContainText("Text this link to Morgan");
  const link = (await flash.locator("[data-flash-url]").textContent())!.trim();
  expect(link).toMatch(new RegExp(`^${SERVICE}/r/#ttf=.+`));

  // The new reviewer is selected, so the assign form defaults to Morgan.
  await page.locator("[data-adder=assign] > summary").click();
  const assign = page.locator("form[data-form=assign]");
  await assign.getByLabel("Site").selectOption("fixture-ui");
  await expect(assign.getByLabel("Reviewer")).toHaveValue(/.+/);
  expect(await assign.getByLabel("Reviewer").locator("option:checked").textContent()).toBe("Morgan Owner");
  await assign.getByLabel("Path").fill("/other.html");
  await assign.getByLabel("Title").fill("Owner page");
  await assign.getByRole("button", { name: "Assign" }).click();
  await expect(ownerRow(page, "Owner page")).toContainText("Not started");
  await expect(ownerRow(page, "Owner page").getByRole("link", { name: "Page" })).toHaveAttribute("href", "http://localhost:4173/other.html");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const reviewerPage = await page.context().newPage();
  await reviewerPage.goto(link);
  await expect(reviewerPage.getByRole("heading", { name: "Hi Morgan." })).toBeVisible();
  await expect(row(reviewerPage, "Owner page")).toBeVisible();
});

test("ready box shows the command", async ({ page }) => {
  const r = await reviewerWith("Quinn Ready", [{ path: "/other.html", title: "Ready page" }]);
  await comment(r.token, "/other.html", "Fix the spacing");
  await page.goto(OWNER_URL());
  const box = page.locator("[data-ready]", { hasText: "Quinn has 1 comment ready for a review cycle on Fixture" });
  await expect(box).toBeVisible();
  await expect(box.locator("code")).toHaveText("/tap-to-fix:fix quinn fixture");
  await expect(ownerRow(page, "Ready page")).toContainText("Open");
});

test("reissue asks first and the old link stops working", async ({ page }) => {
  const r = await reviewerWith("Riley Reissue", [{ path: "/index.html", title: "Reissue page" }]);
  await page.goto(OWNER_URL());
  await reviewerButton(page, "Riley Reissue").click();
  await expect(ownerRow(page, "Reissue page")).toBeVisible();

  // Dismissing changes nothing.
  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("button", { name: "New link" }).click();
  await expect(page.locator("[data-flash]")).toHaveCount(0);

  const message = acceptNextDialog(page);
  await page.getByRole("button", { name: "New link" }).click();
  expect(await message).toBe("Make a new link for Riley? Riley's old link stops working.");
  await expect(page.locator("[data-flash]")).toContainText("Text this link to Riley");
  const fresh = (await page.locator("[data-flash-url]").textContent())!.trim();

  const old = await page.context().newPage();
  await dashboard(old, r.token);
  await expect(old.getByText("This link no longer works. Ask for a new one.")).toBeVisible();
  // A new tab, because going from one /r/#ttf= link to another only changes the hash.
  const renewed = await page.context().newPage();
  await renewed.goto(fresh);
  await expect(row(renewed, "Reissue page")).toBeVisible();
});

test("turning off a link asks first and says Link off", async ({ page }) => {
  await reviewerWith("Toby Revoke", [{ path: "/index.html", title: "Revoke page" }]);
  await page.goto(OWNER_URL());
  await reviewerButton(page, "Toby Revoke").click();
  const message = acceptNextDialog(page);
  await page.getByRole("button", { name: "Turn off link" }).click();
  expect(await message).toBe("Turn off Toby's link? Toby won't be able to review until you make a new one.");
  await expect(reviewerButton(page, "Toby Revoke")).toContainText("Link off");
  await expect(page.getByRole("button", { name: "Turn off link" })).toHaveCount(0);
});

test("remove asks with the comment count", async ({ page }) => {
  const r = await reviewerWith("Sam Remove", [{ path: "/other.html", title: "Remove me" }]);
  await comment(r.token, "/other.html", "One");
  await comment(r.token, "/other.html", "Two");
  await page.goto(OWNER_URL());
  const message = acceptNextDialog(page);
  await ownerRow(page, "Remove me").getByRole("button", { name: "Remove Remove me from Sam's list" }).click();
  expect(await message).toBe("Remove “Remove me” from Sam's list? Its 2 comments are deleted too.");
  await expect(ownerRow(page, "Remove me")).toHaveCount(0);
});

test("wrong owner token shows the token form", async ({ page }) => {
  await page.goto(`${SERVICE}/o/#owner=not-the-token`);
  await expect(page.getByRole("heading", { name: "Paste your owner token" })).toBeVisible();
  await page.getByLabel("Owner token").fill(process.env.TTF_OWNER_TOKEN!);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "Reviewers" })).toBeVisible();
});
