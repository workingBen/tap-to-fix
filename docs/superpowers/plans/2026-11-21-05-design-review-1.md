# Design Review 1 Picks + Missing-Screenshot Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix comments arriving without screenshots, then build Ben's five accepted design picks from "Tap to Fix — Design Review 1": the floating overlay pill, the Comment / Use the page switch, the comment-mode cursor, the per-reviewer owner dashboard, and the assign-pages checklist.

**Architecture:** Three PRs, each on its own branch off a freshly fetched `origin/main`, in this order: **A** `fix/screenshot-capture` (Task 1), **B** `feat/overlay-pill-modes` (Tasks 2-4), **C** `feat/owner-dashboard-columns` (Tasks 5-7). The overlay stays one shadow-root custom element (`client/overlay/`). The dashboard stays as pure render functions plus a thin mount layer (`client/dash/owner.ts`).

**Tech Stack:** TypeScript, Hono (Workers + Node adapter), D1/SQLite, esbuild, vitest + happy-dom, Playwright (chromium + firefox only), modern-screenshot 4.7.0.

**Spec:** the design review at https://claude.ai/artifact/KBZUP33Q4TDdqtgiGJNDng. Its source lives in `.superpowers/design-review-1/`, which is **read-only, never edit it**. `gen.py` holds each variant's HTML, and `mock.css` holds the CSS (also in `spec.json`'s `css`). Rendered references of the five chosen variants: `/private/tmp/claude-501/-Users-you-Local-Documents-Code-rails-longevity-tracker/9b561af0-490f-4859-b256-ba34a8fef3bb/scratchpad/ref/{1-dashboard-B,2-assign-A,3-pill-A,4-mode-A,5-cursor-B}.png` (the `.html` next to each is the same mockup, openable in a browser).

Ben's picks, verbatim intent:
1. Owner dashboard **Variant B, one column per reviewer**: header, link controls, ready command (a ruled strip, not a green box), their pages, then "Assign a page to <name>". Columns sit side by side on a laptop and stack on a phone. Sites go in a short list at the bottom.
2. Assign **Variant A, checklist of recent pages**: pick the reviewer, then tick pages from every page already in use, most recently assigned first, with search. "A page that isn't listed" opens Site / Path / Title fields. Several pages can be assigned at once.
3. Overlay **Variant A, floating pill at the bottom center**. It never covers the site's header. On a phone, the comment count is dropped so the pill stays one line.
4. Mode **Variant A**: two labeled buttons, "Comment" and "Use the page", with the active one filled green. Start in Comment mode and remember the choice across pages. In "Use the page" mode, page clicks reach the page: links, buttons, tabs, details/summary.
5. Cursor **Variant B**: a pulsing dot with ripples and a "Comment" tag, drawn as an element that follows the pointer. Comment mode only, fine-pointer devices only. With prefers-reduced-motion: a steady glow and no pulsing. On touch, the cue is the pill's filled "Comment" button. The mockups' `.hover-ring` (dashed ring) outlines the element under the pointer on fine-pointer devices.

## Global Constraints

