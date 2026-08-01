# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) for a Toastmasters VPE (Vice President Education) to consolidate
member Pathways progress tracking, from two sources: **Basecamp Toastmasters** (a clean internal
JSON API) and **EasySpeak** (`tmclub.eu`, no API — HTML pages that must be parsed). Both scrapers
store their extraction locally; there's no build step, no package manager, and no test suite — this
is plain, unbundled JS loaded directly by Chrome.

## Running / testing changes

There are no build/lint/test commands. To try changes:

1. Open `chrome://extensions`, enable "Developer mode".
2. "Load unpacked" → select this repo's root folder (or "Reload" the extension after edits).
3. Log in normally at `https://apps.basecamp.toastmasters.org/` and/or `https://tmclub.eu/` (any
   tab, any time beforehand).
4. Click the extension icon, then "Extract Basecamp data" and/or "Extract EasySpeak data" — no
   Basecamp tab needs to stay open. EasySpeak scraping will briefly take over a `tmclub.eu` tab
   (reusing one if open, otherwise opening and focusing a new one — see Architecture for why), which
   **closes the popup immediately** (Chrome tears down `action` popups as soon as they lose focus,
   and stealing tab/window focus is exactly what `ensureEasySpeakTab()` does). Reopen the popup once
   that tab is done to see the result — see the storage note below for why this works.
5. Inspect the popup summary table and the raw JSON under "Raw data", or check the background
   service worker's console (`chrome://extensions` → this extension → "service worker" inspect
   link) for errors. Code injected into the EasySpeak tab via `chrome.scripting` logs to that
   *tab's* own DevTools console, not the service worker's.

Background worker errors surface via the response returned to the popup (`{ ok: false, error }`),
not the console — check `popup.js`'s status line first when debugging a failed scrape.

There's no automated test harness in the extension itself, but the HTML-parsing logic in
`lib/easyspeak-parser.js` (`parseProfileLinks`, `parseMemberchart`, `parseLevelCell`) is pure and
DOM-based (takes a `Document`, no `chrome.*` dependency), so it can be exercised standalone with
`jsdom` outside the browser — useful for validating parsing changes against the fixtures in
`example/` (see below) without reloading the extension. There's no checked-in script for this; spin
one up in the scratchpad if needed.

## Architecture

Two scraper pipelines with different shapes, sharing one trigger flow from the popup: **popup →
background service worker → source-specific scraper**.

- **`popup/popup.js`** — UI layer only. Two buttons, each sending its own message
  (`{type: "SCRAPE_BASECAMP"}` / `{type: "SCRAPE_EASYSPEAK"}`) to the background service worker via
  `chrome.runtime.sendMessage`, sharing one `onScrapeClick` helper parameterized by message type,
  storage keys, and a render function. On receiving a response, it also writes to
  `chrome.storage.local` (`basecampData`/`basecampScrapedAt`, `easyspeakData`/`easyspeakScrapedAt`)
  and restores from there on next popup open — **but this popup-side write cannot be the only copy**
  (see the `lib/*-api.js` bullets below). Does not touch `chrome.tabs` itself — all tab handling for
  EasySpeak lives in `lib/easyspeak-api.js`.
- **`background.js`** — service worker. `importScripts()`s `lib/basecamp-api.js` and
  `lib/easyspeak-api.js`, and has one `onMessage` listener with a branch per message type, each
  calling the matching `scrapeAll*()` function and returning `{ ok: true, data }` /
  `{ ok: false, error }`. Also the intended home for future work (`chrome.alarms` scheduling,
  centralizing storage across both sources, delta computation).
- **`lib/basecamp-api.js`** — all Basecamp scraping logic, loaded into the service worker via
  `importScripts` (classic script, not an ES module). No tab needed at all: `fetch(..., {
  credentials: "include" })` runs directly from the privileged service worker context, and because
  `manifest.json`'s `host_permissions` covers the Basecamp hosts, the browser's existing session
  cookie is sent automatically.
  1. `GET /api/members/roles` → clubs, filtered to those where the current user has `is_bcm: true`.
  2. For each such club, paginates `GET /api/bcm/progress/?club={uuid}&page=N` following the `next`
     field until `null` (capped at 200 pages as a safety guard).
  3. Writes the result to `chrome.storage.local` itself before returning, for the same reason
     `lib/easyspeak-api.js` does (see below) — belt-and-suspenders here since Basecamp doesn't steal
     focus, but the popup can still close mid-scrape for other reasons (user clicks away, etc.), and
     losing a completed scrape's result silently is worse than one redundant write.
