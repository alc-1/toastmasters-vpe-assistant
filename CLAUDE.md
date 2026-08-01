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
3. Log in normally at `https://apps.basecamp.toastmasters.org/` (any tab, any time beforehand).
4. Click the extension icon, then "Extract Basecamp data" — no Basecamp tab needs to be open.
5. Inspect the popup summary table and the raw JSON under "Raw data", or check the background
   service worker's console (`chrome://extensions` → this extension → "service worker" inspect
   link) for errors.

Background worker errors surface via the response returned to the popup (`{ ok: false, error }`),
not the console — check `popup.js`'s status line first when debugging a failed scrape.

## Architecture

Two-part extension with a strict one-way trigger flow: **popup → background service worker →
Basecamp API**.

- **`popup/popup.js`** — UI layer only. On click, sends a `{type: "SCRAPE_BASECAMP"}` message to
  the background service worker via `chrome.runtime.sendMessage`. Persists results to
  `chrome.storage.local` (`basecampData`, `basecampScrapedAt`) and restores them on next popup
  open. Does not touch `chrome.tabs` at all.
- **`background.js`** — service worker. `importScripts()`s `lib/basecamp-api.js` and listens for
  the `SCRAPE_BASECAMP` runtime message, calling `scrapeAllClubs()` and returning
  `{ ok: true, data }` / `{ ok: false, error }`. Also the intended home for future work
  (`chrome.alarms` scheduling, centralizing storage across Basecamp + EasySpeak, delta
  computation).
- **`lib/basecamp-api.js`** — all scraping logic, loaded into the service worker via
  `importScripts` (classic script, not an ES module):
  1. `GET /api/members/roles` → clubs, filtered to those where the current user has `is_bcm: true`.
  2. For each such club, paginates `GET /api/bcm/progress/?club={uuid}&page=N` following the `next`
     field until `null` (capped at 200 pages as a safety guard).
  - Authentication is implicit: `fetch(..., { credentials: "include" })` runs from the background
    service worker, a privileged extension context. Because `manifest.json`'s `host_permissions`
    covers the Basecamp hosts, this fetch bypasses normal cross-site cookie restrictions and the
    browser's existing session cookie is sent automatically — no Basecamp tab needs to be open, and
    there is no manual cookie handling anywhere in this codebase.

Data shape produced by a scrape: `Record<clubUuid, {name: string, members: object[]}>`, where each
entry in `members` is one member×path progress record as returned by the Basecamp API (a member on
multiple paths appears multiple times).

## Planned direction (not yet implemented)

Per `README.md`'s "Next steps", the next phases are: an equivalent scraper for EasySpeak,
matching members between the two systems (no shared ID — likely normalized-name matching), and a
delta/report computation. When extending this codebase, keep the Basecamp scraper's pattern
(a `lib/<source>-api.js` module `importScripts`'d into `background.js`, with a message listener and
cookie-based auth via `host_permissions`) as the template for the EasySpeak equivalent rather than
introducing a different architecture.

## Conventions

- UI strings, comments, and README are in English; keep new user-facing text and comments
  consistent with that.
- No transpilation/bundling — code must run as-is in a Manifest V3 service worker / content script
  / popup context (plain `<script src>`, no ES module imports across files, no npm dependencies).
