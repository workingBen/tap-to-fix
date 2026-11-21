# tap-to-fix Comment Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The one script tag a site adds: a tiny loader that does nothing for ordinary visitors and, for a reviewer arriving with a token, loads a Shadow-DOM overlay where they tap a spot, type a comment, and save it with a screenshot and a re-findable location.

**Architecture:** Vanilla TypeScript in `service/client/`, bundled by esbuild into `service/public/` (`t.js` loader, `overlay.js` ES module). The Worker serves `public/` through `[assets]`; the Node dev server serves it with `serveStatic`. The overlay talks only to plan 1's reviewer API (`/api/me/...`) with a Bearer token. Pure logic (locator, screenshot sizing) is unit-tested with Vitest; the browser behavior is tested with Playwright against a fixture site on a second origin at 390 px.

**Tech Stack:** TypeScript, esbuild, modern-screenshot 4.7.0, Vitest 4 (+ happy-dom for DOM units), @playwright/test 1.61.1 (matches the Chromium/Firefox builds already cached on this laptop; no WebKit).

**Spec:** `docs/superpowers/specs/2026-11-20-tap-to-fix-design.md` · roadmap `2026-11-20-roadmap.md` · plan 1 notes `2026-11-20-01-service-core-followups.md` (read "For plan 2").

## Global Constraints

- American English in code, comments, copy and test names.
- Large type: 17 px body minimum inside the overlay, sheet heading 21 px serif; tap targets ≥ 44 px. Monochrome line icons (inline SVG), no emoji.
- **Paper look** (tokens copied from the approved mockup, variant A): `--bg:#FBF8F2; --surf:#FFFDF9; --ink:#1F2A24; --mut:#5E655F; --acc:#2F6B4F; --acc-ink:#fff; --line:#E4DDCF; --soft:#EEF4EF; --warn:#9A5B13; --warn-bg:#FBEFD9; --r:14px; --hf:"Iowan Old Style","Charter","Georgia",serif;` body font `-apple-system,"Helvetica Neue",system-ui,sans-serif`. Put them in `service/client/paper.ts` as one exported CSS string so plan 3 reuses it.
- Ordinary visitors: the loader makes **no network request and adds no element** when there is no token. Loader ≤ 1,500 bytes minified.
- The token lives in `sessionStorage` under `ttf:token` for the visit only; `ttf` is removed from the address bar with `history.replaceState` before anything else runs.
- Screenshot: viewport only, pin drawn onto the image, downscaled to **≤ 1200 px wide**, encoded WebP, JPEG when the browser can't encode WebP, shrunk until **≤ 1,048,576 bytes**. Any failure → `null` → the comment saves without a screenshot. **Never lose a comment.**
- Request shape (plan 1): `POST /api/me/comments`, multipart: `data` = JSON string form field `{site, path, body, selector, element_text, element_x, element_y, page_x, page_y, viewport_w, viewport_h, device}`; `screenshot` = file part. `path` is `location.pathname` exactly (no trailing-slash normalizing).
- Reviewer-facing status labels: open → "Open", in_progress → "In progress", done → "Fixed — goes live with Ben's next update", later → "Saved for later", kept → "Kept as is" (later/kept show their note under the label).
- Commit with explicit paths; never `git add -A`. Run tests in the foreground.

## Review Focus

1. Host page CSS that is hostile (`* { font-size: 9px !important; color: red !important }`) must not shrink or recolor the overlay → Task 4 Playwright test checks computed sheet-heading size ≥ 21 px.
2. Tapping a link or button on the host page while reviewing must drop a pin, never navigate or submit → Task 4 test taps a link and asserts the URL is unchanged.
3. A cross-origin image without CORS on the page → screenshot still produced (gray where the image was) or `null`; comment always saved → Task 5 test.
4. Network failure on Save → sheet stays open with the typed text and says it couldn't save; retry works → Task 5 test.
5. A page the reviewer isn't assigned to (or a revoked link) → plain message in the bar, taps pass through to the page → Task 4 test.

---

## File Structure

