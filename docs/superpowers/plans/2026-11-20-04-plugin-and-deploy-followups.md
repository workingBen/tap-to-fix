# Plan 4 followups: what the deploy settled, and what plan 5 needs

Deployed 2026-11-21 to Ben's Cloudflare account. Live check: ok.

## Live service

- Origin: `https://tap-to-fix.greensprings.workers.dev` (account workers.dev name `greensprings`, registered through the API because the account had none).
- Verified live: `/api/health` 200; `/t.js` sends `Access-Control-Allow-Origin: *`; `/r` → 307 `/r/`, both with `Referrer-Policy: no-referrer`; `/api/owner/overview` 401 without the token, 200 with it. This closes the plan 3 followup on Cloudflare's `/r` redirect and `_headers`.
- Owner token: in `~/.config/tap-to-fix/config.json` only. Opened in Ben's browser straight from that file; never printed into a transcript.

## Sites added

| slug | origin | repo |
|---|---|---|
| bonus-decade | https://bonusdecade.life | workingBen/longevity-tracker |
| greensprings | https://greensprings.life | workingBen/longevity-tracker |
| alexis-art | https://alexis-art.example | workingBen/longevity-tracker |
| low-emf-life | https://lowemf.life | workingBen/low-emf-life |

The `www.` hosts all 301 to the apex, so the apex is the origin. `alexis-art.example` answered 404 at `/` on 2026-11-21; check it before assigning Alexis Art pages.

## For plan 5 (Bonus Decade hookup)

One tag per layout, choosing `data-site` by host (bonusdecade.life → `bonus-decade`, greensprings.life → `greensprings`, alexis-art.example → `alexis-art`), placed before the analytics tag:

```html
<script src="https://tap-to-fix.greensprings.workers.dev/t.js" data-site="bonus-decade" defer></script>
```

CSP additions (the full list is in the plan 2 followups): `https://tap-to-fix.greensprings.workers.dev` in `script_src` and `connect_src`, plus the screenshot hosts listed there. low-emf-life gets the same tag with `data-site="low-emf-life"` in its own repo.

## Found during the deploy

- A new Cloudflare account has no workers.dev name, and `wrangler deploy` fails non-interactively. Registering one by `PUT /accounts/<id>/workers/subdomain` works with the wrangler login; the name takes about 150 s to answer, so the deploy's first live check fails and a rerun passes. `deploy.mjs` could wait and retry `/api/health` for up to three minutes instead.
- The failed first run had already made an owner token and put it as a secret, but saved no config, so the second run made another. Harmless (the secret is overwritten), but `deploy.mjs` could save the config before `wrangler deploy`.
- Cloudflare's bot check returns 403 "error code: 1010" to Python's default user agent. The `ttf` CLI uses Node's `fetch`, which passes.
- Safari's OAuth callback fails with "No CSRF value available in the session cookie"; `wrangler login --browser=false` plus Firefox works. Its link expires after about two minutes.
