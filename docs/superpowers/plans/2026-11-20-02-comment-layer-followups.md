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

## For plan 3 (dashboards)
- Dashboard links go to `/r/#ttf=TOKEN` (the overlay's "My comments" link already builds it; fragment, so it is never sent to a server).
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
- `style_src` must allow inline styles (`'unsafe-inline'`): `ui.ts` sets `style.textContent = OVERLAY_CSS` on a `<style>` in the shadow root. Bonus Decade likely already has it for Tailwind; verify.

## Small known gaps (fix when touched)
- Fixed-position elements shift in the capture (the viewport crop uses a root `translate`).
- The JPEG fallback (browsers without WebP encode) turns transparent canvas areas black.
- Text-fallback locator search picks the outermost match and never matches text over 200 characters.
- Capture-phase host shortcuts still see keys typed in the overlay textarea; page handlers on `pointerdown`/`touchend` still fire on a review tap.
- Firefox capture takes about 12 s against the 12 s cap, so `has_screenshot` in the firefox e2e can flake on a slow machine; the timeout e2e assumes the shot has settled before `fastForward`.
- A sheet near the bottom of a short page can still cover the pin (scroll is clamped).
- e2e `global-setup` `kill()` leaves a 5 s timer pending; the cross-origin test swallows an image decode error (assert `naturalWidth > 0`).
- Overlay load failure is silent (no message to the reviewer); `ttf` is stripped from the URL even when the site is not configured.
