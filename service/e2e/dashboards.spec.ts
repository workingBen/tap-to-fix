import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

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
  const res = await fetch(`${SERVICE}/api/me/comments`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: "http://localhost:4173" }, body: form });
  if (!res.ok) throw new Error(`comment → ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function markOpened(token: string, id: string): Promise<void> {
  const res = await fetch(`${SERVICE}/api/me/assignments/${id}/opened`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`opened → ${res.status}`);
}

const dashboard = (page: Page, token: string) => page.goto(`${SERVICE}/r/#ttf=${encodeURIComponent(token)}`);
const row = (scope: Page | Locator, title: string) => scope.locator("a[data-assignment]", { hasText: title });

test("reviewer sees their pages in sections", async ({ page }) => {
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
  const updated = page.locator("section[data-section=updated]");
  await expect(updated.locator("h2")).toHaveText("Updated since you looked 1");
  await expect(row(updated, "Home page")).toContainText("1 comment · 1 settled");
  await expect(row(updated, "Home page")).toContainText("All done");
  const fresh = page.locator("section[data-section=new]");
  await expect(fresh.locator("h2")).toHaveText("New 1");
  await expect(row(fresh, "Other page")).toContainText("No comments yet");
  // One site: the rows do not repeat its name.
  await expect(row(page, "Other page").locator(".where")).toHaveText("· /other.html");
  // The fixed comment is in the notice until Got it.
  const notice = page.locator("[data-notice]");
  await expect(notice.locator("a.li")).toHaveText(["Home page1 fixed"]);
  const ack = page.waitForResponse((res) => res.url() === `${SERVICE}/api/me/acknowledge` && res.status() === 204);
  await notice.getByRole("button", { name: "Got it" }).click();
  await ack;
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(row(page, "Home page")).toBeVisible();
  await expect(page.locator("[data-notice]")).toHaveCount(0);
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
  await expect(row(page.locator("section[data-section=seen]"), "Other page")).toBeVisible();
  await expect(page.locator("section[data-section=new]")).toHaveCount(0);
});

test("Review complete moves a page to Finished, and Re-review brings it back", async ({ page }) => {
  const r = await reviewerWith("Dana Finish", [
    { path: "/index.html", title: "Home page" },
    { path: "/other.html", title: "Other page" },
  ]);
  await dashboard(page, r.token);
  await page.getByRole("button", { name: "Actions for Home page" }).click();
  const sheet = page.getByRole("dialog", { name: "Home page" });
  await sheet.getByRole("button", { name: "Review complete" }).click();
  await expect(sheet).toHaveCount(0);
  const finished = page.locator("details[data-section=finished]");
  await expect(finished.locator("summary")).toHaveText("Finished 1");
  await expect(row(finished, "Home page")).toBeHidden();
  await page.reload();
  await finished.locator("summary").click();
  await finished.getByRole("button", { name: "Re-review" }).click();
  await expect(row(page.locator("section[data-section=new]"), "Home page")).toBeVisible();
  await expect(finished).toHaveCount(0);
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
const ownerRow = (page: Page, title: string) => page.locator("[data-row]", { hasText: title });
/** One reviewer's column, found by the name in its header. */
const column = (page: Page, name: string) =>
  page.locator("[data-person]").filter({ has: page.locator(".pname", { hasText: new RegExp(`^${name}$`) }) });

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
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");

  await page.locator("[data-adder=site] > summary").click();
  const site = page.locator("form[data-form=site]");
  await site.getByLabel("Slug").fill("fixture-ui");
  await site.getByLabel("Name").fill("Fixture UI");
  await site.getByLabel("Origin").fill("http://localhost:4173");
  await site.getByLabel("Repo").fill("workingBen/fixture");
  await site.getByRole("button", { name: "Add site" }).click();
  await expect(page.locator("[data-sites] .siterow", { hasText: "Fixture UI" })).toContainText("localhost:4173 · 0 pages");

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
  // The link flash shows in Morgan's own column.
  const morgan = column(page, "Morgan Owner");
  const flash = morgan.locator("[data-flash]");
  await expect(flash).toContainText("Text this link to Morgan");
  const link = (await flash.locator("[data-flash-url]").textContent())!.trim();
  expect(link).toMatch(new RegExp(`^${SERVICE}/r/#ttf=.+`));

  await morgan.getByRole("button", { name: "Assign a page to Morgan" }).click();
  const assign = page.getByRole("dialog", { name: "Assign pages" });
  await assign.getByRole("button", { name: "A page that isn't listed" }).click();
  await assign.getByLabel("Site").selectOption("fixture-ui");
  await assign.getByLabel("Path").fill("/other.html");
  await assign.getByLabel("Title").fill("Owner page");
  await assign.getByRole("button", { name: "Assign 1 page to Morgan" }).click();
  await expect(morgan.locator("[data-row]", { hasText: "Owner page" })).toContainText("Not started");
  await expect(morgan.locator("[data-row]", { hasText: "Owner page" })).toContainText("No comments yet");
  await expect(assign).toHaveCount(0);
  await expect(ownerRow(page, "Owner page").getByRole("link", { name: "Page", exact: true })).toHaveAttribute("href", "http://localhost:4173/other.html");
  // Review opens the same page as Morgan: the new link's token is already known, so it is a plain href.
  const token = link.slice(link.indexOf("#ttf=") + 5);
  await expect(ownerRow(page, "Owner page").getByRole("link", { name: "Review", exact: true })).toHaveAttribute("href", `http://localhost:4173/other.html#ttf=${token}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const reviewerPage = await page.context().newPage();
  await reviewerPage.goto(link);
  await expect(reviewerPage.getByRole("heading", { name: "Hi Morgan." })).toBeVisible();
  await expect(row(reviewerPage, "Owner page")).toBeVisible();
});

test("the Ready to fix strip at the top shows the reviewer's command", async ({ page }) => {
  const r = await reviewerWith("Quinn Ready", [{ path: "/other.html", title: "Ready page" }]);
  await comment(r.token, "/other.html", "Fix the spacing");
  await page.goto(OWNER_URL());
  const quinn = column(page, "Quinn Ready");
  await expect(quinn.locator(".person-h")).toContainText("link on");
  const strip = page.locator(".readybox [data-ready]", { hasText: "Quinn · 1 open on Fixture" });
  await expect(strip).toBeVisible();
  await expect(strip.locator("code")).toHaveText("/tap-to-fix:fix quinn fixture");
  await expect(strip.getByRole("button", { name: "Copy" })).toBeVisible();
  await expect(ownerRow(page, "Ready page")).toContainText("Open");
  await expect(ownerRow(page, "Ready page")).toContainText("1 open");
});

test("ready box downloads a batch file that matches the count", async ({ page }) => {
  const r = await reviewerWith("Dana Download", [{ path: "/other.html", title: "Download page" }]);
  await comment(r.token, "/other.html", "First");
  await comment(r.token, "/other.html", "Second");
  await page.goto(OWNER_URL());
  const dana = column(page, "Dana Download");
  await expect(page.locator(".readybox [data-ready]", { hasText: "Dana Download" })).toContainText("Dana Download · 2 open on Fixture");
  await dana.getByLabel("More for Dana").click();
  const btn = dana.getByRole("button", { name: "Download batch file for Fixture" });
  await expect(btn).toBeVisible();
  await expect(dana.locator(".menu")).toContainText("For when the network is blocked: ttf batch --from reads it.");
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const [download] = await Promise.all([page.waitForEvent("download"), btn.click()]);
  expect(download.suggestedFilename()).toMatch(/^tap-to-fix-fixture-dana-download-\d{8}\.json$/);
  const file = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(file.comments).toHaveLength(2);
  expect(file.reviewer.name).toBe("Dana Download");
});

test("reissue asks first and the old link stops working", async ({ page }) => {
  const r = await reviewerWith("Riley Reissue", [{ path: "/index.html", title: "Reissue page" }]);
  await page.goto(OWNER_URL());
  const riley = column(page, "Riley Reissue");
  await expect(riley.locator("[data-row]", { hasText: "Reissue page" })).toBeVisible();

  // Dismissing changes nothing.
  page.once("dialog", (d) => void d.dismiss());
  await riley.getByLabel("More for Riley").click();
  await riley.getByRole("button", { name: "New link" }).click();
  await expect(page.locator("[data-flash]")).toHaveCount(0);

  const message = acceptNextDialog(page);
  if (!(await riley.getByRole("button", { name: "New link" }).isVisible())) await riley.getByLabel("More for Riley").click();
  await riley.getByRole("button", { name: "New link" }).click();
  expect(await message).toBe("Make a new link for Riley? Riley's old link stops working.");
  await expect(riley.locator("[data-flash]")).toContainText("Text this link to Riley");
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
  const toby = column(page, "Toby Revoke");
  await toby.getByLabel("More for Toby").click();
  const message = acceptNextDialog(page);
  await toby.getByRole("button", { name: "Turn off link" }).click();
  expect(await message).toBe("Turn off Toby's link? Toby won't be able to review until you make a new one.");
  await expect(toby.locator(".person-h")).toContainText("Link off");
  await expect(toby.getByRole("button", { name: "Turn off link" })).toHaveCount(0);
});

test("Copy link copies the reviewer's link, fetched on the tap, and it opens their pages", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: SERVICE });
  await reviewerWith("Cory Copy", [{ path: "/index.html", title: "Copy page" }]);
  const linkCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/link")) linkCalls.push(r.url());
  });
  await page.goto(OWNER_URL());
  const cory = column(page, "Cory Copy");
  await expect(cory.locator("[data-row]", { hasText: "Copy page" })).toBeVisible();
  expect(linkCalls).toHaveLength(0);
  await cory.getByRole("button", { name: "Copy link" }).click();
  await expect(cory.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(linkCalls).toHaveLength(1);
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(new RegExp(`^${SERVICE}/r/#ttf=[A-Za-z0-9_-]{43}$`));
  const other = await page.context().newPage();
  await other.goto(url);
  await expect(row(other, "Copy page")).toBeVisible();
});

test("Text link opens a text message with the link in it", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { smsOpened: string[] };
    w.smsOpened = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith("sms:")) w.smsOpened.push(this.getAttribute("href")!);
      else click.call(this);
    };
  });
  await reviewerWith("Tess Text", [{ path: "/index.html", title: "Text page" }]);
  await page.goto(OWNER_URL());
  const tess = column(page, "Tess Text");
  await tess.getByLabel("More for Tess").click();
  await tess.getByRole("button", { name: "Text link" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { smsOpened: string[] }).smsOpened.length)).toBe(1);
  const href = await page.evaluate(() => (window as unknown as { smsOpened: string[] }).smsOpened[0]);
  expect(href.startsWith("sms:?&body=")).toBe(true);
  const body = decodeURIComponent(href.slice("sms:?&body=".length));
  expect(body).toMatch(new RegExp(`^Here's your link to review pages for Fixture: ${SERVICE}/r/#ttf=[A-Za-z0-9_-]{43}$`));
  // The link stays on screen, with its own Text link, in case Messages did not open.
  await expect(tess.locator("[data-flash] a[data-sms]")).toHaveAttribute("href", href);
});

