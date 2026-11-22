# Contributing

Thanks for helping. This file covers setting up, running the tests, and what a good pull request
looks like.

## Set up

You need Node 22.13 or newer (`service/.nvmrc` pins 22).

```bash
git clone https://github.com/workingBen/tap-to-fix.git
cd tap-to-fix/service
npm ci
npx playwright install chromium firefox   # once, for the browser tests
```

To try it locally, put an owner token in `service/.dev.vars` (`OWNER_TOKEN=some-long-random-string`)
and run `npm run dev:node`. The service answers on http://localhost:8787, and the owner dashboard
is at `/o/#owner=<that token>`. You do not need a Cloudflare account for local work: dev and tests
run on Node, with D1 backed by `node:sqlite` and R2 kept in memory.

## Run the tests

From `service/`:

```bash
npm test             # unit and route tests (Vitest)
npm run typecheck    # TypeScript for the Worker, the browser client and the e2e harness
npm run e2e          # browser tests (Playwright: phone Chromium at 3x, Firefox desktop)
```

All three must pass before a pull request is merged. Run `npm run e2e` for any change to
`service/`, since the browser code and the API are tested together there.

For a change in behavior, write the test first and watch it fail. Bug fixes come with a test that
would have caught the bug.

## Pull requests

- **One concern per pull request.** A bug fix, a feature, or a docs change, not all three. Small,
  focused pull requests are reviewed faster and are easier to revert.
- Branch from the latest `main`, and give the branch a name that says what it does
  (`fix/pin-on-rotated-phones`, `docs/setup-snags`).
- Write commit messages that say what changed and why: a short first line, then a body if the
  reason is not obvious.
- Update the README or `SECURITY.md` when behavior they describe changes, and add a line under
  **Unreleased** in `CHANGELOG.md` for anything a user would notice.
- If a change touches the skills or the `ttf` CLI, bump `version` in `.claude-plugin/plugin.json`.
- A schema change needs a new numbered file in `service/migrations/`. Never edit a migration that
  has already shipped.

## Style

- **American English everywhere:** code, comments, docs, test names and UI text (`color`, `gray`,
  `behavior`, `canceled`).
- UI text is plain and short. Reviewers are often older and on phones, so keep type large (17 px
  minimum for reviewer screens) and avoid jargon.
- Icons are monochrome line icons. No emoji in the UI.
- Never log, print or put a token in a URL query string. Reviewer tokens travel in the URL fragment
  or an `Authorization` header.

## Reporting a security problem

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
