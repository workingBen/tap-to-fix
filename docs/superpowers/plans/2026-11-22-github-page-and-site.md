# GitHub Page and Pages Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A README and a one-page GitHub Pages site that sell Tap to Fix to a developer and get them to install it.

**Architecture:** Plain HTML/CSS in `docs/` (`docs/index.html`, `docs/assets/`), served by GitHub Pages from `main:/docs`, as workingBen/proofs does. Screenshots come from the existing `service/e2e/shots-*.ts` scripts plus live greensprings.life. The look is chosen in two design reviews; Tasks 2 and 4 are run by the main session because Ben answers them.

**Tech Stack:** HTML, CSS, Playwright (screenshots), ImageMagick (crop/convert), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-22-github-page-and-site-design.md`

## Global Constraints

- Audience: a developer; the call to action is installing the plugin (two commands, as in the README's Quickstart).
- Every screenshot is real. Business names stay (Greensprings Longevity, Bonus Decade).
- No owner token, LINK_KEY or real reviewer token in any image, page or command line.
- American English; plain words; no em-dash pileups.
- `docs/superpowers/` keeps working; `docs/.nojekyll` so Pages serves files as-is.
- Pages CSS reuses the Paper tokens (`service/client/paper.ts`) and the card's dark green (`#1A3328` → `#2c5a44`, accent `#7FD3A8`), light and dark.

## Review Focus

- A phone at 390px: no sideways scroll on the site; screenshots scale down, never overflow.
- Dark mode: every section readable (`prefers-color-scheme: dark`).
- GitHub's README renderer strips `<style>` and most attributes: README layout must use only Markdown, `<img width>`, `<p align>`, `<picture>` with `prefers-color-scheme` sources.
- Broken image paths: README images must be repo-relative; site images relative to `docs/`.
- The video slot must look finished while empty (a still image), so the site can ship before the video.

---

### Task 1: Real screenshots

**Files:**
- Create: `docs/assets/shots/*.png` (overlay on a phone: pill, comment sheet, saved pin; reviewer dashboard; owner dashboard; the before/after of the Virtual EMF heading at 390px)
- Modify: none in `service/` unless a shots script needs a new `--only` flag

- [ ] Run `npm run build:client && npx tsx e2e/shots-overlay.ts <out>`, `shots-reviewer.ts <out>`, `shots-owner.ts <out>` in `service/` (ports 8788/4173/4174 free).
- [ ] Capture greensprings.life/virtual-emf-assessment at 390px (the "Frequently asked questions" heading); the "Before you book" before comes from `~/page-snapshots/` or git history of longevity-tracker #729.
- [ ] Open every image and confirm no token or secret is visible; crop to content; convert to optimized PNG/WebP under 300 KB each.
- [ ] Commit `docs/assets/shots/`.

### Task 2: Design review round 1 (main session, with Ben)

- [ ] `/proofs:design-review` with two items: the Pages hero (2–3 variants) and the README top: banner + badges + three-step strip (2–3 variants), built from Task 1's shots and the link-preview card style.
- [ ] Publish, get Ben's export, record picks in the working log.

### Task 3: Build the picks

**Files:**
- Create: `docs/index.html`, `docs/site.css`, `docs/.nojekyll`, `docs/assets/banner-light.svg`, `docs/assets/banner-dark.svg`, `docs/assets/how-it-works.svg`
- Modify: `README.md` (pitch on top; current reference sections kept below), `CHANGELOG.md` (Unreleased: README and site)

- [ ] Build the site and README from the accepted variants, all sections in the spec's order.
- [ ] Verify: Playwright screenshots of `docs/index.html` at 1440, 1280 and 390, light and dark; `document.documentElement.scrollWidth <= innerWidth` at 390; every `<img>` loads (`naturalWidth > 0`).
- [ ] Preview the README as GitHub renders it: `gh api markdown -f text=@README.md -f mode=gfm -f context=workingBen/tap-to-fix` into an HTML file, then screenshot it.
- [ ] Commit.

### Task 4: Design review round 2 (main session, with Ben)

- [ ] `/proofs:design-review` of the full built page and README (screenshots at desktop and phone), one item per section; apply REVISE rounds until accepted.

### Task 5: Ship

- [ ] PR, CI green, merge (`gh pr merge --merge`, then delete the branch).
- [ ] Ask Ben before turning on Pages (a repo setting): `gh api -X POST repos/workingBen/tap-to-fix/pages -f 'source[branch]=main' -f 'source[path]=/docs'`, then set the repo homepage to `https://workingben.github.io/tap-to-fix/`.
- [ ] Verify the live URL returns 200 and renders at 390 and 1440.