- **EasySpeak is architecturally different, and deliberately so** — don't "simplify" it to match
  Basecamp's fetch-only shape. `tmclub.eu` is behind Cloudflare, which blocks plain `fetch()`/`XHR`
  outright regardless of which extension context issues it (background worker, content script, or
  an offscreen document all get challenged identically) — Cloudflare's bot detection tells a real
  page navigation apart from a programmatic fetch via the `Sec-Fetch-Mode`/`Sec-Fetch-Dest` request
  headers (`navigate`/`document` vs. `cors`/`empty`), and only an actual tab navigation produces the
  former. A background-fetch-plus-`chrome.offscreen`-DOM-parsing design was tried first and
  confirmed broken in real testing (Cloudflare's "Just a moment..." managed-challenge page came back
  instead of the real content) before landing on the current tab-navigation design — if you're
  tempted to move EasySpeak back to a tab-less fetch for symmetry with Basecamp, it will not work.
  - **`lib/easyspeak-api.js`** — orchestration, `importScripts`'d into `background.js`:
    `ensureEasySpeakTab()` finds an existing `tmclub.eu` tab to reuse (focusing it) or creates and
    focuses a new one (visible, not hidden, so the user can solve an interactive Cloudflare puzzle
    if the usually-automatic "managed" challenge ever escalates to one). `loadAndParse(tabId, url,
    parseFnName)` calls `navigateAndWaitForRealPage(tabId, url)`, which registers its
    `chrome.tabs.onUpdated`/`onRemoved` listeners **before** calling `chrome.tabs.update(tabId,
    {url})`, and only resolves on an actual `"complete"` event whose `tab.url` matches the target
    url and whose `document.title` is no longer `"Just a moment..."`. This ordering matters: an
    earlier version called `chrome.tabs.update()` first and then eagerly checked the tab's state —
    but `tabs.update()`'s promise only confirms the navigation was *requested*, not that it started,
    so that eager check was racing against the still-loaded *previous* page and silently resolving
    against it, causing every club after the first to parse a copy of the previous club's page. Once
    the real page is confirmed loaded, `loadAndParse` injects `lib/easyspeak-parser.js` via
    `chrome.scripting.executeScript({ files: [...] })` and invokes the named parser function by
    name (`window[fnName]()`) in a second `executeScript` call, returning its result.
    `scrapeAllEasySpeakClubs()` ties it together: `profile.php?mode=editprofile` → clubs, then
    `memberchart.php?chart=10&c={clubId}` per club → members; closes the tab afterward only if it
    was created by this call (a pre-existing tab is left as-is, and a self-created tab is left open
    on failure so the user can see/solve whatever went wrong); then writes the result to
    `chrome.storage.local` (`easyspeakData`/`easyspeakScrapedAt`) itself before returning. **This
    direct write is load-bearing, not redundant with popup.js's**: `ensureEasySpeakTab()` steals
    tab/window focus, and Chrome closes an `action` popup the instant it loses focus — so the popup
    that triggered the scrape is gone long before `scrapeAllEasySpeakClubs()` resolves, and its
    `await chrome.runtime.sendMessage(...)` in `onScrapeClick` never gets a chance to run its
    follow-up storage write. This was a real bug (background logs confirmed each club scraped
    correctly with distinct data, but the popup never showed updated results because it had already
    been torn down) — don't remove this write to "avoid duplication" with popup.js.
  - **`lib/easyspeak-parser.js`** — pure DOM-parsing functions, no `chrome.*` dependency at all
    (this is what makes them injectable via `chrome.scripting` *and* independently testable with
    `jsdom`). Each takes a `Document` defaulting to the global `document`, since in the real tab
    they're called with no arguments and operate on that tab's live page:
    - `parseProfileLinks(doc)` — extracts clubs from `profile.php`'s "Links:" block. Scoped to
      `a[href^="view_meeting.php?c="][href*="&show=next"]` specifically — the page also has
      unrelated nav links (e.g. `viewagenda_mobile.php?c=...&show=next`) reusing the same
      `show=next` query param for a different purpose.
    - `parseMemberchart(doc)` — extracts the member×path roster from `memberchart.php`. Don't
      assume `table.forumline` is unique by class name alone — the page has multiple (e.g. an
      announcement banner); the roster table is disambiguated by its `Name`/`Path` column headers.
    - `parseLevelCell(td)` — the needed/done counting rule (deliberately chosen, not the only
      reasonable one): mandatory speech icons (`icon_box`/`icon_tick`/`icon_tick_dkgreen`/
      `icon_question_bubble`/`icon_clock`) sitting directly in a level cell count 1:1 (done if
      ticked); role icons (`icon_b_box`/`icon_tick_orange`) are never counted; "bucket" `<span>`s
      (`style` containing `border:1px dashed`) only count when their `title` matches `Complete N
      elective speech(es)`, contributing `N` to needed and `min(ticksInBucket, N)` to done — other
      bucket types (roles, named series like Successful/Better Speaker/Leadership Series) are
      skipped entirely.

Data shape produced by a scrape (both sources): `Record<clubId, {name: string, members: object[]}>`,
one entry in `members` per member×path row. Basecamp's member objects are raw API progress records;
EasySpeak's are `{memberId, name, path, levels: [{level, needed, done}, ...]}`. This shared
`Record<clubId, {...}>` shape is intentional — it's what future member-matching/delta computation
across the two sources will key off of.

`example/` holds real (anonymize before sharing) HTML fixtures for the two EasySpeak pages
(`profile.php_mode=editprofile`, `memberchart.php_chart=10&c=359`) — the source of truth for the
parsing logic in `lib/easyspeak-parser.js`. If EasySpeak's markup changes, re-capture fresh fixtures
there before touching the parser.

## Planned direction (not yet implemented)

Per `README.md`'s "Next steps": matching members between the two systems (no shared ID — likely
normalized-name matching) and a delta/report computation. When extending this codebase with a new
data source, don't assume Basecamp's tab-less fetch pattern is the default template — check first
whether the target site can be reached with a plain privileged `fetch()` (works if there's no bot
protection distinguishing fetch from navigation) or needs EasySpeak's tab-navigation +
`chrome.scripting` approach (required for anything behind Cloudflare or similar).

## Conventions

- UI strings, comments, and README are in English; keep new user-facing text and comments
  consistent with that.
- No transpilation/bundling — code must run as-is in a Manifest V3 service worker / content script
  / popup context (plain `<script src>`, no ES module imports across files, no npm dependencies).