```
service/
  client/
    paper.ts              PAPER_CSS token string (shared with plan 3)
    loader.ts             → public/t.js (IIFE)
    overlay/index.ts      → public/overlay.js (ESM), export start(config)
    overlay/api.ts        fetchPageComments, postComment
    overlay/locate.ts     buildSelector, describeElement, locatorFor, findPin
    overlay/shot.ts       captureViewport, drawPin, shrinkToFit, takeScreenshot
    overlay/ui.ts         Shadow-DOM host, top bar, pins layer, sheet
    overlay/styles.ts     overlay CSS (uses PAPER_CSS)
  scripts/build-client.mjs esbuild both entries; --watch flag
  public/                 build output (git-ignored except .gitkeep)
  test/client/*.test.ts   Vitest units (happy-dom environment per file)
  e2e/
    playwright.config.ts
    global-setup.ts       boots service + fixture servers, seeds data
    fixture/index.html, fixture/other.html, fixture/hostile.css
    fixture-server.mjs    static server on :4173 (+ no-CORS image host :4174)
    overlay.spec.ts
```

---

### Task 1: Client build and static serving

**Files:**
- Create: `service/scripts/build-client.mjs`, `service/client/paper.ts`, `service/client/loader.ts` (stub that only exports nothing yet), `service/client/overlay/index.ts` (stub `export function start() {}`), `service/public/.gitkeep`
- Modify: `service/package.json` (scripts `build:client`, `dev:node` runs build first, devDeps `esbuild`, `happy-dom`, `modern-screenshot@4.7.0`), `service/wrangler.toml` (`[assets] directory = "./public"`), `service/src/node/server.ts` (serveStatic for `./public` before the app), `.gitignore` (`service/public/*` except `.gitkeep`)
- Test: `service/test/static.test.ts`

**Interfaces:**
- Produces: `npm run build:client` writes `public/t.js` (IIFE, minified) and `public/overlay.js` (ESM, minified, `modern-screenshot` bundled in). `PAPER_CSS: string` exported from `client/paper.ts`.

- [ ] **Step 1: Write the failing test** `static.test.ts`: after running the build (`execFileSync("node", ["scripts/build-client.mjs"])` in `beforeAll`), `public/t.js` and `public/overlay.js` exist; `t.js` size ≤ 1500 bytes.
- [ ] **Step 2: Run** `npx vitest run test/static.test.ts` — FAIL (no build script).
- [ ] **Step 3: Implement** the build script (esbuild `build()` twice: loader `format:"iife"`, overlay `format:"esm"`, both `minify:true, target:"es2020"`), serveStatic in the Node server (`@hono/node-server/serve-static`, `root: "./public"`, mounted on the outer Hono before `app`), `[assets]` in wrangler.toml.
- [ ] **Step 4: Run** `npx vitest run` — all PASS; `npm run typecheck` clean (add `client` to tsconfig `include` with `lib: ["DOM", "ES2022"]` for client files; use a separate `client/tsconfig.json` if DOM types clash with Workers types).
- [ ] **Step 5: Commit** `Client build: esbuild to public/, served by Worker assets and dev server`.

### Task 2: Loader (`t.js`)

**Files:**
- Modify: `service/client/loader.ts`
- Test: `service/test/client/loader.test.ts` (`// @vitest-environment happy-dom`)

**Interfaces:**
- Consumes: the tag `<script src="https://<service>/t.js" data-site="<slug>" defer>`.
- Produces: `boot(doc: Document, win: Window, load: (url: string) => Promise<{ start(c: OverlayConfig): void }>): boolean` exported for tests; the IIFE calls it with `document`, `window`, `u => import(u)`. `OverlayConfig = { base: string; site: string; token: string; dashboardUrl: string }` (declare it in `client/overlay/index.ts` and import the type). `base` = origin of the script's `src`; `dashboardUrl = base + "/r/#ttf=" + token`.

- [ ] **Step 1: Write failing tests:**
  - `no token → returns false, load never called, no element added, nothing in sessionStorage`
  - `?ttf=abc&x=1#h → sessionStorage "ttf:token" === "abc", location becomes ?x=1#h via replaceState, load called with base + "/overlay.js", start receives {base, site, token:"abc", dashboardUrl}`
  - `no ttf in URL but sessionStorage has a token → loads overlay with it`
  - `missing data-site → returns false`
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `boot`. Find the script via `doc.currentScript` (fall back to `doc.querySelector('script[src$="/t.js"][data-site]')`). Wrap storage access in try/catch (private mode); if storage throws, use the URL token for this page only.
- [ ] **Step 4: Run** tests + `static.test.ts` (size cap still holds) — PASS.
- [ ] **Step 5: Commit** `Loader: wakes only with a reviewer token, strips it from the address bar`.

