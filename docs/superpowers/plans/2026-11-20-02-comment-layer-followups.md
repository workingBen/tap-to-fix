# Plan 2 (comment layer) — carry-forward notes

Written at the end of plan 2 (2026-11-20). Sources: the SDD ledger and the task 1-5 reviews.

## Decisions made while building (rulings)
- Overlay shadow root is `open`: Playwright cannot pierce a closed root, and the host page can already read the sessionStorage token, so nothing new leaks (the overlay DOM holds no secret).
- `t.js` and `overlay.js` are served with `Access-Control-Allow-Origin: *` (Node dev server middleware, and build-emitted `public/_headers` for Workers): `overlay.js` is loaded by cross-origin `import()`, which needs CORS. Public code, no secrets.
- Cancel/Escape with typed text asks "Discard this comment?" first: the spec's "never lose a comment" outranks a plain cancel. Cost: one extra tap.
- The 52 px bar overlays the top of the page, so fixed site headers cannot be tapped while reviewing. Kept per the approved mockup. **Open question for Ben** after visual QA (fix could be a collapsible bar).
- `OWNER_TOKEN` in the environment now overrides `.dev.vars` (reverses the plan 1 gap; the e2e harness needs it). A stale shell value silently wins.
- Saving has a 30 s timeout so a hung POST cannot trap the reviewer; the sheet stays open with Save re-enabled.
- Screenshot is captured with modern-screenshot 4.7.0, no worker, viewport-sized crop; the comment always saves even if capture fails (10 s race, 12 s outer cap).

### Final-review rulings (2026-11-20)
1. **The token travels in the fragment.** Assignment links are `origin + path + "#ttf=" + token` (plan 1 `me.ts`). The loader reads `#ttf=` first, tolerates other hash parts (`#ttf=abc&x=1`), falls back to `?ttf=`, strips whichever it found with `history.replaceState` and keeps every other query and hash part. An empty `ttf=` counts as no token. The README tells installers to place the tag before analytics.
2. **The tap is decided from pointer events.** A `pointerup` within 10 px and 600 ms of its `pointerdown`, outside the overlay, drops the pin. The capture-phase `click` listener only cancels the follow-up click (and still turns a keyboard activation into a pin). While reviewing, the page's `pointerdown`/`pointerup`/`touchstart`/`touchend`/`mousedown`/`mouseup` handlers never see a tap. `touchstart` and `pointerdown` are never prevented, so scrolling works and a drag drops no pin. The touch's compatibility `mousedown` is prevented only while a draft is open, so focus stays in the comment box. Unassigned pages add none of these listeners.
3. **The overlay survives Turbo and SPA navigation.** On `turbo:load`, `popstate` and `pageshow`, if the path changed or the host was detached, the current session's listeners are removed and a new session starts for the new path. That means fresh page comments, or the not-on-your-list bar with no tap interception. Stale hosts from a Turbo snapshot are removed. The three navigation listeners stay on for the whole visit; they intercept nothing.
4. **Screenshots follow the screen's pixel density:** `scale = min(devicePixelRatio, 1200 / innerWidth)`, so a 390 px phone at 3x gives about 1170 px (still at most 1200 px wide and 1 MB). The phone e2e project runs at `deviceScaleFactor: 3`.
5. **A refused save says why.** 401 says "This link no longer works. Ask for a new one." 403 says "This page isn't on your review list." A network error, timeout or other status keeps "Couldn't save. Check your connection and try again." The text is kept in every case.

