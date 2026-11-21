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

The tag does nothing unless the visitor arrives with a reviewer link, so it is safe to ship on every page.

## How a reviewer link works

The owner creates a reviewer and an assignment (a page path on a site), then sends the reviewer a link to that page with `?ttf=TOKEN` added. On load, `t.js` saves the token in `sessionStorage` and removes it from the address bar, then loads the comment layer (`overlay.js`). The reviewer taps a spot, types a comment and saves; the page's address, the element tapped and a screenshot go to the service. The bar's "My comments" link opens the reviewer's list at `/r/#ttf=TOKEN`. Without a token, or on a page not assigned to the reviewer, nothing appears.

## Browser tests

```bash
cd service
npm run e2e               # builds t.js/overlay.js, then runs Playwright (phone, desktop Chromium, Firefox)
```

The harness starts the service on port 8788 and fixture sites on 4173 and 4174. First run: `npx playwright install` for the browsers.

