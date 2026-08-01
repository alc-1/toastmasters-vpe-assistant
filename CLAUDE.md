# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) for a Toastmasters VPE (Vice President Education) to consolidate
member Pathways progress tracking. Current MVP scope is **Basecamp Toastmasters only**: it scrapes
data via Basecamp's internal API and stores it locally. There is no build step, no package manager,
and no test suite — this is plain, unbundled JS loaded directly by Chrome.

## Running / testing changes

There are no build/lint/test commands. To try changes:

1. Open `chrome://extensions`, enable "Developer mode".
2. "Load unpacked" → select this repo's root folder (or "Reload" the extension after edits).
3. Log in normally at `https://apps.basecamp.toastmasters.org/`, stay on that tab.
4. Click the extension icon, then "Extract Basecamp data".
5. Inspect the popup summary table and the raw JSON under "Raw data", or open the popup's
   DevTools console for errors.

Content script errors surface via the response returned to the popup (`{ ok: false, error }`), not
the console — check `popup.js`'s status line first when debugging a failed scrape.

## Architecture

Three-part extension with a strict one-way trigger flow: **popup → content script → Basecamp API**.

- **`popup/popup.js`** — UI layer only. On click, finds the active tab, verifies its URL is on
  `apps.basecamp.toastmasters.org`, and sends a `{type: "SCRAPE_BASECAMP"}` message to the content
  script in that tab via `chrome.tabs.sendMessage`. Persists results to `chrome.storage.local`
  (`basecampData`, `basecampScrapedAt`) and restores them on next popup open.
- **`content-scripts/basecamp.js`** — all scraping logic, injected automatically into any
  `apps.basecamp.toastmasters.org` page (see `manifest.json` `content_scripts`). Listens for the
  `SCRAPE_BASECAMP` message and:
  1. `GET /api/members/roles` → clubs, filtered to those where the current user has `is_bcm: true`.
  2. For each such club, paginates `GET /api/bcm/progress/?club={uuid}&page=N` following the `next`
     field until `null` (capped at 200 pages as a safety guard).
  - Authentication is implicit: `fetch(..., { credentials: "include" })` runs in the page's own
    origin/context, so the browser's existing session cookie is sent automatically. There is no
    manual cookie handling anywhere in this codebase.
- **`background.js`** — currently just logs on install. It's the intended home for future work
  (`chrome.alarms` scheduling, centralizing storage across Basecamp + EasySpeak, delta computation)
  but the popup talks directly to the content script for now — don't assume background.js is in
  the message-passing path today.

Data shape produced by a scrape: `Record<clubUuid, {name: string, members: object[]}>`, where each
entry in `members` is one member×path progress record as returned by the Basecamp API (a member on
multiple paths appears multiple times).

## Planned direction (not yet implemented)

Per `README.md`'s "Next steps", the next phases are: an equivalent scraper for EasySpeak,
matching members between the two systems (no shared ID — likely normalized-name matching), and a
delta/report computation. When extending this codebase, keep the Basecamp scraper's pattern
(host-scoped content script + message listener + cookie-based auth) as the template for the
EasySpeak equivalent rather than introducing a different architecture.

## Conventions

- UI strings, comments, and README are in English; keep new user-facing text and comments
  consistent with that.
- No transpilation/bundling — code must run as-is in a Manifest V3 service worker / content script
  / popup context (plain `<script src>`, no ES module imports across files, no npm dependencies).
