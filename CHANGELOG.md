# Changelog

All notable changes to tap-to-fix are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the plugin version
(`.claude-plugin/plugin.json`) follows [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.4.0 - 2026-11-22

### Added

- MIT license.
- A README for first-time readers: how it works, a quickstart, and what is stored where.
- `SECURITY.md`: how to report a vulnerability, what is in scope, and every limit on reviewer writes.
- A GitHub Actions test workflow (unit tests, typecheck and browser tests) on every pull request
  and every push to `main`.
- `CONTRIBUTING.md` and this changelog.

### Security

- Reviewer tokens in a `?ttf=` query string are refused; only the header and the `#ttf=` fragment count.
- Saving a comment requires the site's `Origin` header.
- New comments are capped: 5,000 characters of text, 1 MB + 64 KB per request (413 past either),
  and 2,000 characters per location field (dropped past it, comment kept).
- Each reviewer can save 20 comments a minute and 300 a day (429 with `Retry-After` past either).
- The comment layer explains a 413 or 429 and keeps the reviewer's text.

## 0.3.0 - 2026-11-22

### Added

- Owner dashboard: **Copy link** and **Text link** for each reviewer, so a link can be handed out
  again. Reviewer tokens are now also kept sealed with AES-GCM under a new `LINK_KEY` Worker secret
  (migration `0002_reviewer_token_enc.sql`). Sign-in still matches only the token's hash.
- Owner dashboard: one column per reviewer, with sites at the bottom, and assigning several recent
  pages at once.
- Comment layer: a floating review pill at the bottom center, with a **Comment** / **Use the page**
  switch remembered across pages, a pulsing cursor and a hover ring in Comment mode.

### Changed

- Header counts on the owner dashboard match the strips below them.
- Screenshots wait a bounded time for images, skip nodes below the fold, and start their deadline
  from **Save**.

### Fixed

- The assign panel no longer leaks its scroll lock, shows failures, and cannot close mid-save.
- The review pill clears bottom banners, fits a 320 px screen, and keeps its width for long
  status messages.

## 0.2.0 - 2026-11-21

### Added

- `ttf open` and `/tap-to-fix:list`: every comment not settled yet, grouped by reviewer, site and
  page, each batch ending with the command that fixes it.
- `/tap-to-fix:fix` with no arguments (or only a reviewer) lists what is waiting and asks which
  batch to work.

## 0.1.0 - 2026-11-20

### Added

- The service: a Cloudflare Worker with D1 and R2 for sites, reviewers, assigned pages, comments
  with screenshots, status rollups, and a batch and status API for fix runs. Local dev and tests run
  on Node with `node:sqlite` and in-memory R2 adapters.
- The script tag (`t.js`) and comment layer (`overlay.js`): it wakes only for a reviewer link, keeps
  the token in the URL fragment and strips it from the address bar, drops a pin where the reviewer
  taps, and saves the comment with a screenshot downscaled to 1200 px and 1 MB. It never loses the
  comment text, follows Turbo and other page swaps, and runs inside Shadow DOM.
- The reviewer dashboard (`/r/`): pages to review with progress circles and "updated since you
  looked" chips.
- The owner dashboard (`/o/`): reviewers, sites, assignments, status, PR links, a downloadable batch
  file, and the command that starts each review cycle.
- The Claude Code plugin: `/tap-to-fix:setup` deploys the service to your own Cloudflare account,
  and `/tap-to-fix:fix` turns one reviewer's comments on one site into a proofs review cycle,
  reporting each comment's status back, with an offline queue for status updates.

