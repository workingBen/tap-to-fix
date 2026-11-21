# Plan 3 (dashboards) — carry-forward notes

Written at the end of plan 3 (2026-11-20). Sources: the SDD ledger and the task 1-3 reviews.

## Decisions made while building (rulings)
- Under a site heading, reviewer rows show only the path (no repeated site name); with one site they keep "Site · /path".
- Reviewer link is `/r/#ttf=TOKEN` and the token stays in the address bar (home-screen use); the owner token is stripped after it is stored.
- 17 px is the floor for all text on both dashboards; the owner page breakpoint is 1200 px (stacked rows below).
- The fix command is `/tap-to-fix:fix <first name lowercased> <site slug>` (`fixCommand` in `client/dash/owner.ts`); each word is nowrap, so it breaks only at spaces.

## For plan 4 (plugin + deploy)
- The skill must match the reviewer by the FIRST WORD of the name, case-insensitive ("Chris Tosswill" is `chris`), and take the site slug as the second argument.
- Cloudflare: verify `/r` redirects to `/r/` and that `public/_headers` (`/*` Referrer-Policy, `/*.js` CORS) is honored on HTML assets. Only the Node dev server was exercised. Check `wrangler.toml` `assets` / `run_worker_first`.
- There is no API to delete a site, so the e2e "Fixture" site shows on the owner page in dev. Add `DELETE /api/owner/sites/:slug` if it should not.

## Deferred minors
- Hash parsing is duplicated between `owner.ts` and `readToken` in `common.ts`; no test for blocked storage.
- The status enum is interpolated raw in `owner.ts`; the revoke flash clears by name, not id (two "Alexis"s clear each other's).
- The owner escape test covers only reviewer name and title; no `failNear` tests for New link, Turn off link and remove.
- Reviewer page: a second tap on a row sends a second `/opened`; `aria-live` is on all of `<main>`; the retry button hard-codes a font; the "updated" e2e relies on a 20 ms sleep.
- No `<noscript>` fallback; row links carry the reviewer token (long-press Copy link shares it).
- Referrer-Policy is asserted only on the 200 health route; the Node `/r` and `/o` redirects are untested.

## Small known gaps
- `data-len` on the progress arc is unused output.
- `e2e/shots-*.ts` need ports 8788/4173/4174 free and write PNGs to the folder you pass.