- Paper look: tokens from `client/paper.ts` (`--bg #FBF8F2`, `--surf #FFFDF9`, `--ink #1F2A24`, `--mut #5E655F`, `--acc #2F6B4F`, `--line #E4DDCF`, `--soft #EEF4EF`, `--warn #9A5B13`, `--warn-bg #FBEFD9`, `--hf` serif headings). Fewer cards: ruled rows and dividers, no new boxed cards.
- Type: body 17px, secondary text at least 15-16px, no faint text (use `--mut`, never lighter). Tap targets at least 44px.
- Icons: monochrome SVG line icons (stroke `currentColor`), never emoji. Reuse the paths in `gen.py` (PEN, POINTER, LINK, MORE, SEARCH, CHECK, PLUS, X).
- American English in all copy, comments, identifiers and test names.
- Never edit `.superpowers/`. Never run `npm run deploy` or `wrangler deploy`. Never print or cat `~/.config/tap-to-fix/config.json`.
- Tests: run from `service/`: `npm test` (vitest), `npm run e2e` (Playwright; it builds the client first), `npm run typecheck`. Run every test command in the **foreground**. Never run more than two test runs at once. e2e uses fixed ports 8788/4173/4174, so only one e2e run at a time.
- Commit with explicit paths (`git add <paths>`), never `git add -A` / `git commit -a`. Commit trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XcojSjZabHMgJYah5kqGfv
  ```

## Review Focus

1. **A lazy image below the fold that never loads** (the real Greensprings page has 9) must not stall the capture. Covered in Task 1's e2e.
2. **A reviewer presses Save within a second of tapping**, or the capture takes longer than 10 s. The screenshot deadline must run from Save, not from the tap. Task 1.
3. **Use the page mode on a page whose own handlers rely on click/pointer events** (a JS tab, `<details>`, a link). All of them must work, and switching back to Comment must stop them again. Task 3.
4. **Assigning a page the reviewer already has**, or two pages where one POST fails. The page must not be offered twice, and a partial failure must keep the panel open with the failed pages still ticked. Task 7.
5. **A long title or path at 390px** in the columns and the assign panel must not cause horizontal scroll. Tasks 6 and 7 (extend the existing 390px e2e test).

---

## PR A — `fix/screenshot-capture`

### Root cause (already established; do not re-investigate)

On https://greensprings.life/virtual-emf-assessment at 1389x750 in Firefox, `domToCanvas` takes about 19 s (14 s in Chromium). Every comment on that page has `has_screenshot: false`, desktop and phone alike, because the client sent none. Two things add up:

1. modern-screenshot's `createContext` calls `waitUntilLoad(document.documentElement, {timeout})`, which waits on **every `<img>` in the document**. Below-the-fold `loading="lazy"` images never load, so it always waits the full `timeout` (8000 ms).
2. Cloning the whole long page then takes 2-6 s.

`takeScreenshot` races the capture against a **10 s timer that starts at the tap** and returns `null` when it loses. CSP is report-only and was not involved: every image and font request succeeded in under 0.4 s.

A prototype of the fix measured 4.0 s in Firefox and 3.1 s in Chromium, with a correct image.

### Task 1: Bounded image wait, skip below-the-fold nodes, deadline from Save

**Files:**
- Modify: `service/client/overlay/shot.ts`
- Modify: `service/client/overlay/index.ts` (only if the Save-side wait changes; `SHOT_WAIT_MS` stays 12_000)
- Modify: `service/e2e/fixture/index.html` (add the lazy image)
- Test: `service/test/client/shot.test.ts`, `service/e2e/overlay.spec.ts`

**Interfaces:**
- Produces: `export function skipForShot(rect: { top: number; bottom: number }, position: string, viewportH: number): boolean` in `shot.ts`. It returns true when the element starts more than `SKIP_MARGIN_PX = 50` below the viewport (`rect.top > viewportH + 50`) and `position` is not `fixed` or `sticky`.
- `takeScreenshot(pin, exclude): Promise<Blob | null>` keeps its signature.

- [ ] **Step 1: Write failing unit tests** in `test/client/shot.test.ts`:
  - `skipForShot({top: 900, bottom: 1000}, "static", 750)` is `true`; `({top: 790, ...}, "static", 750)` is `false` (inside the margin); `({top: 900, ...}, "fixed", 750)` and `"sticky"` are `false`; `({top: -500, bottom: -100}, "static", 750)` is `false` (above the viewport is kept, because removing it would shift the layout).
  - Using `vi.mock("modern-screenshot")`: `takeScreenshot` calls `createContext` with `timeout: 1`, sets `context.timeout` to `8000` before calling `domToCanvas(context)`, and passes a `filter` that returns false for the `exclude` element.
  - With mocked `loadMedia`: only `<img>` elements that are `!complete` **and** intersect the viewport are awaited, each with `{ timeout: 3000 }`.
- [ ] **Step 2:** Run `npm test -- test/client/shot.test.ts`. Expected: FAIL (`skipForShot` is not exported).
- [ ] **Step 3: Implement in `shot.ts`.**
  - Before capture, `await Promise.all(visibleIncompleteImgs.map((img) => loadMedia(img, { timeout: IMG_WAIT_MS })))` with `IMG_WAIT_MS = 3000`.
  - Then `const ctx = await createContext(document.documentElement, { ...sameOptionsAsToday, timeout: 1, filter })`, then `ctx.timeout = 8000`, then `domToCanvas(ctx)`. The library's own whole-document wait then costs 1 ms, while fetches and the SVG-to-canvas step still get 8 s.
  - `filter(n)`: false for `exclude`. For an Element, false when `skipForShot(n.getBoundingClientRect(), getComputedStyle(n).position, innerHeight)`. Otherwise true.
  - Replace the 10 s race that starts at the tap with a 60 s backstop (`SHOT_BACKSTOP_MS = 60_000`), so a capture can keep working while the reviewer types. Save still waits at most `SHOT_WAIT_MS` (12 s) from the press, in `index.ts`.
  - Comment the reason for each step in two lines.
- [ ] **Step 4:** Run `npm test -- test/client/shot.test.ts`. Expected: PASS.
- [ ] **Step 5: Write the failing e2e test.** In `e2e/fixture/index.html`, append below the existing content a spacer (`<div style="height:3000px">`) followed by `<img loading="lazy" src="http://localhost:4174/photo.jpg?lazy" width="240" height="160" alt="Below the fold">`. Add the test `"a lazy image below the fold does not hold up the screenshot"`: open the page as a reviewer, tap `h1`, fill the textarea, record `Date.now()`, press Save, wait for "Saved". Assert the elapsed time is `< 6000` ms and the batch row has `has_screenshot === true`. Add the test's title to the `firefox-desktop` project's `grep` in `e2e/playwright.config.ts` (that grep is a regex; extend it with `|`).
- [ ] **Step 6:** Check the test fails without the fix: `git stash push service/client/overlay/shot.ts`, run `npm run e2e -- -g "lazy image"`, expect FAIL on elapsed time (≥ 8 s), then `git stash pop`. Then run `npm run e2e` in full. Expected: all pass.
- [ ] **Step 7:** Run `npm run typecheck`. Expected: clean.
- [ ] **Step 8: Commit.** `git add service/client/overlay/shot.ts service/client/overlay/index.ts service/test/client/shot.test.ts service/e2e/fixture/index.html service/e2e/overlay.spec.ts service/e2e/playwright.config.ts docs/superpowers/plans/2026-11-21-05-design-review-1.md`, with the message `Screenshots: bounded image wait, skip below-the-fold nodes, deadline from Save`.

---

## PR B — `feat/overlay-pill-modes` (branch off origin/main after A merges)

Reference: `ref/3-pill-A.png`, `ref/4-mode-A.png`, `ref/5-cursor-B.png`. CSS to port: the `.ov .pill`, `.ov .seg`, `.ov .done`, `.ov .vr`, `.ov .float`, `.cur`, `.ripple`, `.cdot`, `.ctag` and `.hover-ring` rules, the keyframes and the reduced-motion block in `mock.css`, all inside `client/overlay/styles.ts`. Keep the `:host { all: initial !important }` reset and the per-element font, size and color rules.

Add a chromium desktop project to `e2e/playwright.config.ts`: `{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } }, grep: /@desktop/ }`. Tests tagged `@desktop` in their title run there. The existing `phone` project gets `grepInvert: /@desktop/`.

### Task 2: Floating pill at the bottom center

**Files:** Modify `service/client/overlay/ui.ts` and `service/client/overlay/styles.ts`. Test: `service/e2e/overlay.spec.ts`.

**Interfaces:**
- Produces: the bar element keeps `data-ttf="bar"` and the Saved live region keeps `data-ttf="saved"`, so existing e2e helpers still work. The pill gains `data-ttf="count"` on the "Reviewing · N comments" span. `BarState` is unchanged.

- [ ] **Step 1: Write failing e2e tests.**
  - `"the review pill floats at the bottom center and leaves the header uncovered"`: on the phone project, the bar's bounding box has `bottom <= innerHeight - 12`, its center x is within 2px of `innerWidth/2`, and `top > innerHeight/2`. `document.elementFromPoint(innerWidth/2, 10)` is not the overlay host.
  - `"phone pill is one line without the count; desktop shows the count @desktop"`: at 390 the `[data-ttf=count]` is hidden and the bar's height is `< 64`. At 1280 it is visible and contains "Reviewing" and "0 comments".
- [ ] **Step 2:** Run `npm run e2e -- -g "pill"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `.bar` becomes the pill: `position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(18px + env(safe-area-inset-bottom)); border-radius: 999px; max-width: calc(100vw - 16px)`, single row, with the `mock.css` `.ov .pill` look (surface, line border, `0 8px 28px rgba(0,0,0,.28)` shadow).
  - Reviewing content: `[count span][mode group (Task 3)][vr divider][Done link]`. Other states show the message plus their link in the same pill. The message may wrap there, at `max-width: calc(100vw - 16px)`.
  - The count is hidden at `@media (max-width: 599px)`.
  - The "Saved" live region sits just above the pill, centered (absolutely positioned inside the bar at `bottom: calc(100% + 8px)`), so it never widens the pill.
  - The compose and read sheet still slide up from the bottom and cover the pill while open. Hide the bar while the sheet is open (`.root.sheet-open .bar { visibility: hidden }`), so it is never seen half covered.
