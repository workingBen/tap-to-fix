# Tap to Fix: GitHub page and Pages site

Approved by Ben, 2026-11-22 (working log q29, q30).

## Why

The repo went public with v0.4.0, but its README is 148 lines of text with no pictures. It
doesn't sell the product. The audience is a **developer** who should **install the plugin**
right after reading or watching.

## Order

1. README and a GitHub Pages site (this design).
2. A video: real recordings framed like the Proofs tour (30 s silent GIF, about 60 s narrated by
   Ben). It then goes into both.
3. A Greensprings Longevity article about Tap to Fix (longevity-tracker repo, unpublished until
   Ben approves).

## Goals

- One landing page at `https://workingben.github.io/tap-to-fix/`, served from `docs/` like
  workingBen/proofs. One product, so one page.
- Sections: hero (link-preview art, with a slot for the video later) → how it works in three
  steps (a reviewer taps on a phone → you run one command → Claude fixes it and the reviewer sees
  "Done"), each with a real screenshot → the two dashboards → the real story (Ben's "Before you
  book" comment on the Virtual EMF page becoming "Frequently asked questions") → install (four
  commands, since it needs Proofs) → what's stored and security, briefly.
- README: the same story, shorter. A banner in the link-preview card's style, badges (tests,
  license, version), the three-step strip, screenshots, install. The long reference text stays,
  below the pitch.
- Every screenshot is real: the overlay and dashboards from the e2e servers with realistic data
  (`e2e/shots-*.ts`), and the live greensprings.life pages. Business names stay.

## Non-goals and anti-goals

- No separate site generator or framework. Plain HTML/CSS in `docs/`, as Proofs does.
- No made-up screenshots or results: if it's shown, it happened.
- Never expose the owner token, LINK_KEY or a real reviewer token in any screenshot or page.
- Don't break `docs/superpowers/` (specs and plans stay where they are).

## Approach

Design reviews pick the look: round 1 shows the Pages hero and the README top in 2–3 versions
each; the picks get built; round 2 reviews the full page before it goes live. Considered and
dropped: a section on the Proofs site (Tap to Fix needs its own address to share from the
video and article).

## Left to the builder

Exact copy (written plainly, American English), image sizes, and how the site's CSS reuses the
Paper tokens from `service/client/paper.ts` and the dark green of the link-preview card.
