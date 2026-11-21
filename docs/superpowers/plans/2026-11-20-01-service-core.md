# tap-to-fix Service Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested Cloudflare Worker that stores sites, reviewers (with private links), page assignments and pinned comments with screenshots, and exposes the API the comment layer, the dashboards and Claude will use.

**Architecture:** One Worker in `service/`, routed with Hono. D1 holds all records; R2 holds screenshots under private keys. Two kinds of caller: the **owner** (Ben, and Claude acting for him) with one secret bearer token, and **reviewers** with personal tokens whose SHA-256 hash is stored. Status rollups and flags are pure functions, unit-tested apart from the routes.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono 4, D1, R2, Wrangler 4, Vitest with `@cloudflare/vitest-pool-workers` (tests run inside the Workers runtime with local D1/R2).

**Spec:** `docs/superpowers/specs/2026-11-20-tap-to-fix-design.md` (roadmap: `docs/superpowers/plans/2026-11-20-roadmap.md`)

## Global Constraints

- American English in code, comments, copy and test names (`color`, `normalize`, `canceled`).
- No email anywhere: no email column, no mail sending.
- Reviewers are never stored in a host app; they exist only in this service.
- Comment statuses are exactly: `open`, `in_progress`, `done`, `later`, `kept`. `later` and `kept` carry a `note`. Reviewer-facing labels (used by plan 3): Open, In progress, "Fixed — goes live with Ben's next update", Saved for later, Kept as is.
- Settled statuses (count toward progress): `done`, `later`, `kept`.
- Reviewers see only their own comments and screenshots. Nothing in the reviewer API returns another reviewer's data.
- Reviewers may comment only on paths assigned to them.
- **Never lose a comment:** a missing or rejected screenshot never blocks saving the comment.
- Screenshot byte ceiling: `MAX_SCREENSHOT_BYTES = 1_048_576` (1 MB) in `service/src/limits.ts`, Ben's call 2026-11-20. (The browser downscales to 1200 px wide before upload; that is plan 2.)
- Screenshots are never served by a public URL; only through the authenticated screenshot route.
- Commit with explicit paths; never `git add -A`.

## Review Focus

1. A revoked or reissued reviewer link keeps working → must return 401 immediately after revoke/reissue (Task 3).
2. A comment POST from a site origin other than the assignment's site → CORS has no allow header and the route returns 403 (Task 6).
3. Reviewer A asks for reviewer B's comment, screenshot or assignment by id → 404, not 403, so ids don't leak (Tasks 5, 6, 7).
4. Screenshot larger than the ceiling, or a non-image upload → comment saved, response `screenshot: "dropped"` (Task 6).
5. The same page assigned twice to one reviewer → returns the existing assignment, no duplicate row (Task 4).

---

## File Structure

```
service/
  package.json            scripts: test, dev, typecheck
  wrangler.toml           D1 binding DB, R2 binding SHOTS, var OWNER_TOKEN (secret in prod)
  tsconfig.json
  vitest.config.ts        defineWorkersConfig, applies migrations
  migrations/0001_init.sql
  src/index.ts            Hono app: mounts routers, CORS, error shape
  src/env.ts              Env type
  src/limits.ts           MAX_SCREENSHOT_BYTES
  src/ids.ts              newId(), newToken(), hashToken()
  src/auth.ts             requireOwner, requireReviewer middleware
  src/rollup.ts           pure: assignmentStatus, progress, flags
  src/routes/owner.ts     sites, reviewers, assignments, overview, batch, status, screenshot
  src/routes/me.ts        reviewer: dashboard, opened, page comments, create comment, screenshot
  test/helpers.ts         seed helpers, ownerFetch, reviewerFetch
  test/*.test.ts
```

## Data model (`migrations/0001_init.sql`)

| Table | Columns |
|---|---|
| `sites` | `slug TEXT PK`, `name TEXT NOT NULL`, `origin TEXT NOT NULL` (e.g. `https://greensprings.life`), `repo TEXT NOT NULL` (e.g. `workingBen/longevity-tracker`), `created_at TEXT` |
| `reviewers` | `id TEXT PK`, `name TEXT NOT NULL`, `token_hash TEXT NOT NULL UNIQUE`, `revoked_at TEXT`, `created_at TEXT` |
| `assignments` | `id TEXT PK`, `site_slug TEXT FK`, `reviewer_id TEXT FK`, `path TEXT NOT NULL`, `title TEXT NOT NULL`, `last_opened_at TEXT`, `created_at TEXT`, `UNIQUE(site_slug, reviewer_id, path)` |
| `comments` | `id TEXT PK`, `assignment_id TEXT FK`, `body TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done','later','kept'))`, `note TEXT`, `pr_url TEXT`, `selector TEXT`, `element_text TEXT`, `element_x REAL`, `element_y REAL` (0–1 within the element), `page_x REAL`, `page_y REAL`, `viewport_w INTEGER`, `viewport_h INTEGER`, `device TEXT` (`phone`/`tablet`/`desktop`), `screenshot_key TEXT`, `created_at TEXT`, `status_changed_at TEXT` |