- [ ] **Step 4:** Run `npm run e2e`. Expected: all pass. Fix existing tests only where they asserted top-bar geometry.
- [ ] **Step 5:** Commit: `git add service/client/overlay/ui.ts service/client/overlay/styles.ts service/e2e/overlay.spec.ts service/e2e/playwright.config.ts`, with the message `Overlay: floating review pill at the bottom center`.

### Task 3: Comment / Use the page switch, remembered across pages

**Files:** Modify `service/client/overlay/ui.ts`, `index.ts` and `styles.ts`. Create `service/client/overlay/mode.ts`. Test: `service/test/client/mode.test.ts` and `service/e2e/overlay.spec.ts`. Extend `e2e/fixture/index.html` with `<button id="counter" onclick="this.textContent=String(+this.textContent+1)">0</button>`, a two-tab widget (`<div role="tablist">` with buttons that toggle `hidden` on two panels via a click listener), `<details id="more"><summary>More</summary><p>Hidden text</p></details>`, and a link to `other.html` if none exists. `other.html` must be assigned to the test reviewer.

**Interfaces:**
- Produces: in `mode.ts`, `export type Mode = "comment" | "use"`, `export const MODE_KEY = "ttf:mode"`, `export function readMode(win: Window): Mode` (sessionStorage; anything missing or unexpected, or storage throwing, gives `"comment"`), and `export function saveMode(win: Window, m: Mode): void` (swallows storage errors).
- Produces: on `OverlayUI`, `setMode(m: Mode): void` (updates the buttons' `aria-pressed`, the `.on` class, and `data-mode` on `.root`), plus `onModeChange: (m: Mode) => void`.
- Consumed by Task 4: `.root[data-mode]`.

- [ ] **Step 1: Write failing unit tests** in `test/client/mode.test.ts` (happy-dom): `readMode` defaults to `"comment"`, returns `"use"` after `saveMode(win, "use")`, gives `"comment"` for a stored `"bogus"`, and gives `"comment"` when `sessionStorage` getters throw. `saveMode` does not throw when `setItem` throws.
- [ ] **Step 2: Write failing e2e tests.**
  - `"starts in Comment mode with Comment pressed"`: the group named "Mode" has "Comment" with `aria-pressed=true` and "Use the page" with `aria-pressed=false`.
  - `"Use the page lets the page's own controls work"`: press "Use the page", then tap `#counter` (its text becomes "1"), the second tab (its panel becomes visible), and `summary` (`#more` is open). No sheet opens and the pin count is unchanged. Press "Comment", tap `#counter`: the text stays "1" and the compose sheet opens.
  - `"Use the page follows links and the mode is remembered on the next page"`: in Use mode, tap the link to `other.html`. The URL changes, and the new page's overlay shows "Use the page" pressed.
- [ ] **Step 3:** Run `npm test -- test/client/mode.test.ts` and `npm run e2e -- -g "mode|Use the page"`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - The segmented control is a `div role="group" aria-label="Mode"` holding two `<button type="button">` elements with PEN and POINTER icons (paths from `gen.py`) and the exact labels "Comment" and "Use the page". The active button is filled `--acc` with white text (`mock.css` `.ov .seg span.on`).
  - In `index.ts` `review()`, keep `let mode = readMode(win)`. Each page-event handler (`onPointerDown`, `onPointerUp`, `onClick`, `onOtherInput`) returns immediately, without `hide()` or `preventDefault()`, when `mode === "use"`.
  - Switching mode: `saveMode`, `ui.setMode`, and reset `down = null`.
  - Pins stay tappable in both modes, and Escape still closes the sheet.
- [ ] **Step 5:** Run `npm test` and `npm run e2e`. Expected: all pass.
- [ ] **Step 6:** Commit the touched paths: `Overlay: Comment / Use the page switch, remembered across pages`.

### Task 4: Comment-mode cursor (pulsing dot + "Comment" tag) and hover ring

**Files:** Modify `service/client/overlay/ui.ts`, `index.ts` and `styles.ts`. Test: `service/e2e/overlay.spec.ts`.

**Interfaces:**
- Consumes: `.root[data-mode]` and `Mode` from Task 3.
- Produces: on `OverlayUI`, `moveCursor(x: number, y: number, target: Element | null): void` and `hideCursor(): void`. Shadow elements carry `data-ttf="cursor"` (holding `.ripple`, `.ripple.r2`, `.cdot`, and `.ctag` with the text "Comment") and `data-ttf="ring"`. Both are `position: fixed; pointer-events: none`, and moved with `transform: translate(...)`.
- Produces: a page-level `<style id="ttf-cursor-style">html, html * { cursor: none !important; }</style>`, present in `document.head` only while the custom cursor is on, and removed on mode change, on sheet open and on session `stop()`.

- [ ] **Step 1: Write failing e2e tests.**
  - `"fine pointer: the Comment cursor follows the mouse in Comment mode only @desktop"`: `page.mouse.move(400, 300)`. `[data-ttf=cursor]` is visible, contains "Comment", and its box center is within 2px of (400,300). `#ttf-cursor-style` exists. `[data-ttf=ring]` is visible around the element at that point. Switch to Use the page: the cursor and ring are hidden and `#ttf-cursor-style` is gone. Move the mouse over the pill: the cursor is hidden.
  - `"reduced motion: steady glow, no animation @desktop"`: `page.emulateMedia({ reducedMotion: "reduce" })`. The computed `animation-name` of `.ripple` is `none`.
  - `"touch: no custom cursor, Comment button is the cue"` (phone project): after a tap, `[data-ttf=cursor]` is hidden, `#ttf-cursor-style` does not exist, and the Comment button has `aria-pressed=true`.
- [ ] **Step 2:** Run `npm run e2e -- -g "cursor|reduced motion|touch"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Fine-pointer check: `win.matchMedia("(hover: hover) and (pointer: fine)").matches`.
  - Listen to `pointermove` on the document (capture, passive) with `pointerType === "mouse"`. Coalesce with requestAnimationFrame. Show the cursor only when the mode is comment, the pointer is fine, no sheet is open, and the event target is outside the overlay host. Hide it otherwise, and on `pointerleave` of `document.documentElement`.
  - The ring is the target element's `getBoundingClientRect()` inflated by 3px, drawn with the `mock.css` `.hover-ring` style. The dot's center sits at the pointer. The tag is offset `left: 18px; top: 14px`, as in the mockup.
  - Animations `ttf-ripple` (1.4s, second ripple delayed .7s) and `ttf-glow` come from `mock.css`. Under `prefers-reduced-motion: reduce`: no animation, `.ripple { transform: scale(1.6); opacity: .8 }`, `.r2 { display: none }`, and the dot's steady glow.
- [ ] **Step 4:** Run `npm run e2e` and `npm test`. Expected: all pass.
- [ ] **Step 5: Screenshots.** Update `e2e/shots-overlay.ts` to write, into `service/.local/shots/`, `overlay-desktop-comment.png` (1280x800, mouse over the hero, cursor visible), `overlay-desktop-use.png`, `overlay-phone-comment.png` (390x844, dpr 3) and `overlay-phone-use.png`. Run it in the foreground (see the header comment in that file for the command).
- [ ] **Step 6:** Commit the touched paths: `Overlay: pulsing Comment cursor and hover ring in Comment mode`.

---

## PR C — `feat/owner-dashboard-columns` (branch off origin/main after B merges)

Reference: `ref/1-dashboard-B.png` and `ref/2-assign-A.png`. CSS to port: the `.v1b *` rules and the shared `.ttf .btn/.btn.q/.btn.line/.ico/.lnk/.st/.av/.cmd/.seg/.counts/.panel/.field/.pick/.box/.sub-h/.already/.panel-foot` rules in `mock.css`, adapted into `OWNER_CSS` in `client/dash/owner.ts`.

### Task 5: `/overview` returns `created_at`, newest first

**Files:** Modify `service/src/routes/owner.ts` (`GET /overview`). Test: `service/test/owner-assignments.test.ts`.

**Interfaces:**
- Produces: each `assignments[]` item gains `created_at: string` (ISO). Assignments are ordered `created_at DESC, id DESC`. `OwnerAssignment` in `client/dash/owner.ts` gains `created_at: string`.

- [ ] **Step 1: Write the failing test** `"overview lists assignments newest first with created_at"`: create two assignments in sequence. `overview.assignments[0].id` is the second one, and each item has a string `created_at` that matches the row.
- [ ] **Step 2:** Run `npm test -- test/owner-assignments.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Before changing the order, grep `bin/` and `client/` for consumers of `overview().assignments` and confirm none depends on oldest-first. If one does (for example `bin/lib/open.mjs` grouping), make it sort explicitly and keep its tests green.
- [ ] **Step 4:** Run `npm test`. Expected: all pass, including `test/cli/*`.
- [ ] **Step 5:** Commit: `Overview: assignments carry created_at, newest first`.

### Task 6: One column per reviewer

**Files:** Modify `service/client/dash/owner.ts` (render functions, `OWNER_CSS`, mount handlers). Test: `service/test/client/dash-owner.test.ts` and `service/e2e/dashboards.spec.ts`.

**Interfaces:**
- Produces: `export function countsText(a: OwnerAssignment): string`, which returns HTML. The open count is `<b>N open</b>`, then "M in progress" and "K settled", joined with " · " and leaving out zeros. When all three are zero it returns "No comments yet".
- Produces: `renderOwner(state)` markup with `data-person="<reviewer id>"` on each column, `data-action="assign" data-id="<reviewer id>"` on the "Assign a page to <First>" button, and `data-sites` on the sites list. `OwnerState.selectedReviewerId` is replaced by `assignFor: string | null` (the reviewer the assign panel is open for; `null` means closed). Task 7 consumes this.
- Unchanged and reused: `readyBatches`, `fixCommand`, `reissueConfirm`, `revokeConfirm`, `removeConfirm`, `copyText`, the flash, and the download-batch action.

- [ ] **Step 1: Write failing unit tests:**
  - `countsText`: `{open:3,in_progress:1,settled:0}` gives `"<b>3 open</b> · 1 in progress"`; all zero gives `"No comments yet"`; `{0,0,2}` gives `"2 settled"`.
  - `renderOwner` with two reviewers:
    - two `[data-person]` columns, in reviewer order;
    - each column holds only that reviewer's pages, in overview order;
    - each column has its ready strip(s), with the command text and a Copy button;
    - "Assign a page to Alexis" and "Assign a page to Ben";
    - the top bar has "Add a reviewer";
    - the sites list at the bottom shows "greensprings.life · 3 pages" (the origin host without the scheme, and the page count);
    - a revoked reviewer's subline says "Link off";
    - no `<table>` remains.
- [ ] **Step 2:** Run `npm test -- test/client/dash-owner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, following `gen.py` `v1b()` markup and `mock.css` `.v1b`.
  - **Top:** brand "tap-to-fix" and a `.btn.line` "Add a reviewer". It reveals the existing add-reviewer form, which is open when there are no reviewers.
  - **People:** CSS grid `repeat(auto-fit, minmax(min(100%, 380px), 1fr))`, column gap 40px. That gives two or three side by side at 1440 and one column under about 800px. `main` stays at `max-width: 1240px`.
  - **Column header:** avatar initial, name (`.pname`, 22px serif), subline "N open comments · link on" (or "Link off"; N is `unsettled_count`, singular "1 open comment"), a quiet "New link" button with the LINK icon (reissue, with the existing confirm), and a MORE (⋯) `<details>` menu. The menu holds "Turn off link" (hidden when revoked) and one "Download <site> batch file" per ready batch, which keeps today's download action and its offline note. The bottom border is 2px `--ink`.
  - The new-link flash renders inside that reviewer's column, under the header.
  - **Ready strip:** `.ready` with a 4px `--acc` left border and no background. It reads "{N} comment(s) ready to fix on {site name}", then the command (`.cmd`) and Copy.
  - **Pages:** ruled rows: title (`.tt`), "Site name /path" (`.tu` + mono), then a meta row with the status chip, `countsText`, the Page link and PR links. The remove X sits at the right, keeping `removeConfirm`.
  - "Assign a page to {First}" is a quiet button at the end of the column. It sets `assignFor` (the panel itself is Task 7; until then it may open a stub).
  - **Sites:** heading "Sites" with "Add a site" (the existing form). Rows read "<b>Name</b> host · N pages", and the slug and repo are kept in a second `.tu` line so the CLI slug stays visible.
  - When there are no sites, the people area says "Add a site first. The form is under Sites, below." When there are no reviewers, the add-reviewer form is open.
- [ ] **Step 4:** Update `e2e/dashboards.spec.ts`. Keep each test's intent (the ready command, download, reissue, turn-off, remove, the 390px no-horizontal-scroll test with a 120-character title) and point the selectors at the new markup. Add `"columns sit side by side at 1440 and stack at 390"`: compare the two `[data-person]` boxes' `top`. Equal at 1440; the second below the first at 390.
- [ ] **Step 5:** Run `npm test` and `npm run e2e`. Expected: all pass.
- [ ] **Step 6:** Commit: `Owner dashboard: one column per reviewer, sites at the bottom`.

### Task 7: Assign pages panel (checklist of recent pages)

**Files:** Modify `service/client/dash/owner.ts`. Test: `service/test/client/dash-owner.test.ts` and `service/e2e/dashboards.spec.ts`.

**Interfaces:**
- Consumes: `OwnerAssignment.created_at` (Task 5) and `OwnerState.assignFor` (Task 6).
- Produces:
  - `export type PageCandidate = { site: string; path: string; title: string; lastAssignedTo: string[]; lastAssignedAt: string }`.
  - `export function pageCandidates(overview: Overview, reviewerId: string): { candidates: PageCandidate[]; already: OwnerAssignment[] }`. Pages are unique by `site + path`. A page the reviewer already has goes in `already`. Candidates are sorted by `lastAssignedAt` descending. `lastAssignedTo` holds the first names of everyone who has the page, most recent first. `title` comes from the most recent assignment.
  - `export function filterCandidates(list: PageCandidate[], query: string, sites: Site[]): PageCandidate[]` is a case-insensitive substring match on title, path and site name. A blank query returns the list unchanged.
  - `export function relativeDay(iso: string, now: Date): string` returns "today", "yesterday" or "N days ago", by local calendar day.

- [ ] **Step 1: Write failing unit tests** for:
  - `pageCandidates`: dedupes a page held by two reviewers (`lastAssignedTo: ["Ben", "Alexis"]` when Ben's is newer), puts the target reviewer's own pages in `already`, and sorts newest first.
  - `filterCandidates`: "DET" matches "Digital Detox"; "/gifts" matches by path; "alexis art" matches by site name.
  - `relativeDay`: same day, the day before, and 3 days before.
  - The panel render: heading "Assign pages", a "To" segmented control with `aria-pressed` on the chosen reviewer, a search box labeled "Find a page", the sub-heading "Most recently assigned", one checkbox row per candidate with "Assigned to Alexis · today", "Already on Ben's list: Home page, Gifts buying club", "A page that isn't listed", and a submit that reads "Assign 2 pages to Ben", "Assign 1 page to Ben", or is disabled with "Assign pages to Ben" when nothing is ticked.
- [ ] **Step 2:** Run `npm test -- test/client/dash-owner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The panel is `role="dialog" aria-modal="true" aria-labelledby` its heading, with a dimmed backdrop. On a laptop (≥ 700px) it is a 600px panel fixed to the right edge, full height, scrolling inside. On a phone it is full screen.
  - Escape and the X close it, and focus returns to the button that opened it.
  - Search filters live. Ticks survive search, re-renders, and a reviewer switch (keep the set of `site + path` keys in mount state; switching the reviewer drops keys that reviewer already has).
  - "A page that isn't listed" reveals Site (select), Path and Title, using the existing `field()` and validation messages. A filled manual page counts as one more page in the submit label.
  - Submit POSTs `/api/owner/assignments` once per page, in sequence. On full success: close, reload the overview, and show the new rows in the reviewer's column. On any failure: keep the panel open, untick the pages that succeeded, keep the failed ones ticked, and show the error line.
  - Remove the old inline "Assign a page" adder.
- [ ] **Step 4: Add e2e tests:**
  - `"assign two existing pages to a second reviewer at once"`: both rows appear in that reviewer's column, newest first.
  - `"a page that isn't listed adds a new page"`.
  - `"assign panel has no horizontal scroll at 390"`.
- [ ] **Step 5:** Run `npm test` and `npm run e2e`. Expected: all pass. Then run `npm run typecheck`. Expected: clean.
- [ ] **Step 6: Screenshots.** Update `e2e/shots-owner.ts` to write `owner-1440.png`, `owner-390.png` (full page), `assign-1440.png` and `assign-390.png` into `service/.local/shots/`. Seed data that matches the mockup: three sites, Alexis and Ben, and six pages across them.
- [ ] **Step 7:** Commit: `Owner dashboard: assign several recent pages at once`.
