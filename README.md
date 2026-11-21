# tap-to-fix

tap-to-fix lets a reviewer tap a spot on a live page and leave a comment with a screenshot. The site owner then works through each reviewer's batch of comments with Claude Code in a review cycle, marking each one done, saved for later, or kept as is.

## service/

The backend is a Hono app with D1 (SQLite) and R2 storage. Run these from `service/`:

```bash
npm test                  # unit and route tests
npm run dev:node          # dev server on http://localhost:8787 (needs OWNER_TOKEN in .dev.vars or the environment)
bash scripts/smoke.sh     # end-to-end check against the running dev server; ends with "smoke: ok"
```

Production runs as a Cloudflare Worker (deploy comes in a later plan). Local dev and tests run on Node instead, because workerd needs macOS 13.5+. The Node dev server keeps its database in `service/.local/dev.sqlite`; screenshots live in memory and are lost on restart.

## Installing the tag on a site

Register the site (`POST /api/owner/sites` with a slug, name, origin and repo), then add one line to the site's pages:

```html
<script src="https://YOUR-SERVICE-ORIGIN/t.js" data-site="your-slug" async></script>
```

The tag does nothing unless the visitor arrives with a reviewer link, so it is safe to ship on every page. Place it before any analytics tag, so the token is gone from the address bar before analytics reads it.

## How a reviewer link works

The owner creates a reviewer and an assignment (a page path on a site). The reviewer's link to that page carries the token in the fragment, `#ttf=TOKEN`, which browsers never send to the site's server, logs or `Referer` headers. (An older `?ttf=TOKEN` link still works.) On load, `t.js` saves the token in `sessionStorage` and removes it from the address bar, then loads the comment layer (`overlay.js`). The reviewer taps a spot, types a comment and saves; the page's address, the element tapped and a screenshot go to the service. The bar's **Done** link (or **Back to your list**) opens the reviewer's list at `/r/#ttf=TOKEN`.

Without a token, nothing appears. On a page not assigned to the reviewer, the bar says "This page isn't on your review list" and every tap goes through to the page as usual. On sites that swap pages without a full reload (Turbo Drive, other routers), the comment layer follows along on `turbo:load`, `popstate` and `pageshow`.

## Browser tests

```bash
cd service
npm run e2e               # builds t.js/overlay.js, then runs Playwright (phone Chromium at 3x, Firefox desktop)
```

The harness starts the service on port 8788 and fixture sites on 4173 and 4174. On Ben's laptop (macOS 12), do not run `npx playwright install`: the browsers come from the existing Playwright cache (chromium-1228, firefox-1532), which matches the pinned `@playwright/test` 1.61.1. On a fresh machine, `npx playwright install chromium firefox` once.