Timestamps are ISO 8601 UTC strings. Ids are `newId()` (21-char URL-safe random).

---

### Task 1: Scaffold the Worker, schema and test harness

**Files:**
- Create: `service/package.json`, `service/wrangler.toml`, `service/tsconfig.json`, `service/vitest.config.ts`, `service/migrations/0001_init.sql`, `service/src/index.ts`, `service/src/env.ts`, `service/src/limits.ts`, `.gitignore` (root: `node_modules`, `.wrangler`, `.dev.vars`)
- Test: `service/test/health.test.ts`

**Interfaces:**
- Produces: `type Env = { DB: D1Database; SHOTS: R2Bucket; OWNER_TOKEN: string }`; `app` default export from `src/index.ts`; `GET /api/health` → `200 {ok: true}`; error responses are always `{error: string}` with the status code.

- [ ] **Step 1:** In `service/`, `npm init -y`, then `npm i hono` and `npm i -D wrangler @cloudflare/vitest-pool-workers vitest typescript @cloudflare/workers-types` (let npm pick the vitest version the pool's peer range wants). Write `wrangler.toml` with `compatibility_date = "2026-11-01"`, `[[d1_databases]] binding="DB"`, `[[r2_buckets]] binding="SHOTS"`, `[vars] OWNER_TOKEN="test-owner-token"` (dev only; prod uses `wrangler secret`). Vitest config applies `migrations/` with `applyD1Migrations` in a setup file.
- [ ] **Step 2: Write the failing test** `health.test.ts`: `SELF.fetch("http://x/api/health")` → status 200, JSON `{ok: true}`; and `SELECT name FROM sqlite_master WHERE type='table'` includes `sites`, `reviewers`, `assignments`, `comments`.
- [ ] **Step 3:** Run `npm test` in `service/`. Expected: FAIL (no route / no tables).
- [ ] **Step 4:** Write the migration per the Data model table and the Hono app with the health route and a JSON error handler.
- [ ] **Step 5:** Run `npm test`. Expected: PASS. Run `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 6: Commit** `service/ .gitignore` — "Service scaffold: Worker, D1 schema, test harness".

### Task 2: Tokens and auth middleware

**Files:**
- Create: `service/src/ids.ts`, `service/src/auth.ts`
- Test: `service/test/auth.test.ts`

**Interfaces:**
- Produces: `newId(): string`; `newToken(): string` (32 random bytes, base64url, 43 chars); `hashToken(t: string): Promise<string>` (SHA-256 hex); `requireOwner` (Hono middleware: `Authorization: Bearer <OWNER_TOKEN>`, constant-time compare, else 401); `requireReviewer` (token from `Authorization: Bearer` or `?ttf=` query; looks up `token_hash`, rejects `revoked_at IS NOT NULL`; sets `c.get("reviewer"): {id, name}`; else 401).

- [ ] **Step 1: Write failing tests:** `newToken()` is 43 chars and two calls differ; `hashToken("abc")` equals the known SHA-256 hex `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; a test route behind `requireOwner` returns 401 without header, 401 with a wrong token, 200 with `test-owner-token`; behind `requireReviewer`, 401 for unknown token, 200 via header and via `?ttf=`, 401 after setting `revoked_at`.
- [ ] **Step 2:** `npm test -- auth`. Expected: FAIL.
- [ ] **Step 3:** Implement with `crypto.getRandomValues` and `crypto.subtle.digest`; compare owner tokens with `crypto.subtle.timingSafeEqual` on equal-length buffers.
- [ ] **Step 4:** `npm test -- auth`. Expected: PASS.
- [ ] **Step 5: Commit** `service/src/ids.ts service/src/auth.ts service/test/auth.test.ts` — "Reviewer and owner tokens".

### Task 3: Owner — sites and reviewers

**Files:**
- Create: `service/src/routes/owner.ts`, `service/test/helpers.ts`
- Modify: `service/src/index.ts` (mount `/api/owner`)
- Test: `service/test/owner-people.test.ts`

**Interfaces:**
- Consumes: Task 2's `newId`, `newToken`, `hashToken`, `requireOwner`.
- Produces (all under `requireOwner`):
  - `POST /api/owner/sites {slug, name, origin, repo}` → 201 site; 409 if slug exists; 400 if `origin` is not an `https://` origin (allow `http://localhost:*`).
  - `GET /api/owner/sites` → `Site[]`.
  - `POST /api/owner/reviewers {name}` → 201 `{id, name, token}` — the raw token is returned **only here and on reissue**.
  - `POST /api/owner/reviewers/:id/reissue` → `{id, name, token}`; the old token stops working.
  - `POST /api/owner/reviewers/:id/revoke` → 204.
  - `test/helpers.ts`: `ownerFetch(path, init?)`, `reviewerFetch(token, path, init?)`, `seedSite(overrides?)`, `seedReviewer(name) → {id, token}`.

- [ ] **Step 1: Write failing tests:** create site then list returns it; duplicate slug → 409; `origin: "greensprings.life"` → 400; create reviewer returns a 43-char token that passes `requireReviewer`; after reissue the old token → 401 and the new → 200 (Review Focus 1); after revoke → 401; every route → 401 without the owner token.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement routes; validate bodies by hand (no schema library).
- [ ] **Step 4:** Run; expected PASS.
- [ ] **Step 5: Commit** — "Owner API: sites and reviewer links".

### Task 4: Owner — assignments, rollups and overview

**Files:**
- Create: `service/src/rollup.ts`
- Modify: `service/src/routes/owner.ts`
- Test: `service/test/rollup.test.ts`, `service/test/owner-assignments.test.ts`

**Interfaces:**
- Produces:
  - `type Status = "open"|"in_progress"|"done"|"later"|"kept"`
  - `assignmentStatus(statuses: Status[]): "not_started"|"open"|"in_progress"|"done"` — none → `not_started`; any `open` → `open`; else any `in_progress` → `in_progress`; else `done`.
  - `progress(statuses: Status[]): number` — settled ÷ total, `0` when empty.
  - `isUpdated(lastOpenedAt: string|null, changedAts: string[]): boolean` — true when `lastOpenedAt` is non-null and any `changedAt > lastOpenedAt`.
  - `POST /api/owner/assignments {site, reviewer_id, path, title}` → 201 assignment, or 200 with the existing one if the triple exists (Review Focus 5); 404 unknown site/reviewer; `path` must start with `/`.
  - `DELETE /api/owner/assignments/:id` → 204 (cascades comments; deletes their R2 objects).
  - `GET /api/owner/overview` → `{reviewers: [{id, name, revoked, open_count, ready_count}], assignments: [{id, site, path, title, reviewer: {id,name}, status, counts: {open, in_progress, settled}, pr_urls: string[]}]}` where `ready_count` = comments with status `open` across that reviewer's assignments.

- [ ] **Step 1: Write failing unit tests** for the three pure functions, including: `assignmentStatus([])` → `not_started`; `["done","later"]` → `done`; `["in_progress","done"]` → `in_progress`; `progress(["done","open","kept","later"])` → `0.75`; `isUpdated(null, [...])` → false; `isUpdated("2026-11-20T10:00:00Z", ["2026-11-20T11:00:00Z"])` → true.
- [ ] **Step 2: Write failing route tests:** assign, assign again → same id and one row; overview counts after seeding comments in mixed statuses directly via SQL; delete removes comments.
- [ ] **Step 3:** Run; expected FAIL. **Step 4:** Implement. **Step 5:** Run; expected PASS.
- [ ] **Step 6: Commit** — "Assignments, status rollups and owner overview".

### Task 5: Reviewer — dashboard data and "opened"

**Files:**
- Create: `service/src/routes/me.ts`
- Modify: `service/src/index.ts` (mount `/api/me`)
- Test: `service/test/me-dashboard.test.ts`

**Interfaces:**
- Consumes: `requireReviewer`, `assignmentStatus`, `progress`, `isUpdated`.
- Produces (all under `requireReviewer`):
  - `GET /api/me` → `{name, assignments: [{id, site: {slug, name, origin}, path, title, url, status, progress, counts: {total, settled, in_progress, open}, is_new, is_updated}]}`; `url` = `origin + path + "?ttf=" + token` so every link carries the token (spec: reviewers always enter from the dashboard); `is_new` = `last_opened_at IS NULL`.
  - `POST /api/me/assignments/:id/opened` → 204, sets `last_opened_at = now`; 404 if not this reviewer's (Review Focus 3).

- [ ] **Step 1: Write failing tests:** a reviewer sees only their assignments; `is_new` true before opened, false after; after the owner changes a comment's status (set `status_changed_at` later than `last_opened_at` via SQL), `is_updated` true, and false again after another `opened`; `url` ends with `?ttf=<token>`; reviewer B posting `opened` on A's assignment → 404.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5: Commit** — "Reviewer dashboard data".

### Task 6: Reviewer — comments, screenshots, CORS

**Files:**
- Modify: `service/src/routes/me.ts`, `service/src/index.ts`
- Test: `service/test/me-comments.test.ts`

**Interfaces:**
- Consumes: `MAX_SCREENSHOT_BYTES`, `newId`.
- Produces:
  - CORS on `/api/me/*`: `Access-Control-Allow-Origin` echoes the request `Origin` only if it equals some `sites.origin`; preflight `OPTIONS` answered; `Authorization` allowed.
  - `GET /api/me/pages/comments?site=<slug>&path=<path>` → `{assignment_id, comments: [{id, body, status, note, pr_url, selector, element_text, element_x, element_y, page_x, page_y, created_at}]}`; 404 if not assigned.
  - `POST /api/me/comments` (multipart): field `data` = JSON `{site, path, body, selector?, element_text?, element_x?, element_y?, page_x?, page_y?, viewport_w?, viewport_h?, device?}`; optional field `screenshot` (image/webp, image/png or image/jpeg). → 201 `{id, screenshot: "saved"|"none"|"dropped"}`. 403 if path not assigned to this reviewer; 403 if request `Origin` is present and differs from that site's origin (Review Focus 2); 400 if `body` is empty after trim.
  - Screenshot stored at R2 key `shots/<site>/<comment id>.<ext>`; `screenshot_key` saved on the row.
  - `GET /api/me/comments/:id/screenshot` → the image bytes with its content type; 404 if not this reviewer's (Review Focus 3).

- [ ] **Step 1: Write failing tests:** comment with a small PNG → 201 `saved`, object exists in `SHOTS`; with no file → `none`; with a file of `MAX_SCREENSHOT_BYTES + 1` bytes → 201 `dropped`, row exists, no R2 object (Review Focus 4); with `text/plain` file → `dropped`; unassigned path → 403; `Origin: https://evil.example` → 403 and no CORS allow header; registered origin → allow header echoes it; page comments list returns only this reviewer's comments on that path; B fetching A's screenshot → 404.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement (use `c.req.parseBody()`; check `File.size` and `File.type` before `SHOTS.put`). **Step 4:** Run; PASS.
- [ ] **Step 5: Commit** — "Reviewer comments with screenshots".

### Task 7: Owner/Claude — batch, status updates, screenshot

**Files:**
- Modify: `service/src/routes/owner.ts`
- Test: `service/test/owner-batch.test.ts`

**Interfaces:**
- Produces (under `requireOwner`) — the contract plan 4's fix skill uses:
  - `GET /api/owner/batch?reviewer=<id>&site=<slug>` → `{reviewer: {id,name}, site: {slug,name,origin,repo}, comments: [{id, page: {path, title, url}, body, status, selector, element_text, element_x, element_y, page_x, page_y, viewport_w, viewport_h, device, has_screenshot, created_at}]}` — only `open` comments, oldest first; `url` is `origin + path` with **no** token.
  - `PATCH /api/owner/comments/:id {status, note?, pr_url?}` → 200 updated comment; sets `status_changed_at = now` when status changes; 400 if `status` is `later` or `kept` without a non-empty `note`; 400 for unknown status.
  - `GET /api/owner/comments/:id/screenshot` → image bytes; 404 if none.

- [ ] **Step 1: Write failing tests:** batch returns only open comments of that reviewer on that site, oldest first, URL without `ttf`; PATCH to `in_progress` then `done` with `pr_url` updates `status_changed_at` and makes the reviewer's `is_updated` true; `kept` without note → 400; `later` with note → 200; owner screenshot fetch returns the bytes saved in Task 6.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5:** Full suite `npm test` and `npx tsc --noEmit`. Expected: all PASS, no type errors.
- [ ] **Step 6: Commit** — "Batch and status API for fix runs".

### Task 8: Local end-to-end smoke and README

**Files:**
- Create: `service/scripts/smoke.sh`, `README.md` (root: what tap-to-fix is, one paragraph; `service/` dev commands)

- [ ] **Step 1:** `smoke.sh` runs against `npx wrangler dev --local` on port 8787 with curl: create site (`origin http://localhost:3000`), reviewer, assignment; post a comment as the reviewer with `Origin: http://localhost:3000`; fetch batch as owner; PATCH to `done`; `GET /api/me` shows `is_updated: true`. Exits non-zero on any unexpected status.
- [ ] **Step 2:** Run `npx wrangler d1 migrations apply DB --local`, start dev, run `bash scripts/smoke.sh`. Expected: final line `smoke: ok`.
- [ ] **Step 3: Commit** `service/scripts/smoke.sh README.md` — "Local smoke test and README".

Deploying to Cloudflare is **not** in this plan; plan 4's setup skill does it, with Ben's go-ahead.