test("a link made before links were kept shows the plain note", async ({ page }) => {
  await reviewerWith("Olive Old", []);
  await page.route("**/api/owner/reviewers/*/link", (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"x","code":"not_stored"}' }),
  );
  await page.goto(OWNER_URL());
  const olive = column(page, "Olive Old");
  await olive.getByRole("button", { name: "Copy link" }).click();
  await expect(olive.locator("[data-flash]")).toContainText(
    "This link was made before links could be copied. Tap New link (under More) once to make one you can copy and text.",
  );
});

for (const [label, who] of [["", "Rowan Buttons"], [" @desktop", "Rowan Desktop"]]) {
  test(`the column header is one row: name, Copy link and More, with no horizontal scroll${label}`, async ({ page }) => {
    await reviewerWith(who, []);
    await page.goto(OWNER_URL());
    const rowan = column(page, who);
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    const name = (await rowan.locator(".av").boundingBox())!;
    const copy = (await rowan.getByRole("button", { name: "Copy link" }).boundingBox())!;
    const more = (await rowan.getByLabel(`More for ${who.split(" ")[0]}`).boundingBox())!;
    expect(Math.abs(mid(copy) - mid(name))).toBeLessThan(3);
    expect(Math.abs(mid(more) - mid(name))).toBeLessThan(3);
    // Text link and New link wait in the menu.
    await expect(rowan.getByRole("button", { name: "Text link" })).toBeHidden();
    await rowan.getByLabel(`More for ${who.split(" ")[0]}`).click();
    await expect(rowan.getByRole("button", { name: "Text link" })).toBeVisible();
    await expect(rowan.getByRole("button", { name: "New link" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("done pages fold into N done, and the fold stays open across a re-render", async ({ page }) => {
  const r = await reviewerWith("Fern Fold", [
    { path: "/index.html", title: "Fold done page" },
    { path: "/other.html", title: "Fold open page" },
  ]);
  const c = await comment(r.token, "/index.html", "Done one");
  await owner("PATCH", `/comments/${c}`, { status: "done" });
  await comment(r.token, "/other.html", "Open one");
  await page.route("**/api/owner/reviewers/*/link", (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"x","code":"not_stored"}' }),
  );
  await page.goto(OWNER_URL());
  const fern = column(page, "Fern Fold");
  await expect(fern.locator("[data-row]", { hasText: "Fold open page" })).toBeVisible();
  await expect(fern.locator("[data-row]", { hasText: "Fold done page" })).toBeHidden();
  await fern.locator("details.fold > summary", { hasText: "1 done" }).click();
  await expect(fern.locator("[data-row]", { hasText: "Fold done page" })).toBeVisible();
  await expect(fern.locator("[data-row]", { hasText: "Fold done page" })).toContainText("Done");
  // The not-stored note re-renders the whole page; the fold stays open.
  await fern.getByRole("button", { name: "Copy link" }).click();
  await expect(fern.locator("[data-flash]")).toBeVisible();
  await expect(fern.locator("[data-row]", { hasText: "Fold done page" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
});

test("columns sit side by side at 1440 and stack at 390", async ({ page }) => {
  await reviewerWith("Avery Column", []);
  await reviewerWith("Blair Column", []);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(OWNER_URL());
  const cols = page.locator("[data-person]");
  await expect(cols.nth(1)).toBeVisible();
  const top = async (i: number) => (await cols.nth(i).boundingBox())!.y;
  expect(await top(1)).toBe(await top(0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await top(1)) > (await top(0)) + (await cols.nth(0).boundingBox())!.height - 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// ---- Assign pages panel ----

const assignPanel = (page: Page) => page.getByRole("dialog", { name: "Assign pages" });

test("assign two existing pages to a second reviewer at once", async ({ page }) => {
  const erin = await reviewerWith("Erin Source", [{ path: "/erin-a.html", title: "Erin page A" }]);
  await new Promise((res) => setTimeout(res, 20)); // B's created_at is later than A's
  await owner("POST", "/assignments", { site: "fixture", reviewer_id: erin.id, path: "/erin-b.html", title: "Erin page B" });
  await reviewerWith("Frank Target", []);
  await page.goto(OWNER_URL());
  const frank = column(page, "Frank Target");
  const opener = frank.getByRole("button", { name: "Assign a page to Frank" });
  await opener.click();
  const panel = assignPanel(page);
  await expect(panel.getByRole("button", { name: "Frank", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("button", { name: "Assign pages to Frank" })).toBeDisabled();

  // Search narrows the list; a tick made while searching survives clearing it.
  await panel.getByLabel("Find a page").fill("erin page");
  const picks = panel.locator(".pick");
  await expect(picks).toHaveCount(2);
  // Newest first: B was assigned after A.
  await expect(picks.locator(".tt")).toHaveText(["Erin page B", "Erin page A"]);
  await expect(picks.first()).toContainText("Assigned to Erin · today");
  await picks.filter({ hasText: "Erin page A" }).click();
  await expect(panel.getByRole("button", { name: "Assign 1 page to Frank" })).toBeEnabled();
  await panel.getByLabel("Find a page").fill("erin page b");
  await picks.filter({ hasText: "Erin page B" }).click();
  await panel.getByLabel("Find a page").fill("");
  await expect(panel.getByRole("checkbox", { name: /Erin page A/ })).toBeChecked();
  await expect(panel.getByRole("checkbox", { name: /Erin page B/ })).toBeChecked();

  await panel.getByRole("button", { name: "Assign 2 pages to Frank" }).click();
  await expect(panel).toHaveCount(0);
  await expect(frank.locator("[data-row] .tt")).toHaveText(["Erin page B", "Erin page A"]);
  await expect(opener).toBeFocused();

  // Reopened, Frank's list names both, and neither is offered again.
  await opener.click();
  await expect(panel.locator(".already")).toHaveText("Already on Frank's list: Erin page B, Erin page A");
  await panel.getByLabel("Find a page").fill("erin page");
  await expect(panel.locator(".pick")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("a page that isn't listed adds a new page", async ({ page }) => {
  await reviewerWith("Gale Manual", []);
  await page.goto(OWNER_URL());
  const gale = column(page, "Gale Manual");
  await gale.getByRole("button", { name: "Assign a page to Gale" }).click();
  const panel = assignPanel(page);
  const toggle = panel.getByRole("button", { name: "A page that isn't listed" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await panel.getByLabel("Site").selectOption("fixture");
  await panel.getByLabel("Path", { exact: true }).fill("/gale-new.html");
  await expect(panel.getByRole("button", { name: "Assign 1 page to Gale" })).toBeEnabled();
  await panel.getByLabel("Title", { exact: true }).fill("Gale new page");
  await panel.getByRole("button", { name: "Assign 1 page to Gale" }).click();
  await expect(panel).toHaveCount(0);
  await expect(gale.locator("[data-row]", { hasText: "Gale new page" })).toContainText("Not started");

  // A bad path keeps the panel open with the service's message.
  await gale.getByRole("button", { name: "Assign a page to Gale" }).click();
  await panel.getByRole("button", { name: "A page that isn't listed" }).click();
  await panel.getByLabel("Path", { exact: true }).fill("no-slash");
  await panel.getByLabel("Title", { exact: true }).fill("Bad page");
  await panel.getByRole("button", { name: "Assign 1 page to Gale" }).click();
  await expect(panel.locator("[data-error]")).toHaveText("path must start with /");
  await expect(panel.getByLabel("Title", { exact: true })).toHaveValue("Bad page");
});

/** No sideways scroll on the page or inside the panel, and the window really is the viewport's width. */
async function noSidewaysScroll(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const inner = await assignPanel(page).evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right }));
  expect(inner.scroll).toBeLessThanOrEqual(inner.client);
  expect(inner.right).toBeLessThanOrEqual(width);
}

test("assign panel has no horizontal scroll at 390", async ({ page }) => {
  await reviewerWith("Hana Wide", [{ path: LONG_PATH + "-assign", title: LONG_TITLE }]);
  await reviewerWith("Ivo Wide", []);
  await page.goto(OWNER_URL());
  await column(page, "Ivo Wide").getByRole("button", { name: "Assign a page to Ivo" }).click();
  const panel = assignPanel(page);
  await panel.getByLabel("Find a page").fill(LONG_TITLE.slice(0, 30));
  await panel.locator(".pick").first().click();
  await panel.getByRole("button", { name: "A page that isn't listed" }).click();
  await expect(panel.getByLabel("Path", { exact: true })).toBeVisible();
  // Full screen on a phone.
  const box = (await panel.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBeLessThanOrEqual(390);
  await noSidewaysScroll(page, 390);
  for (const b of await panel.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 320, height: 640 });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(320);
  await noSidewaysScroll(page, 320);
});

test("assign panel is a 600px panel at the right on a laptop @desktop", async ({ page }) => {
  await reviewerWith("Jo Laptop", []);
  await page.goto(OWNER_URL());
  await column(page, "Jo Laptop").getByRole("button", { name: "Assign a page to Jo" }).click();
  const box = (await assignPanel(page).boundingBox())!;
  expect(box.width).toBe(600);
  expect(box.x + box.width).toBe(1280);
  expect(box.y).toBe(0);
  expect(box.height).toBe(800);
  await page.locator(".scrim").click({ position: { x: 20, y: 20 } });
  await expect(assignPanel(page)).toHaveCount(0);
});

// ---- No horizontal scroll at 390 px (the phone project) ----

const LONG_TITLE = "A very long page title that keeps going and going so that it has to wrap onto several lines on a phone screen without pushing sideways ".slice(0, 120);
const LONG_PATH = "/reports/emf/2026-loft-assessment-with-an-extremely-long-path-segment-that-has-no-break-points-at-all-and-keeps-going";

test("no horizontal scroll at 390 px with a 120-character title and a long path", async ({ page }) => {
  expect(LONG_TITLE).toHaveLength(120);
  const r = await reviewerWith("Dana Long", [{ path: LONG_PATH, title: LONG_TITLE }]);
  await comment(r.token, LONG_PATH, "Comment");

  await dashboard(page, r.token);
  await expect(row(page, LONG_TITLE.slice(0, 40))).toBeVisible();
  expect(await page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto(OWNER_URL());
  await expect(column(page, "Dana Long").locator("[data-row]", { hasText: LONG_TITLE.slice(0, 40) })).toBeVisible();
  // On a mobile viewport an overflow widens the layout viewport itself, so check the width too.
  expect(await page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