## For plan 3 (dashboards)
- Dashboard links go to `/r/#ttf=TOKEN` (the overlay bar's **Done** / **Back to your list** link already builds it; fragment, so it is never sent to a server).
- Assignment links from `GET /api/me` are now `origin + path + "#ttf=TOKEN"` (fragment, not query); the reviewer dashboard should use them as is.
- Reuse `PAPER_CSS` from `service/client/paper.ts` so the dashboards match the overlay.
- Extend the e2e harness: `service/e2e/global-setup.ts` boots the service on 8788 plus fixture sites on 4173 and 4174 (4174 is the cross-origin image host). Run with `npm run e2e`.

## For plan 4 (plugin + deploy)
- `wrangler deploy` does not run `build:client`; the deploy step must run it first or `public/t.js` and `overlay.js` are stale or missing.
- Confirm Cloudflare honors `public/_headers` for `/*.js` CORS (only the Node server path was exercised): `curl -sI https://<worker>/overlay.js | grep -i access-control`.
- A retry after a lost response can double-save. Fixing it needs an idempotency key (`client_id` with a unique index), which is a plan 1 API change.

## For plan 5 (Bonus Decade hookup): exact CSP additions
Let `SVC` be the service origin. Read from `client/overlay/shot.ts` and `modern-screenshot/dist/index.mjs`.
- `script_src` += `SVC`: loads `t.js`, and `t.js` does `import(SVC + "/overlay.js")`, which script-src governs.
- `connect_src` += `SVC`: the overlay `fetch`es `/api/me/pages/comments` and POSTs `/api/me/comments`. Also: modern-screenshot `fetch`es every image, stylesheet and font URL on the page to inline it, so every origin the page loads those from must already be in `connect_src` (and send CORS headers, else it falls back to the placeholder image). Check which of Bonus Decade's image hosts (Cloudinary) and font hosts (Google Fonts) are missing.
- `img_src` += `data:`: the capture serializes the page to an `data:image/svg+xml` image and loads it into an `<img>`; inlined images and fonts are data URLs inside it. Likely already present. The service origin does NOT need `img_src`: the overlay loads no images from it (screenshots are only POSTed).
- `img_src blob:` not needed: there is no `createObjectURL` in modern-screenshot 4.7.0 or in our code.
- `worker_src blob:` not needed: `shot.ts` passes no `workerUrl`, and without it modern-screenshot creates zero workers.
- `font_src`: not needed for the service origin or for capture. Fonts are fetched via `connect_src` and embedded as data URLs inside the SVG image (governed by `img_src data:`). The page's own `font_src` is unchanged.
- `style_src` must allow inline styles (`'unsafe-inline'`): `ui.ts` sets `style.textContent = OVERLAY_CSS` on a `<style>` in the shadow root. Bonus Decade already has it.
- `frame_src`: modern-screenshot appends a hidden sandboxed `srcdoc` `<iframe>` to `<body>` (`index.mjs` around lines 665-672). A `srcdoc` frame is not fetched, so `frame_src` should not block it (it inherits the page's policy instead). Bonus Decade's `frame_src` is a tight allowlist (`challenges.cloudflare.com`, `www.youtube-nocookie.com`), so confirm this in the browser console during the plan 5 check.
- **Bonus Decade's CSP is report-only today** (`config.content_security_policy_report_only = true` in `config/initializers/content_security_policy.rb`). Violations show up as reports, not breakage, until someone turns enforcement on. Add the entries above anyway.
- **Exact `connect_src` gaps for capture** (checked against that initializer on 2026-11-20). Today `connect_src` is `:self, https://res.cloudinary.com`. Its other `img_src`/`style_src`/`font_src` hosts are missing, so those images and fonts fall back to the placeholder in screenshots: `https://fonts.googleapis.com`, `https://fonts.gstatic.com`, `https://cdnjs.cloudflare.com`, `https://i.ytimg.com`, `https://*.r2.cloudflarestorage.com`, `https://upload.wikimedia.org`, `https://thumb.wikimedia.org`, `https://covers.openlibrary.org`, `https://archive.org`, `https://*.us.archive.org`. (R2 private media is served through the app's own routes, so check whether presigned R2 URLs ever reach the page before adding that one.)
- **The tap is now pointer-based (ruling 2), but it still needs a real-iPhone check before plan 5 installs the tag.** On a page with no click handlers, tap a heading, a paragraph and a photo, and confirm a pin drops each time. Also scroll with a finger and confirm no pin drops. Chromium mobile emulation cannot reproduce iOS click synthesis.

## Small known gaps (fix when touched)
- Fixed-position elements shift in the capture (the viewport crop uses a root `translate`).
- The JPEG fallback (browsers without WebP encode) turns transparent canvas areas black.
- Text-fallback locator search picks the outermost match and never matches text over 200 characters.
- Capture-phase host shortcuts still see keys typed in the overlay textarea. (Page handlers on `pointerdown`/`touchend` no longer fire on a review tap; see ruling 2.) Window-level capture listeners still run before the overlay's document listeners.
- Firefox capture takes about 12 s against the 12 s cap, so `has_screenshot` in the firefox e2e can flake on a slow machine. (The timeout e2e now fast-forwards past the screenshot wait and waits for the POST before fast-forwarding the 30 s save timeout.)
- The capture clones the whole document and fetches every image on it, not just the viewport. On a long article that costs time and data; consider filtering out nodes outside the viewport.
- A sheet near the bottom of a short page can still cover the pin (scroll is clamped).
- e2e `global-setup` `kill()` leaves a 5 s timer pending; the cross-origin test swallows an image decode error (assert `naturalWidth > 0`).
- Overlay load failure is silent (no message to the reviewer); `ttf` is stripped from the URL even when the site is not configured.
