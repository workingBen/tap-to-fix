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