### Task 3: Locator and screenshot logic

**Files:**
- Create: `service/client/overlay/locate.ts`, `service/client/overlay/shot.ts`
- Test: `service/test/client/locate.test.ts`, `service/test/client/shot.test.ts` (happy-dom)

**Interfaces:**
- Produces:
  - `buildSelector(el: Element): string` — unique within the document: `#id` when the id is unique and not auto-generated-looking (contains 4+ consecutive digits or is longer than 40 chars → skip); otherwise a `>`-joined path of `tag:nth-of-type(n)` up from the nearest usable-id ancestor or `body`. Must satisfy `document.querySelector(result) === el`.
  - `describeElement(el: Element): string` — `"the heading “Find your calm”"`; kinds: h1–h6 heading, a link, button button, img image (alt text), p paragraph, li list item, else "this spot"; quoted text trimmed and cut to 40 chars with "…".
  - `locatorFor(el: Element, clientX: number, clientY: number): { selector: string; element_text: string; element_x: number; element_y: number; page_x: number; page_y: number }` — `element_text` = trimmed `textContent` collapsed to single spaces, max 200 chars; `element_x/y` = fractions 0–1 of the element's bounding rect (clamped); `page_x/y` = document coordinates.
  - `findPin(doc: Document, c: { selector: string | null; element_text: string | null; element_x: number | null; element_y: number | null; page_x: number | null; page_y: number | null }): { x: number; y: number; moved: boolean } | null` — selector match whose text still starts with the first 40 chars of `element_text` → point inside its rect, `moved:false`; else first element whose collapsed text equals `element_text` (search `body *`, stop at 2000 nodes) → `moved:false`; else page coords with `moved:true`; else `null`.
  - `shrinkToFit(encode: (scale: number, quality: number) => Promise<Blob | null>, maxBytes: number): Promise<Blob | null>` — tries quality 0.85, 0.7, 0.55, 0.4 at scale 1, then the same at scale 0.8, 0.64, 0.51; returns the first blob ≤ maxBytes; `null` if none or if `encode` throws.
  - `targetSize(w: number, h: number, maxWidth = 1200): { w: number; h: number }`.
  - `takeScreenshot(pin: { x: number; y: number; n: number }, exclude: Element): Promise<Blob | null>` — `captureViewport` (modern-screenshot `domToCanvas(document.documentElement, …)` cropped to the viewport at the current scroll, `filter` drops `exclude`, `fetch.placeholderImage` a gray 1×1 PNG data URL, `timeout` 8000, the whole call raced against a 10 s timer) → `drawPin` (circle in `--ink` with white number, matching the on-page pin) → scale to `targetSize` → `shrinkToFit` with `canvas.toBlob` WebP, switching to `image/jpeg` when the returned blob's type isn't `image/webp`. Wrapped in try/catch → `null`. Not unit-tested (Task 5 covers it in a real browser).
- [ ] **Step 1: Write failing tests:** for `buildSelector` (unique id; duplicate id falls back to path; `id="ember1234"` skipped; three sibling `<p>`s each resolve to themselves); `describeElement` (heading, link, image alt, long text cut with "…"); `locatorFor` fractions clamped to [0,1] (stub `getBoundingClientRect`); `findPin` (selector hit; selector now points at different text → text search hit; nothing → page coords with `moved:true`; all null → `null`); `shrinkToFit` (first fit returned; tries smaller scale when every quality at scale 1 is too big; all too big → null; encode throws → null); `targetSize(2400, 1600) → {w:1200,h:800}`, `targetSize(390, 844) → unchanged`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** `npx vitest run test/client` — PASS.
- [ ] **Step 5: Commit** `Overlay: element locator, pin re-finding and screenshot sizing`.

### Task 4: Overlay UI — bar, pins, sheet (Playwright harness included)

**Files:**
- Create: `service/client/overlay/api.ts`, `ui.ts`, `styles.ts`; fill `overlay/index.ts`
- Create: `service/e2e/playwright.config.ts`, `global-setup.ts`, `fixture-server.mjs`, `fixture/index.html`, `fixture/other.html`, `fixture/hostile.css`, `overlay.spec.ts`
- Modify: `service/package.json` (`@playwright/test@1.61.1` devDep, script `e2e`: build client then `playwright test -c e2e`)

**Interfaces:**
- Consumes: `OverlayConfig` (Task 2), locate/shot functions (Task 3), `PAPER_CSS`.
- Produces: `start(config: OverlayConfig): Promise<void>`. `api.ts`: `fetchPageComments(cfg, path): Promise<{ kind: "ok"; assignment_id: string; comments: PageComment[] } | { kind: "not_assigned" } | { kind: "signed_out" } | { kind: "offline" }>` (404 → not_assigned, 401 → signed_out); `postComment(cfg, data: object, shot: Blob | null): Promise<{ ok: true; id: string } | { ok: false }>`. `PageComment` = the plan 1 `/api/me/pages/comments` row.
- Harness: `global-setup.ts` starts the service with `OWNER_TOKEN=e2e-owner` on port 8788 using a fresh temp SQLite file (add `TTF_DB_PATH` env support to `server.ts`, default unchanged) and the fixture server on 4173 (pages include `<script src="http://localhost:8788/t.js" data-site="fixture" defer>`) and 4174 (serves `photo.jpg` with no CORS headers). Seeds via owner API: site `fixture` origin `http://localhost:4173`; reviewer "Alexis"; assignment `/index.html` titled "Fixture home". Exposes the reviewer token and ids through `process.env` for specs. Projects: `phone` = Chromium 390×844, `hasTouch`, `isMobile`; `firefox-desktop` = Firefox 1280×800 running only the save test (`grep`).

UI contract (Paper variant A, from the approved mockup):
- One host element `<tap-to-fix-overlay>` appended to `body`, `attachShadow({mode:"closed"})`, `:host{all:initial}`; fixed top bar 52 px: "**Reviewing** · N comments" and a right-aligned "Done" link to `dashboardUrl`. Body padding is not changed; the bar overlays the page.
- Not assigned: bar reads "This page isn't on your review list" + "Back to your list" link; no tap interception. Signed out: "This link no longer works. Ask for a new one." Offline: "Can't reach the review service right now."
- Pins: absolutely positioned layer (document coordinates), 30 px numbered circles in `--ink`, settled comments in `--acc`, `moved` pins get a dashed outline and "moved" under the number in the read sheet. Re-laid out on `resize` and after fonts/images load (`window.load`).
- Tap: `click` listener on `document` in capture phase; if the event path includes the host element, ignore; else `preventDefault()`, `stopPropagation()`, drop a new pin numbered N+1 at the tap, start `takeScreenshot` immediately (keep the promise), open the sheet.
- Sheet: slides up from the bottom, never covering the pin (if the pin is in the lower 55% of the viewport, `scrollBy` so it sits in the top third first). Grab bar, heading "What should change here?" (21 px serif), under it the `describeElement` text in `--mut`, a textarea (17 px, 4 rows, autofocus), buttons "Save comment" (accent, full width) and "Cancel". Cancel removes the unsaved pin. Escape cancels on desktop.
- Tapping an existing pin opens the read sheet: comment body, status label (Global Constraints) and note, "Close".
- `device`: `"phone"` if `innerWidth < 768`, `"tablet"` < 1024, else `"desktop"`.

- [ ] **Step 1: Write failing Playwright tests** in `overlay.spec.ts`:
  - `ordinary visitor sees nothing`: open `/index.html` without `ttf` → no `tap-to-fix-overlay` element; no request to `:8788/api` (listen on `page.on("request")`); `/t.js` is the only service request.
  - `reviewer link strips the token and shows the bar`: open `/index.html?ttf=TOKEN` → `page.url()` has no `ttf`; bar text contains "Reviewing" and "0 comments".
  - `tapping a link drops a pin instead of navigating`: tap the fixture's `<a href="/other.html">` → URL still `/index.html`; pin "1" visible; sheet heading "What should change here?"; sheet names "the link “…”".
  - `hostile host CSS does not reach the overlay`: fixture links `hostile.css` → sheet heading computed `font-size` ≥ 21 px and color ≠ red.
  - `cancel removes the unsaved pin`.
  - `unassigned page lets taps through`: open `/other.html?ttf=TOKEN` → bar says "This page isn't on your review list"; tapping its link navigates.
  - `revoked link says so`: revoke a second reviewer via owner API, open with their token → "This link no longer works".
- [ ] **Step 2: Run** `npm run e2e` — FAIL.
- [ ] **Step 3: Implement** api.ts, styles.ts, ui.ts, index.ts per the contract (Save is wired in Task 5; in this task the button can be present but inert).
- [ ] **Step 4: Run** `npm run e2e` and `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `Overlay: Paper top bar, pins and bottom sheet in Shadow DOM, Playwright harness`.

### Task 5: Saving a comment with its screenshot

**Files:**
- Modify: `service/client/overlay/index.ts`, `ui.ts`
- Modify: `service/e2e/overlay.spec.ts`, `service/e2e/fixture/index.html` (add `<img src="http://localhost:4174/photo.jpg">`)

**Interfaces:**
- Consumes: `postComment`, `takeScreenshot`, `locatorFor`, owner API `GET /api/owner/batch?reviewer=ID&site=fixture` and `GET /api/owner/comments/:id/screenshot` (assertions only).

Behavior: Save disables the button and shows "Saving…"; awaits the screenshot promise (it never rejects; cap the wait at 12 s, then send without it); posts. Success → sheet closes, pin stays and turns into a saved pin, bar count increments, a short "Saved" line shows in the bar for 3 s. Failure → sheet stays open, text intact, red-free warning in `--warn` on `--warn-bg`: "Couldn't save. Check your connection and try again." Button re-enabled. Empty text → Save disabled.

- [ ] **Step 1: Write failing tests:**
  - `saving records the spot and a screenshot`: tap the `<h1>`, type "Make this bigger", Save → bar "1 comment"; batch API returns one comment with `body` "Make this bigger", `selector` that resolves (in the page, via `page.evaluate`) to the `<h1>`, `element_text` starting with the heading text, `device` "phone", `viewport_w` 390, `has_screenshot` true; the screenshot response is ≤ 1,048,576 bytes, content type `image/webp` or `image/jpeg`, and decodes (draw it into a canvas in the page) to width ≤ 1200.
  - `cross-origin image does not block saving`: the fixture's no-CORS image is in view when tapping → comment saved (screenshot either saved or not; the comment exists).
  - `screenshot failure still saves the comment`: `addInitScript` makes `HTMLCanvasElement.prototype.toBlob` call back `null` → comment saved, `has_screenshot` false.
  - `network failure keeps the text`: `page.route("**/api/me/comments", r => r.abort())` → warning text shown, textarea still holds the text; `unroute`, Save again → saved.
  - `saved pins come back after reload`: reload with `?ttf=TOKEN` → pin "1" rendered within 40 px of the `<h1>`'s tap point; tapping it shows the body and "Open".
  - (firefox-desktop project) `saving records the spot and a screenshot` passes too.
- [ ] **Step 2: Run** `npm run e2e` — FAIL.
- [ ] **Step 3: Implement** the save flow.
- [ ] **Step 4: Run** `npm run e2e`, `npx vitest run`, `npm run typecheck` — all PASS.
- [ ] **Step 5: Manual check at 390 px**: `npm run dev:node`, open the fixture, screenshot the bar + sheet with Playwright into the scratchpad and look at it against the mockup (https://claude.ai/artifact/3GRTyX4piRHteaAvEsDTV7, variant A). Fix anything that doesn't match before committing.
- [ ] **Step 6: Commit** `Overlay: save comments with viewport screenshot, never losing the text`.

### Task 6: Docs and carry-forward

**Files:**
- Modify: `README.md` (how a site installs the tag; how to run `npm run e2e`), `service/scripts/smoke.sh` (also `GET /t.js` returns 200 JavaScript)
- Create: `docs/superpowers/plans/2026-11-20-02-comment-layer-followups.md` (rulings made while building; notes for plans 3–5, including the exact CSP hosts Bonus Decade needs: the service origin in `script_src`, `connect_src`, `img_src`; plus anything modern-screenshot needed, e.g. `img_src data: blob:`)

- [ ] **Step 1:** Update README and smoke; run `bash scripts/smoke.sh` against `npm run dev:node` — PASS.
- [ ] **Step 2: Commit** `Comment layer: README, smoke check and carry-forward notes`.
