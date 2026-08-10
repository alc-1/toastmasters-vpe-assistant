# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) for a Toastmasters VPE (Vice President Education) to consolidate
member Pathways progress following, from two sources: **Basecamp Toastmasters** (a clean internal
JSON API) and **EasySpeak** (no API — HTML pages that must be parsed; runs as three separate
regional deployments — `tmclub.eu` (default), `toastmasterclub.org`, `easy-speak.org` — picked on
Setup, see `shared/settings-store.ts` below). Both scrapers store their extraction locally.

The extension is written in **TypeScript, built with Vite + `@crxjs/vite-plugin`**, under `src/`
(see "Architecture" below for the full tree). This is a deliberate reversal of an earlier
"no bundler, no npm dependencies" convention that used to be documented here — see "Conventions" for
what replaced it, and don't reintroduce the old plain-`<script>`/`importScripts` pattern.

## Running / testing changes

1. `npm install` once.
2. `npm run build` — type-checks (`tsc --noEmit`) then runs `vite build --mode store`, producing
   `dist/store/` (the Chrome Web Store submission candidate manifest — see "Two build targets"
   under "Build tooling" below). `npm run build:preview` does the same for `dist/preview/` (the
   tester-facing preview manifest) — the two are functionally identical today, differing only in
   their manifest's `name`/`description`; pick whichever you're testing, `dist/store/` if in doubt.
   Or `npm run dev` for Vite's dev server (works for iterating on popup/options page UI in a normal
   browser tab, but MV3 service-worker + `chrome.scripting` flows still need a real loaded-unpacked
   reload to test — see the crxjs caveat under "Build tooling" below). `dist/` is gitignored,
   regenerable — never hand-edit anything under it.
3. Open `chrome://extensions`, enable "Developer mode".
4. "Load unpacked" → select `dist/store/` or `dist/preview/` (or "Reload" the extension after
   rebuilding).
5. Log in normally at `https://apps.basecamp.toastmasters.org/` and/or your configured EasySpeak
   server (`https://tmclub.eu/` by default — see Setup to change it; any tab, any time
   beforehand).
6. Click the extension icon, then "Extract Basecamp data" and/or "Extract EasySpeak data" — no
   Basecamp tab needs to stay open (unless a login is required — see Architecture). EasySpeak
   scraping always opens and focuses a brand-new tab on the configured EasySpeak server (never
   reuses an already-open one — see Architecture for why), which
   **closes the popup immediately** (Chrome tears down `action` popups as soon as they lose focus,
   and stealing tab/window focus is exactly what `ensureEasySpeakTab()` does). That tab redirects to
   a "data fetched" confirmation page and closes itself a few seconds later once scraping finishes;
   reopen the popup to see the result — see the storage note below for why this works.
7. Inspect the popup summary table and the raw JSON under "Raw data", or check the background
   service worker's console (`chrome://extensions` → this extension → "service worker" inspect
   link) for errors. Code injected into the EasySpeak tab via `chrome.scripting` logs to that
   *tab's* own DevTools console, not the service worker's.
8. Watch the toolbar icon while a scrape runs: it should animate (spinning), then land on a green
   check or red cross, then revert to the classic icon the next time you open the popup (see
   `background/icon-state.ts` in Architecture). Each source's button should be disabled only while
   *that* source is loading.

Background worker errors surface via the response returned to the popup (`{ ok: false, error }`),
not the console — check `popup/index.ts`'s status line first when debugging a failed scrape.

`.github/workflows/ci.yml` runs `test` then both `build` (store) and `build:preview` on every
push/PR to `main` — a green run there is not a substitute for the manual walkthrough above, which
is the only thing that exercises the real `chrome.*` flows.

`npm run typecheck` (`tsc --noEmit`, no `vite build`) is the fast way to check types alone.

`npm test` (Vitest) runs the real automated suite in `tests/`, against fixtures in `test-data/`:
- `tests/easyspeak-parser.test.ts` exercises the pure, DOM-based HTML-parsing logic in
  `shared/parsers/easyspeak-parser.ts` (`parseProfileLinks`, `parseMemberchart`, `parseLevelCell`)
  via `jsdom` against `test-data/easyspeak/profile.html`/`memberchart.html`.
- `tests/report.test.ts` exercises the matching/diff pipeline split across `shared/sync/conflicts.ts`
  and `shared/sync/delta.ts` (`buildReport`, `matchClubs`, `matchMembers`, `nameScore`,
  `canonicalizePathName`, `matchPaths`, `hasOrphanedPaths`, `diffLevel`, `buildLevelSummary`, etc.) against
  `test-data/report/*.sample.json`, plus inline-literal cases for pure functions like
  `normalizeName`/`levenshtein`.
- `tests/dom-utils.test.ts` covers `shared/dom-utils.ts`'s `escapeHtml`/`escapeAttr`/`warningIconHtml`.
- `test-data/` is **fully synthetic and versioned** (fabricated names, `example.test`/`example.com`
  emails) — deliberately *not* derived from `example/`, which stays a separate, gitignored,
  real-data-only scratch folder for manual debugging that the automated suite never reads.
- Tests use real ESM `import` from `../src/...` — no `require()`/`module.exports` workaround needed
  now that everything is a real TS module (that workaround was only ever needed back when these
  files were plain globals-exporting `<script>`s).
- `vitest.config.ts` is a **standalone config that must not import `vite.config.ts`** — loading the
  `crx()` plugin during a test run breaks, since it expects a manifest, a file writer, and an
  extension environment Vitest doesn't provide.
- Out of scope, unchanged manual-only workflow: `background/api/basecamp.ts`,
  `background/api/easyspeak.ts`, `shared/resolution-store.ts`, `shared/settings-store.ts`'s
  `getEasySpeakServer`/`setEasySpeakServer`, `background/icon-state.ts`, and every popup/options/
  status page — all genuinely `chrome.*`-dependent (tabs, scripting, storage) with no pure logic
  worth isolating.

## Architecture

```
src/
├── background/           # service worker only — never imported from a page
│   ├── index.ts           # entry point: registers the message listener
│   ├── messaging.ts        # onMessage listener + runScrape() helper
│   ├── icon-state.ts       # toolbar icon state machine
│   └── api/
│       ├── basecamp.ts     # Basecamp scraping (fetch-based)
│       └── easyspeak.ts    # EasySpeak scraping (tab-navigation based)
├── content/
│   └── easyspeak-parser.iife.ts   # dynamically-injected into a live EasySpeak tab — see below
├── popup/                 # the active manifest's action.default_popup
│   ├── index.html
│   └── index.ts
├── options/                # five independent pages, NOT a merged options_page/dashboard —
│   │                        # each opened via chrome.tabs.create, exactly like popup does
│   ├── report.html + report.ts       # read-only comparison view ("Club Progress")
│   ├── members.html + members.ts     # interactive member-matching review workflow ("Member Review")
│   ├── settings.html + settings.ts   # demo/mock mode + EasySpeak server picker ("Setup")
│   ├── sync-data.html + sync-data.ts # sync status + Data Extraction card, backed by shared/sync-status-panel.ts ("Sync Data")
│   └── club-review.html + club-review.ts  # club-name lookup + path-name lookup editors ("Club Review")
├── status/                 # background-initiated interstitial pages, no user entry point
│   ├── basecamp-auth.html
│   ├── easyspeak-done.html
│   └── countdown.ts        # shared auto-close-in-5s behavior for both pages above
├── welcome/                 # first-run-only tab, opened by background/index.ts's onInstalled
│   ├── welcome.html
│   └── welcome.ts
└── shared/                 # no chrome.* dependency except storage.ts/resolution-store.ts/settings-store.ts/sync-status-panel.ts/update-store.ts
    ├── types.ts             # the domain type catalog — read this first when touching data shapes
    ├── storage.ts           # the ONLY file allowed to call chrome.storage.* directly
    ├── pages.ts             # extension page URL constants (chrome.runtime.getURL wrapper)
    ├── send-message.ts      # typed chrome.runtime.sendMessage() client for popup/index.ts
    ├── app-shell.ts         # shared header/nav bar (renderAppShell), rendered into #appShell on every options page
    ├── sync-status-panel.ts # shared sync-status summary + Data Extraction logic, used by popup/index.ts and options/sync-data.ts
    ├── dom-utils.ts         # escapeHtml/escapeAttr/warningIconHtml
    ├── settings-store.ts    # EasySpeak server choice
    ├── resolution-store.ts  # the 6 persisted name-resolution keys
    ├── sync/
    │   ├── conflicts.ts      # name/path/member matching + override logic
    │   └── delta.ts          # buildReport orchestrator, diffing, level summary — imports conflicts.ts
    ├── parsers/
    │   └── easyspeak-parser.ts   # pure DOM parsing, imported by content/easyspeak-parser.iife.ts
    └── mock/
        └── mockData.ts       # demo/mock-mode scaffold — NOT wired up anywhere yet
```

**Layering rule, enforced by convention not tooling — don't violate it**: `shared/**` must never
import from `background/**`. `shared/sync/conflicts.ts` and `shared/sync/delta.ts` run only in
options pages (never the service worker) but `delta.ts` imports matching functions from
`conflicts.ts`, so the dependency graph is `options/* → shared/sync/delta → shared/sync/conflicts →
shared/types`, always acyclic. `background/icon-state.ts` conversely is deliberately *never*
imported by any page (it owns a running `setInterval` for the icon spin animation; a second copy
imported into a page would start its own independent interval fighting the background's own over
`chrome.action.setIcon()`) — the popup only ever asks background for the current statuses via the
`POPUP_OPENED` message (`options/sync-data.ts`'s `init()` sends the identical message the same
way, since it drives the same shared `shared/sync-status-panel.ts` rendering/status logic).

Two scraper pipelines with different shapes, sharing one trigger flow from the popup: **popup →
background service worker → source-specific scraper**.

- **`shared/sync-status-panel.ts`** — the shared logic behind the "Data Extraction" card + the
  compact sync-status summary, used by both `popup/index.ts` and `options/sync-data.ts` (see that
  page's bullet below) — the two pages render matching markup with matching element ids
  (`scrapeBasecampBtn`/`statusBasecamp`/`summaryBasecamp`/`rawDataBasecamp` and the EasySpeak
  equivalents, plus a shared `#statusSummary` root) and both call into this module instead of
  duplicating the rendering/formatting/scrape-click code. Exports `bindSourceEls()` (looks up a
  source's four elements by id), `onScrapeClick()` (sends `{type: "SCRAPE_BASECAMP"}` /
  `{type: "SCRAPE_EASYSPEAK"}` to the background service worker via `shared/send-message.ts`'s
  typed `sendMessage()`, parameterized by message type, storage keys, and a render function; takes
  an optional `onDone` hook for page-specific post-scrape follow-up), `renderScrapeResult()`
  (merges what used to be two near-identical `renderBasecampResult`/`renderEasySpeakResult`
  functions — both only ever touched the shared `{name, members}` shape), and
  `renderStatusSummary()` (renders into `#statusSummary`, returns the cached
  `{basecampData, easyspeakData}` so each page can layer its own follow-up on top — e.g. the
  popup's subtitle update — without this module needing to know about it). On a successful scrape,
  `onScrapeClick()` writes to `chrome.storage.local` itself (via `shared/storage.ts`'s
  `local.set`: `basecampData`/`basecampScrapedAt`, `easyspeakData`/`easyspeakScrapedAt`) — **this
  write cannot be the only copy** (see the `background/api/*.ts` bullets below). Loading is
  communicated purely via the triggering button itself (`setButtonLoading`: disabled + relabeled
  to "Basecamp data loading..." / "EasySpeak data loading..."), **not** the status line or the
  summary/raw-data panels — `onScrapeClick` never touches `els.status`/`els.summary`/`els.rawData`
  while a request is in flight, so "Last extraction: ..." and the previous result stay visible the
  whole time; only a completed extraction or an error updates the status line.
- **`popup/index.ts`** — UI layer only, composed on top of `shared/sync-status-panel.ts`. `init()`
  sends `{type: "POPUP_OPENED"}` before anything else, both to let background acknowledge any
  finished success/error status (see `background/icon-state.ts` below) and to learn whether either
  source is currently `"loading"`, so it can apply the same disabled/relabeled button state even
  though this popup instance didn't trigger the in-progress scrape itself (e.g. reopening the
  popup while EasySpeak is still running in its own tab). Restores cached data on open via
  `renderScrapeResult()`, and passes an `onDone` hook into each `onScrapeClick()` call that
  re-renders the status summary and updates `updateReportButton()`/`updatePopupSubtitle()` — both
  of which stay popup-only (no such buttons/subtitle element on `options/sync-data.ts`). Does not
  touch `chrome.tabs`, `chrome.action`, or `chrome.storage.session` itself — all tab handling for
  EasySpeak lives in `background/api/easyspeak.ts`, all icon/status handling lives in
  `background/icon-state.ts`, both background-only.
- **`options/sync-data.html` + `options/sync-data.ts`** — a thin page wired up against
  `shared/sync-status-panel.ts`: same Data Extraction card + sync-status summary markup as the
  popup (same element ids), same underlying rendering/formatting/scrape-click logic, no duplicated
  code. Unlike the popup it isn't torn down when `ensureEasySpeakTab()` steals tab/window focus,
  since it's a regular tab, not an `action` popup — so a scrape triggered here survives exactly the
  focus-loss event that kills the popup mid-scrape (see `background/api/easyspeak.ts` below). Has
  its own `chrome.storage.onChanged` listener re-running `init()`, matching the other long-lived-
  tab options pages' convention (the popup doesn't need this since it's re-created fresh on each
  open). No report/review-matches buttons or Setup link — those stay popup-only.
- **`background/index.ts`** — service worker entry point, imports `messaging.ts` and calls
  `registerMessageHandlers()`. Built by crxjs as a real ESM bundle (`"type": "module"` in the built
  manifest) — the old `importScripts()` classic-script loading pattern is gone; every dependency is
  a plain `import`. Also registers `chrome.runtime.onInstalled`: on `details.reason === "install"`
  only (never `"update"`, so an existing user reloading/upgrading the extension never sees this
  again) it opens `welcome/welcome.html` in a new tab via `pageUrl(PAGES.welcome)` — Chrome doesn't
  pin a freshly installed extension's toolbar icon by default, so this page exists purely to point
  a first-time user at the puzzle-piece menu and prompt them to pin it, then hands off to Setup via
  its own "Get started" button (`location.href = pageUrl(PAGES.settings)`, navigating that same tab
  rather than opening a second one). `welcome/welcome.ts` has no `chrome.storage`/resolution-store
  dependency at all — it's a static walkthrough, not part of the stepper flow those five options
  pages share (no `app-shell.ts` nav on it), so it isn't wired into `NAV_ITEMS`.
- **`background/index.preview.ts`** — `manifest.preview.json`'s `background.service_worker` entry,
  **not** `manifest.store.json`'s (which still points at plain `background/index.ts` above). A
  physically separate file, not a runtime flag inside `index.ts`: it does `import "./index"` (runs
  the identical shared setup) then calls `background/api/update-checker.ts`'s
  `registerUpdateChecker()`. This is what keeps the preview-only "check GitHub for a newer preview
  release" poller (`chrome.alarms` every 6h + on install/update, badges the toolbar icon, fires one
  `chrome.notifications` toast per newly-seen version) — and every string in it, including the
  GitHub API host — physically out of the store build's bundle graph, verified by
  `.github/workflows/ci.yml` grepping `dist/store/` for it. `alarms`/`downloads`/`notifications`
  permissions and the `api.github.com` host permission are likewise only in `manifest.preview.json`.
  The download+instructions flow (`shared/update-store.ts`'s `startUpdateDownload()`) is called both
  from the popup's update banner and from `chrome.notifications.onClicked` directly — no
  message-passing round trip, same reasoning as `options/members.ts`'s direct resolution-store
  writes (no service-worker-lifetime constraint applies here, unlike EasySpeak's tab-navigation).
- **`background/messaging.ts`** — the `onMessage` listener: `SCRAPE_BASECAMP`/`SCRAPE_EASYSPEAK`
  both go through a shared `runScrape(source, scrapeFn, sendResponse)` helper that brackets the call
  with `setSourceStatus(source, "loading"/"success"/"error")` (see below) before `sendResponse({ok:
  true, data} / {ok: false, error})`; `POPUP_OPENED` calls `acknowledgeIconStatuses()` and replies
  with the resulting statuses (note this response is a bare `IconStatuses`, not the `{ok,data}`
  envelope the two scrape messages use — a pre-existing inconsistency, preserved and now visible in
  `shared/types.ts`'s `ResponseFor<M>` type rather than implicit). `background/index.ts` is also the
  intended home for future work (`chrome.alarms` scheduling, centralizing storage across both
  sources, delta computation).
- **`background/icon-state.ts`** — toolbar icon state machine, imported only by `background/index.ts`
  (via `messaging.ts`) — see the layering rule above for why it must never be imported by a page. It
  owns a running `setInterval` for the spin animation. Follows `{basecamp, easyspeak}` status
  (`"idle"|"loading"|"success"|"error"`) in `chrome.storage.session` (via `shared/storage.ts`'s
  `session` wrapper) — session-scoped, not `.local`, specifically so a status can never survive a
  browser restart and permanently disable a button. `combineStatus()` reduces both sources to the
  single icon shown, priority **loading > error > success > idle**. `setSourceStatus()` is called by
  `runScrape()` around each scrape. `acknowledgeIconStatuses()` is called on `POPUP_OPENED`: reverts
  any `success`/`error` source back to `idle` (opening the popup = "seen it") but leaves `loading`
  alone. The loading icon is a real 8-frame animation
  (`public/icons/loading/{0..7}-{16,32,48,128}.png`, 150ms/frame — `public/` is copied verbatim
  into `dist/<target>/icons/` by Vite, so these paths are unchanged from before the migration
  aside from the `<target>` segment added by the preview/store split); the interval only runs
  while the combined state is `loading` and is stopped the moment it isn't.
- **`background/api/basecamp.ts`** — all Basecamp scraping logic. Data fetching itself needs no tab:
  `fetch(..., { credentials: "include" })` runs directly from the privileged service worker context,
  and because the manifest's `host_permissions` covers the Basecamp hosts, the browser's existing
  session cookie is sent automatically.
  1. `GET /api/members/roles` → clubs, filtered to those where the current user has `is_bcm: true`.
  2. For each such club, paginates `GET /api/bcm/progress/?club={uuid}&page=N` following the `next`
     field until `null` (capped at 200 pages as a safety guard).
  3. Writes the result to `chrome.storage.local` itself before returning, for the same reason
     `background/api/easyspeak.ts` does (see below) — belt-and-suspenders here since Basecamp
     doesn't steal focus, but the popup can still close mid-scrape for other reasons (user clicks
     away, etc.), and losing a completed scrape's result silently is worse than one redundant write.
  4. **Not-logged-in fallback**: `fetchJson()` is the sole place a request is made, and the sole
     place a 401/403 is detected. On a 401/403 it calls `waitForBasecampLogin()`, which always opens
     a brand-new `apps.basecamp.toastmasters.org` tab via `ensureBasecampDashboardTab()` (mirroring
     `ensureEasySpeakTab()` below — neither ever reuses an already-open tab, so the user's own open
     tabs are never hijacked mid-navigation) and navigates it to `/dashboard/bcm-dashboard/approvals`
     — a page that itself redirects an unauthenticated visitor to Basecamp's own auth flow, then
     redirects back to that same approvals URL once login succeeds. `waitForLoginRedirect()`
     registers its `chrome.tabs.onUpdated`/`onRemoved` listeners **before** calling
     `chrome.tabs.update()`, for the identical race-avoidance reason documented below for
     `navigateAndWaitForRealPage()`, and simply ignores every "complete" event until the tab's URL is
     exactly the approvals URL again (no Cloudflare-challenge or restricted-text checks are needed
     here, unlike EasySpeak, since Basecamp's own redirect is the only signal that matters) — capped
     at a flat 5-minute timeout. Once resolved, `fetchJson()` retries the original request exactly
     once; a second 401/403 (e.g. wrong account) throws instead of looping. Once
     `waitForLoginRedirect()` resolves, `waitForBasecampLogin()` redirects the tab to
     `status/basecamp-auth.html` (via `shared/pages.ts`'s `pageUrl()`) — a confirmation page
     explaining that auth succeeded and the scrape is continuing in the background — instead of
     closing it, so the user gets explicit confirmation of a successful login. Like EasySpeak's
     equivalent confirmation page below, it auto-closes the tab 5 seconds later via the shared
     `status/countdown.ts` (see there), with a visible countdown and a "Keep this tab open" button to
     cancel it. On failure/timeout, the tab is left open exactly as-is (not redirected) so the user
     can see what went wrong.
- **EasySpeak is architecturally different, and deliberately so** — don't "simplify" it to match
  Basecamp's fetch-only shape. All three EasySpeak deployments (see `shared/settings-store.ts`
  below) sit behind Cloudflare, which blocks plain `fetch()`/`XHR` outright regardless of which
  extension context issues it (background worker, content script, or an offscreen document all get
  challenged identically) — Cloudflare's bot detection tells a real page navigation apart from a
  programmatic fetch via the `Sec-Fetch-Mode`/`Sec-Fetch-Dest` request headers (`navigate`/`document`
  vs. `cors`/`empty`), and only an actual tab navigation produces the former. A
  background-fetch-plus-`chrome.offscreen`-DOM-parsing design was tried first and confirmed broken
  in real testing (Cloudflare's "Just a moment..." managed-challenge page came back instead of the
  real content) before landing on the current tab-navigation design — if you're tempted to move
  EasySpeak back to a tab-less fetch for symmetry with Basecamp, it will not work.
  - **`background/api/easyspeak.ts`** — orchestration. Every domain-specific URL is derived at call
    time rather than hardcoded: `scrapeAllEasySpeakClubs()` reads the configured server via
    `getEasySpeakServer()` (`shared/settings-store.ts`) into a `root` (`https://${server}`) used to
    build both `profile.php`/`memberchart.php` URLs; `navigateAndWaitForRealPage(tabId, url)` derives
    its own `loginPath` from `` `${new URL(url).origin}/login.php` `` rather than a fixed constant,
    so it works against whichever server `url` itself points at without needing a separate
    parameter. `ensureEasySpeakTab()` always creates and focuses a brand-new tab (never reuses an
    already-open one on that server, so the user's own open tabs are never hijacked mid-navigation —
    visible, not hidden, so the user can solve an interactive Cloudflare puzzle if the
    usually-automatic "managed" challenge ever escalates to one). `loadAndParse(tabId, url,
    parseFnName)` calls `navigateAndWaitForRealPage(tabId, url)`, which registers its
    `chrome.tabs.onUpdated`/`onRemoved` listeners **before** calling `chrome.tabs.update(tabId,
    {url})`, and only resolves on an actual `"complete"` event whose `tab.url` matches the target
    url and whose `document.title` is no longer `"Just a moment..."`. This ordering matters: an
    earlier version called `chrome.tabs.update()` first and then eagerly checked the tab's state —
    but `tabs.update()`'s promise only confirms the navigation was *requested*, not that it started,
    so that eager check was racing against the still-loaded *previous* page and silently resolving
    against it, causing every club after the first to parse a copy of the previous club's page.
    `navigateAndWaitForRealPage` also handles an unauthenticated session, which EasySpeak signals two
    different ways depending on the page — both of which the plain exact-`tab.url` check above would
    otherwise just wait out until timeout (misreporting either as a stuck Cloudflare challenge):
    `profile.php` redirects the request to `login.php` instead of serving it, but `memberchart.php`
    instead serves a "restricted to full members" message inline, at the same url, without
    redirecting anywhere (discovered when a session expired mid-testing: the profile page still
    listed the officer clubs from a stale response, giving no visible sign anything was wrong, until
    the very next per-club `memberchart.php` request came back restricted). Both cases converge on
    the same wait: once `tab.url` is seen starting with `login.php` (the first case) — or, for the
    second case, once the loaded page's body text is seen containing "restricted to full members", at
    which point the function proactively navigates the tab to `login.php` itself rather than waiting
    for a redirect that isn't coming — the function stops comparing against the original target (it'll
    never match) and re-arms its timeout to a much longer 5 minutes, since a human has to type
    credentials, waiting for the tab to navigate away from `login.php`. EasySpeak's own post-login
    redirect lands close to but not exactly on the originally-requested URL (e.g. missing our
    `#tab_ti` fragment, carrying a new `&sid=` param instead), so the function re-issues
    `chrome.tabs.update(tabId, {url})` itself once login is detected, now that the session is
    authenticated, and reverts the timeout back to the normal 30s. This lives in
    `navigateAndWaitForRealPage` itself (not `scrapeAllEasySpeakClubs`), so it transparently covers a
    session that expires mid-scrape too, not just one that's already expired before the first
    `loadAndParse` call. Once the real page is confirmed loaded, `loadAndParse` injects the built
    parser bundle (see the `?iife` bullet immediately below) and invokes the named parser function by
    name in a second `executeScript` call, returning its result. `scrapeAllEasySpeakClubs()` ties it
    together: `profile.php?mode=editprofile#tab_ti` → officer clubs, then
    `memberchart.php?chart=10&c={clubId}` per club → members; writes the result to
    `chrome.storage.local` (`easyspeakData`/`easyspeakScrapedAt`, via `shared/storage.ts`) itself
    first, then redirects the tab to `status/easyspeak-done.html` (via `shared/pages.ts`) — a
    confirmation page that counts down 5 seconds (visibly, via a `#countdown` span) and closes itself
    via `chrome.tabs.remove()` (not `window.close()`, which only works on a tab/window a script itself
    opened via `window.open()`), with a "Keep this tab open" button to cancel the close. This
    countdown/cancel behavior lives in `status/countdown.ts`, shared with `status/basecamp-auth.html`
    (see `waitForBasecampLogin()` above) rather than duplicated per page — each including page just
    needs to define `#countdownText`/`#countdown`/`#cancelBtn`. If anything above throws (Cloudflare
    stuck, login timeout, parse failure), that redirect line is never reached and the tab is left open
    exactly as-is so the user can see/solve whatever went wrong. **The storage write is load-bearing,
    not redundant with popup/index.ts's**: `ensureEasySpeakTab()` steals tab/window focus, and Chrome
    closes an `action` popup the instant it loses focus — so the popup that triggered the scrape is
    gone long before `scrapeAllEasySpeakClubs()` resolves, and its `await sendMessage(...)` in
    `onScrapeClick` never gets a chance to run its follow-up storage write. This was a real bug
    (background logs confirmed each club scraped correctly with distinct data, but the popup never
    showed updated results because it had already been torn down) — don't remove this write to "avoid
    duplication" with `popup/index.ts`.
  - **THE ONE INJECTION PATTERN THAT ISN'T OBVIOUS — read before touching this file.** The parser
    used to be a plain unbundled `.js` file injected by a hardcoded relative path string. Under
    Vite/crxjs, every output file is bundled and content-hashed, so that approach can't work anymore
    — but a naive fix (just `import`ing the parser normally) is actively wrong, not just
    inconvenient. The fix has two parts:
    1. **`src/content/easyspeak-parser.iife.ts`** is a thin entry that imports the pure parsing
       functions from `shared/parsers/easyspeak-parser.ts` and does
       `Object.assign(globalThis, { parseProfileLinks, parseMemberchart, parseLevelCell })`.
    2. `background/api/easyspeak.ts` imports it with **crxjs's `?iife` query, never a bare import
       and never the default `?script` query**:
       ```ts
       import parserFile from "../../content/easyspeak-parser.iife.ts?iife";
       await chrome.scripting.executeScript({ target: { tabId }, files: [parserFile] });
       ```
       `parserFile` resolves at build time to the real, content-hashed output path (verify in
       `dist/store/manifest.json`'s (or `dist/preview/manifest.json`'s) `web_accessible_resources`
       and in the built background chunk if you ever doubt this — crxjs auto-populates the WAR
       entry for this file, don't hand-write one).

       **Why `?iife` and not `?script`**: crxjs's default `?script` query wraps the target module in
       an *async* loader that does `await import(...)` internally. `chrome.scripting.executeScript()`
       resolves as soon as that outer wrapper's *synchronous* portion returns — which is *before* the
       imported module body (and thus the `globalThis` assignment above) has actually run. The very
       next line calls the named parser function by name in a second `executeScript` call; with the
       default loader this would be a genuine, intermittent race — "function is not defined" some
       fraction of the time, worse than a hard failure because it's load-bearing and non-deterministic.
       `?iife` instead bundles a plain classic script that runs to completion synchronously (confirmed
       by inspecting the built output: a single `(function(){...})()` ending in the `Object.assign`
       call, no `import()`/`await` anywhere in it) — so the globals are guaranteed to exist the moment
       the first `executeScript()` call resolves, exactly the invariant the old unbundled file gave
       for free. If you ever see intermittent "not a function" errors from the second `executeScript`
       call, check this first.
  - **`shared/parsers/easyspeak-parser.ts`** — pure DOM-parsing functions, no `chrome.*` dependency
    at all (this is what makes them both wrappable for injection via
    `content/easyspeak-parser.iife.ts` *and* independently testable with `jsdom`). Each takes a
    `Document` defaulting to the global `document`, since in the real tab they're called with no
    arguments and operate on that tab's live page:
    - `parseProfileLinks(doc)` — extracts clubs from the "Connected to these Toastmaster clubs"
      table under the `#tab_ti` tab (`profile.php?mode=editprofile#tab_ti`), keeping only rows
      where the user is a club officer — identified by an `icon_club_exec.gif` icon in that row's
      officer-icon cell — and dropping guest-only rows. That table isn't unique by class name
      (`#tab_ti` also has an unrelated "Information on Speeches" `table.forumline` further down),
      so it's disambiguated by content the same way `parseMemberchart` disambiguates its own table.
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

Data shape produced by a scrape (both sources): `Record<clubId, {name: string, members: object[]}>`
(`BasecampScrape`/`EasySpeakScrape` in `shared/types.ts`), one entry in `members` per member×path
row. Basecamp's member objects are raw API progress records (minus stripped photo/email fields);
EasySpeak's are `{memberId, name, path, levels: [{level, needed, done}, ...]}`. This shared
`Record<clubId, {...}>` shape is intentional — it's what the matching/delta computation below keys
off of.

`example/` holds real (anonymize before sharing) HTML fixtures for the two EasySpeak pages
(`profile.php_mode=editprofile`, `memberchart.php_chart=10&c=359`) — the source of truth for the
parsing logic in `shared/parsers/easyspeak-parser.ts`. If EasySpeak's markup changes, re-capture
fresh fixtures there before touching the parser.

## Matching, persistence, and the review UIs

Basecamp and EasySpeak agree on nothing structurally (different club-id spaces, no shared member
id, differently-spelled club/path names including French/German localization on EasySpeak), so
every level of comparison is a best-effort name-similarity match, not a join — and once a human
corrects a match, that decision must survive future re-scrapes rather than being silently
re-derived (and possibly un-derived) from names again.

- **`shared/sync/conflicts.ts`** — name/path/member matching + override logic, zero `chrome.*`
  dependency. **`shared/sync/delta.ts`** — the diff/summary half plus the `buildReport`
  orchestrator, which imports matching functions from `conflicts.ts` (never the reverse — see the
  layering rule at the top of this section). These two files used to be one (`lib/report.js`); the
  split follows the actual call graph, not just a topic split — `matchPaths()` (conflicts.ts) calls
  `diffLevel`/`diffLevels`/`buildPathCompletion` directly while deciding path pairs (to populate each
  pair's `levels`/`pathCompletion` fields), so those diff helpers live in `conflicts.ts` too, even
  though they're conceptually "diffing" — moving them to `delta.ts` would create an import cycle.
  `buildReport(basecampData, easyspeakData, meta, resolution)` groups each source's member×path rows
  into one entry per person (`groupBasecampMembers`/`groupEasySpeakMembers`, in `delta.ts`), matches
  clubs (`matchClubs`, in `conflicts.ts`: auto-matches only on an *exact* normalized-name match —
  `clubNameScore(...) === 1` — never a partial/fuzzy similarity guess; there's no "suggested club"
  review UI anywhere to correct a wrong fuzzy guess, unlike members, so a club short of exact must be
  pinned via `clubLookup` in Club Review), matches members within each matched club pair (`matchMembers`,
  in `conflicts.ts`: exact-normalized-name short-circuit, else — when fuzzy matching is allowed for
  this call, see below — a `0.3*Jaccard + 0.7*Levenshtein-similarity` blend against
  `NAME_MATCH_THRESHOLD = 0.72`), and matches paths within each matched member (`matchPaths`, in
  `conflicts.ts`: canonicalizes via a French/German `PATH_ALIASES` table). Club and member matching
  share one greedy 1:1 assignment helper, `greedyAssign(candidates, preAssigned)` (internal to
  `conflicts.ts`).
  - The optional 4th param, `resolution` (`ResolutionData` in `shared/types.ts`: `{clubLookup,
    memberLinks, rejectedPairs, memberPathOverrides, memberPathExclusions, pathAliasLookup,
    allowFuzzyMemberMatches}`, all default to empty/hardcoded/`true`), is how persisted decisions
    from `shared/resolution-store.ts` override pure name-similarity matching — omitting it entirely
    reproduces plain automatic matching (exact + fuzzy), unchanged, so any caller that doesn't pass it
    (e.g. a test) keeps working. Precedence, applied *before* scoring/assignment runs: **confirmed
    link > rejected pair (exclusion) > exact name match > fuzzy suggestion (if allowed) > unmatched**.
    Confirmed links/club pins are injected as `preAssigned` entries into `greedyAssign` (claimed
    before any scored candidate, so a fresh high-scoring candidate can never displace a persisted
    decision); rejected pairs are filtered out of candidate generation entirely (so they can never
    resurface as a suggestion); member-scoped path-bind overrides are spliced out of both sides' raw
    path lists in `matchPaths` *before* the normal canonicalization loop runs, force-paired under a
    synthetic key, and tagged `overridden: true` — this is what keeps an override from touching the
    global path-name lookup other members rely on.
  - `resolution.allowFuzzyMemberMatches` (default `true`) is **not** a persisted storage key — it's
    a hardcoded per-caller behavior switch. `options/members.ts` relies on the default (`true`):
    fuzzy suggestions are exactly what that view exists to surface and let a human confirm/reject.
    `options/report.ts` explicitly passes `false`: Club Progress is meant to show only what's
    certain, so an unconfirmed fuzzy guess must never render there as if it were a fact. Setting it
    `false` simply drops fuzzy-confidence candidates from `matchMembers`'s candidate pool before
    `greedyAssign` runs — the pair falls through to the *same* leftover-handling code that already
    produces separate `basecamp-only`/`easyspeak-only` entries for anyone unassigned, so no separate
    "strict" rendering path exists anywhere downstream (the Next Level Summary table and its
    per-row detail in `options/report.ts` all automatically reflect it for free). A
    `memberLinks`-confirmed pair
    (even one originally confirmed from a fuzzy suggestion) is unaffected by this flag either way,
    since confirmed links are seeded as `preAssigned` before candidate scoring ever runs.
  - `matchConfidence` on a member row is `"confirmed"|"exact"|"fuzzy"|null` (`MatchConfidence` in
    `shared/types.ts`). When `matchConfidence === "confirmed"`, `matchSource`
    (`"fuzzy-confirmed"|"manual-search"|null`, threaded all the way from the `memberLinks` entry's
    own `source` field through `matchMembers`'s `preAssigned`/`pairs`) tells the UI *how* the link was
    made — confirming an algorithmic suggestion vs. manually searching for the right person — without
    changing matching precedence at all (both sources are just `"confirmed"` for assignment purposes).
    Member rows also carry `basecampName`/`easyspeakName` (the two raw per-source names, even when
    matched — needed for the Members view's side-by-side columns; `name` stays as the pre-existing
    single display name for the report view). `hasOrphanedPaths(member)` (in `delta.ts`) — both a
    `basecamp-only` and an `easyspeak-only` non-`nonPathway` path present on the same (necessarily
    `presence: "both"`) member — is the exact definition backing the Members view's "Path issues"
    filter.
- **`shared/resolution-store.ts`** — the only place that reads/writes the 6 persisted resolution
  keys in `chrome.storage.local` (alongside the pre-existing `basecampData`/`basecampScrapedAt`/
  `easyspeakData`/`easyspeakScrapedAt` — all 10 keys, plus `easyspeakServer` and `iconStatus`, are
  enumerated in `shared/storage.ts`'s `LocalSchema`/`SessionSchema`, which is the single source of
  truth for storage key names — **do not call `chrome.storage.*` directly from anywhere outside
  `shared/storage.ts`**). Unlike `shared/sync/*`, this file is legitimately `chrome.*`-dependent
  (pure storage I/O) so it isn't Vitest-testable — same as `background/api/basecamp.ts`/
  `background/api/easyspeak.ts`. Used from Club Review, Member Review, and Club Progress (plus
  `shared/sync-status-panel.ts`'s `loadMatchSummary()`, shared by the popup and Sync Data, for the
  Matches count); never imported into `background/`, since none of this needs the service worker.
  Every write is an upsert enforcing a
  1:1 invariant where applicable (e.g. confirming a link first strips any prior record touching
  either id). The Members view can now unlink/unbind everything this file can create (see below) —
  there is intentionally still no "un-reject"/"un-exclude" UI action, mirroring how a rejected pair
  or a path exclusion, once recorded, has no undo either. The 6 keys:
  - `memberLinks: MemberLink[]` (`{basecampUserId, easyspeakMemberId, source:
    "fuzzy-confirmed"|"manual-search", confirmedAt}`) — persisted only for human-reviewed pairs;
    exact matches stay dynamic (recomputed every sync) on purpose, so an exact match that later
    drifts (e.g. a name change) just needs one re-confirm click once it degrades to fuzzy/unmatched.
    `unlinkMember()` removes an entry outright (the Members view's "Unlink" action on a
    `matchConfidence === "confirmed"` row) — this alone does *not* stop the pair from being
    re-matched/re-suggested; pair it with `rejectMemberPair()` for that.
  - `memberRejectedPairs: RejectedPair[]` (`{basecampUserId, easyspeakMemberId, rejectedAt}`) — a
    specific candidate pair the user explicitly dismissed as "not this one"; excluded from candidate
    generation forever after, but doesn't stop either person from matching someone else. Also
    doubles as the "Unlink" action for a `matchConfidence === "exact"` row: an exact match is
    recomputed fresh every call (there's no stored record to delete), so the only way to actually
    break it — and let the user "resolve the matching again" via manual search — is to reject the
    pair so it can't just auto-match right back on the next refresh. **Note the stored key name
    (`memberRejectedPairs`) vs. the in-memory property name (`rejectedPairs`, in `ResolutionData`) —
    a deliberate, pre-existing mismatch, not a bug**, documented in `LocalSchema`'s comment; don't
    "fix" it by renaming, that would silently orphan every existing user's rejected pairs.
  - `clubLookup: ClubLookupEntry[]` (`{basecampClubId, easyspeakClubId, basecampClubName,
    easyspeakClubName}`) — ID pins (not a name-alias table), forcing a 1:1 club match regardless of
    name-similarity score. The two `*ClubName` fields are denormalized purely for the Club Review
    page's display.
  - `pathLookup: PathLookup` (`Record<canonical path name, alias[]>`) — the user-editable form of
    what used to be only the hardcoded `PATH_ALIASES` table (`shared/sync/conflicts.ts`); seeded
    from `PATH_ALIASES` the first time it's read (`ensurePathLookupSeeded`) so the already-verified
    aliases don't regress.
  - `memberPathOverrides: MemberPathOverride[]` (`{basecampUserId, easyspeakMemberId,
    basecampPathName, easyspeakPathLabel, boundAt}`) — member-scoped, not global: fixes the case
    where one member picked mismatched paths across the two systems (both sides orphaned) without
    touching `pathLookup` for everyone else. `basecampPathName`/`easyspeakPathLabel` are the raw,
    verbatim path strings for that member's rows (matched by exact string equality in `matchPaths`,
    not re-normalized). `removeMemberPathOverride()` is the "Unbind" action — the pair just goes back
    through normal canonicalization afterward (may re-match automatically, or fall back to orphaned).
  - `memberPathExclusions: MemberPathExclusion[]` (`{basecampUserId, easyspeakMemberId,
    basecampPathName, easyspeakPathLabel, excludedAt}`) — the member-scoped *inverse* of an override:
    a path pair that canonicalizes together *automatically* has nothing stored to delete (same
    problem as an exact member match), so `excludePathMatch()` records an exclusion instead.
    `matchPaths()` checks this *after* canonicalization groups paths by key — if a "both"-presence
    pair matches an exclusion for that member, it's force-split back into two independently-orphaned
    entries (synthetic keys `` `${key}:basecamp` ``/`` `${key}:easyspeak` ``) instead of the merged
    entry canonicalization would otherwise produce. This is the "Force unbind" action in the Members
    view, letting the user then re-resolve the pair manually (bind to something else, or leave as
    orphan) instead of it snapping back together on every refresh.
- **`options/report.html` + `options/report.ts`** — the comparison page, titled "Club Progress"
  (reached from the popup's "Open Club Progress" button as a full tab, not a popup window —
  `chrome.tabs.create({url: pageUrl(...)})`). Reads `basecampData`/`easyspeakData` straight from
  storage (no live scraping) plus resolution data via `loadResolutionData()` — loading resolution
  here is required, not optional, otherwise this page's "Next Level Summary" would silently diverge
  from what the Members view shows for the same data. `#reportMeta` (`formatReportMeta()`) is a
  single literal sentence rather than two raw timestamps — date-only (no time-of-day, which isn't
  meaningful to a VPE): `"Report generated with data extracted from Basecamp & EasySpeak the
  M/D/YYYY"` when both sources were extracted the same day, or `"...Basecamp the M/D/YYYY &
  EasySpeak the M/D/YYYY"` when they weren't. Renders club tabs, then — all of it scoped to
  whichever club tab is active, not global — a conflict warning banner, a KPI row, and a single
  sortable per-member-path "Next Level Summary" table with expandable per-row detail; there is no
  separate member list/CSV export anymore (see below), and no standalone club-stats line either —
  the per-club member breakdown it used to spell out in prose is redundant with the KPI row's
  Members card and the table itself.

  Both club-scoped blocks below are re-rendered by `renderActiveClub()` on every tab switch, in DOM
  order: `renderConflictWarning(clubPair)` (`#conflictWarning`) — a banner (only rendered when
  there's something to flag) noting the active club pair has no counterpart at all in the other
  system, and/or naming how many of its members are left `presence !== "both"` (an unconfirmed
  fuzzy guess counts as unmatched here too, per `allowFuzzyMemberMatches: false` above), with links
  to Club Review/Member Review respectively; `renderKpiRow(clubPair)` (`#kpiRoot`) — exactly 3
  cards for the active club only: Members, Paths, and Ready to Level Up
  (`isMemberReadyForNextLevel()`, `shared/sync/delta.ts` — also the building block
  `countMembersReadyForNextLevel()` reduces over for its own *global* count, still used as-is by
  the popup's stepper info; the per-club KPI card and the popup's stepper number are deliberately
  different scopes of the same per-member predicate). Both are positioned directly above the "Next
  Level Summary" heading — deliberately club-scoped rather than global, so reviewing one club's tab
  never shows another club's numbers. `renderClubTabs()` separately prefixes a warning-sign icon
  (`warningIconHtml()`, `shared/dom-utils.ts` — shared with
  `options/members.ts`, see below; each page defines its own `.warning-icon`/`.conflict-warning`
  CSS) onto any club tab whose pair has no counterpart on the other side, and appends a
  `.tab-count` badge (same convention as `options/members.ts`'s own tab badges) showing that club's
  `needsAction()` count (`shared/sync/delta.ts` — fuzzy suggestion, unmatched, or a path issue),
  shown only when > 0 — this tab-level badge/icon is a fast at-a-glance signal across *all* clubs,
  complementary to (not replaced by) the active club's own detailed banner. Neither the tab badge
  nor any presence badge in the table/detail renders for `presence === "both"` — only the
  Basecamp-only/EasySpeak-only exceptions are shown, since those are the only ones actionable.

  "Next Level Summary" (`renderSummaryTable()`/`renderSummaryBody()`) is the page's only
  member-facing table — the old separate "Member List" of per-member `<details>` cards is gone,
  folded into this table as expandable detail rows instead. Each row carries a
  `` `${memberKey}::${pathKey}` `` composite key (`data-row-key`, built from `memberKey()` and
  `PathReport.canonicalKey` — both from `shared/sync/delta.ts`/`shared/types.ts`'s
  `LevelSummaryRow.memberKey`/`.pathKey`, added specifically so a row survives being re-sorted
  without losing its link back to the source `MemberReport`/`PathReport`) and is followed by an
  always-rendered `<tr class="detail-row">` sibling, hidden via a `.collapsed` class exactly like
  `options/members.ts`'s own path-review detail rows. A single delegated `click` listener on
  `tbody` (attached once, in `renderSummaryTable()`) resolves the clicked row via
  `closest("tr[data-row-key]")`, toggles its key in the module-level `expandedRowKeys: Set<string>`,
  and flips the sibling's `.collapsed` class directly — no full re-render needed for the toggle
  itself. Several rows can stay expanded at once. `expandedRowKeys` is cleared whenever the active
  club changes (both on a tab click and on a full `renderClubTabs()` rebuild), so switching clubs
  always starts collapsed. `renderRowDetail()` looks the row's member up in a module-level
  `activeMembers: Map<string, MemberReport>` (rebuilt in `renderActiveClub()` from the active
  club's `members[]`, keyed by `memberKey()`), finds the specific `PathReport` by `canonicalKey`,
  and renders the member's presence/confidence badges plus the same level-by-level diff table
  (`renderLevelRow()`/`renderPathCompletionRow()`, unchanged) the old member cards used to show —
  reused, not reimplemented.
- **`options/members.html` + `options/members.ts`** — the primary member-matching review workflow,
  titled "Member Review" (reached from the popup's "Member Review" button, and cross-linked with
  Club Review/Club Progress). Same storage-reads-only pattern as `report.ts`.
  `renderClubMatchWarning()` (`#conflictWarning`, called from `refresh()`) mirrors `report.ts`'s
  conflict banner but with member-matching-specific advice: whenever any club has no counterpart in
  the other system, it names the affected club(s) and points at Club Review, since a club with
  nothing to match against can't be member-matched properly — best
  fixed before spending time reviewing that club's members. `renderClubTabs()` also prefixes the
  same `warningIconHtml()` icon onto those clubs' tabs, same as `report.ts`. One spreadsheet-style
  table per club (club tabs reused from `report.ts`'s pattern), **Basecamp name first** (Basecamp
  is the source of truth) then EasySpeak name / member-link status / path-bind status / actions, plus
  filter chips (All / To do / Suggested / Unmatched / Path issues / Linked manually — "To do" is the
  default view and means Suggested ∪ Unmatched ∪ Path issues) and a fixed sort (action-needed rows
  first, alphabetical by **Basecamp name** — `sortName()`, falling back to the EasySpeak name only
  when a member has no Basecamp counterpart — within each group, even inside "All").
  `classifyMember()` (`shared/sync/delta.ts` — exported from there, alongside `memberKey()` and
  `needsAction()`, specifically so `options/report.ts`'s club-tab badges and this page's own tab
  badges/filter chips agree on what "needs attention" means for the same club) tags are **not
  mutually exclusive**: a member can carry more than
  one at once (e.g. a manually-confirmed link that still has an unresolved path issue shows under
  both "Path issues" and "Linked manually", so each chip stays an accurate view of everything that
  needs — or already got — a fix, rather than the two being an either/or classification).
  `"linked-manually"` is pushed whenever `matchConfidence === "confirmed"` (regardless of
  `matchSource`) *or* the member has a `memberPathOverride` bound (`hasPathOverride()`,
  `shared/sync/delta.ts`, next to `hasOrphanedPaths()`) — the member identity may have matched
  automatically, but a human still had to manually correct which path pairs with which. There's
  deliberately no `"linked-automatically"` tag/chip: a plain automatic match with nothing to flag
  simply carries no tags at all, and is still visible via "All". The "Member link" column shows a
  "Linked manually" badge (reusing the `.badge-confirmed` styling) for any `matchConfidence ===
  "confirmed"` row, with a tooltip distinguishing "confirmed from a suggested match" vs. "linked via
  manual search" via `matchSource`; the "Path bind" column shows a "Bound" badge (also
  `.badge-confirmed`, tooltip listing the bound path pair(s)) instead of a blank dash once
  `hasPathOverride()` is true — otherwise a resolved override would leave that column looking empty
  (`hasOrphanedPaths()` goes back to `false` once bound), silently losing the "this was manually
  corrected" signal the row's classification now depends on.

  Every `presence === "both"` member (except a still-`"fuzzy"` suggestion, which uses
  Confirm/"Not this one" instead) gets an **"Unlink"** action in the Actions column —
  `onUnlink()` calls `unlinkMember()` for a `"confirmed"` row, or `rejectMemberPair()` for an
  `"exact"` row (see `shared/resolution-store.ts` above for why exact needs rejection, not deletion).
  `hasReviewablePaths(member)` (`presence === "both"` and at least one non-`nonPathway` path) —
  broader than `hasOrphanedPaths()` — gates the "Review path(s)" toggle, so it's available on
  essentially every linked member, not just ones with an active orphan. The expanded
  `renderPathBindDetail()` lists three kinds of rows: **matched paths** (`presence === "both"`)
  each with "Unbind" (if `overridden`, calls `removeMemberPathOverride()`) or "Force unbind"
  (if automatic, calls `excludePathMatch()`) — one or the other, never both, since an overridden
  pair never re-enters normal canonicalization; **orphan pairs** (the pre-existing bind/leave-as-
  orphan picker, unchanged); and a fallback note when only one side has a leftover orphan with
  nothing to bind it to. Both club tabs and filter chips carry a count badge
  (`.tab-count`/`.chip-count`) computed via `needsAction()`/`matchesFilter()` against that club's own
  `members[]` — filter-chip counts are re-rendered by `renderActiveClub()` every time the active
  club or filter changes (so they always reflect the currently-selected club, not a global total),
  while a club tab's badge only appears when that club actually has action-needed members (a
  fully-resolved club shows no badge, rather than a "0"). A missing name cell becomes a
  `<input list> + <datalist>` type-ahead (native, not a custom dropdown — deliberate choice,
  accepted limitation: can't show rich per-candidate metadata) whose candidate pool is the other
  side's currently-unmatched members in the same club; the datalist option's visible text embeds the
  candidate's id as a `"Name (#id)"` suffix so a typed/selected value can be resolved back to an id
  without a second lookup. A suggested (fuzzy) row's "Not this one" button immediately persists the
  rejection (`rejectMemberPair`) — it doesn't wait for a replacement pick — then re-renders, so the
  pair's own row and the newly-freed-up other-side row (if it isn't the same UI position) both land
  in the normal unmatched state with the identical search component; "Confirm"/"Bind for this member
  only"/manual "Link" writes all go straight through `shared/resolution-store.ts` with no
  `background/`-side message type, since this is plain `chrome.storage.local` I/O any extension page
  can do itself (unlike EasySpeak's tab-navigation, which genuinely needs the service worker's
  lifetime across popup teardown — that constraint doesn't apply here). **Every write triggers a
  full `refresh()`** (re-read storage, rebuild the whole report, re-render) rather than a targeted
  DOM patch — simplest way to stay correct given how much a single decision can ripple (e.g. one
  rejection turns one row into two), and consistent with the rest of this codebase's
  rebuild-and-reassign-`innerHTML` rendering style. A member with more than one simultaneous
  orphaned path pair renders one picker row per `basecamp-only` path (`<select>` over that member's
  `easyspeak-only` candidates) rather than assuming exactly one pair.
- **`options/settings.html` + `options/settings.ts`** — titled "Setup". Just the demo/mock mode
  toggle and the EasySpeak server picker (small, low-cardinality, edited rarely — no live-recompute
  loop like `members.ts`; each section just re-reads its own storage after a write). The mock mode
  card (`getMockMode()`/`setMockMode()`, `shared/settings-store.ts`) toggles whether "Extract
  Basecamp data"/"Extract EasySpeak data" return built-in demo data instead of contacting the real
  sites. The EasySpeak server section renders a `<select>` from `EASYSPEAK_SERVERS`
  (`shared/settings-store.ts`) preselected via `getEasySpeakServer()`, with an explicit "Save"
  button (matching this page's existing button-triggered-write convention rather than auto-saving
  on `change`) that calls `setEasySpeakServer()`; a "Saved." confirmation (`.save-status.visible`)
  is hidden again the moment the selection/checkbox changes, so it can't linger next to an unsaved
  new choice. Changing the server does **not** clear any already-extracted
  `easyspeakData`/`easyspeakScrapedAt` — it only affects the URL the *next* "Extract EasySpeak
  data" run targets, same as any ordinary stale-data situation; the help text calls this out. Club
  name lookup and path name lookup used to live on this page too — they moved to their own "Club
  Review" page (see below) since they're a different concern (reconciling scraped data) from this
  page's remaining "which source/mode" settings.
- **`options/club-review.html` + `options/club-review.ts`** — titled "Club Review". Club-name
  lookup and path-name lookup editors, split out of `options/settings.ts`. The club section is a
  review table (every club from both sources, not just already-pinned ones), same shape/vocabulary
  as `options/members.ts`'s member-matching table: a status badge per club pair (Exact/Suggested/
  Linked manually/Unmatched) and Confirm/"Not this one"/Unlink actions, backed by `matchClubs()`
  (`shared/sync/conflicts.ts`, `allowFuzzy: true` — unlike `buildReport()`'s own `matchClubs()`
  call, this is the one place a fuzzy club-name suggestion is meant to be reviewed) and
  `pinClub()`/`rejectClubPair()`/`removeClubPin()` (`shared/resolution-store.ts`); the "add mapping"
  form is populated from `basecampData`/`easyspeakData`'s current club lists (excluding
  already-pinned ones). The path section edits `pathLookup` directly via `setPathAliases()`/
  `deletePathCanonical()`; adding a new canonical name lowercases it before saving, since
  `canonicalizePathName()` always lowercases the raw path before consulting the lookup, so a
  mixed-case key would simply never match.
- **`shared/settings-store.ts`** — storage I/O for general extension settings, currently just the
  EasySpeak server choice (`easyspeakServer` key). Deliberately **not** folded into
  `shared/resolution-store.ts`, which is scoped specifically to member/club/path matching decisions —
  this is a different, unrelated concern. `EASYSPEAK_SERVERS` (id + display label for each of the
  three deployments) and `DEFAULT_EASYSPEAK_SERVER` (`"tmclub.eu"`) are the single source of truth
  for both the Setup dropdown and `getEasySpeakServer()`'s fallback (used whenever the stored
  value is absent or isn't one of the three known ids — defensive against a future removed/renamed
  entry). Used from both `options/settings.ts` (for the dropdown) *and* `background/api/easyspeak.ts`
  (because the actual URL construction that needs the chosen server happens in the service worker).
- **`shared/app-shell.ts`** — the shared branded header + primary nav (`renderAppShell()`),
  rendered via `innerHTML` into a `<div id="appShell">` placeholder on every options page (not the
  popup, which has its own static header). `NAV_ITEMS` fixes both the set of pages and their
  left-to-right display order: Setup, Sync Data, Club Review, Member Review, Club Progress — each
  page passes its own `AppShellPage` key (`"settings"|"syncData"|"clubReview"|"members"|"report"`)
  as `active` so its own nav link renders highlighted.
- **`shared/dom-utils.ts`** — `escapeHtml()` and `escapeAttr()`, shared by all extension pages. **Use
  `escapeAttr`, not `escapeHtml`, for any untrusted text (scraped member/path names) written into an
  HTML attribute value** (e.g. an `<option value="...">`, a `data-*` attribute) — `escapeHtml`'s
  `div.textContent` → `div.innerHTML` round-trip only entity-encodes what's needed for *text-node*
  content and does not escape a literal `"`, so it can't safely go inside a double-quoted attribute.
  Also `warningIconHtml(title)` — the shared warning-triangle SVG used by both `report.ts` and
  `members.ts` (each page still owns its own `.warning-icon`/`.conflict-warning` CSS).

When extending this codebase with a new data source, don't assume Basecamp's tab-less fetch pattern
is the default template — check first whether the target site can be reached with a plain
privileged `fetch()` (works if there's no bot protection distinguishing fetch from navigation) or
needs EasySpeak's tab-navigation + `chrome.scripting` approach (required for anything behind
Cloudflare or similar). And if it needs the latter, its parser must be injected the same `?iife` way
`easyspeak-parser.iife.ts` is — see the injection-pattern bullet above.

## Build tooling

Vite (`vite.config.ts`) + `@crxjs/vite-plugin` build `src/` into `dist/<target>/`. Two full
manifests are hand-authored at the repo root (not `defineManifest()` — nothing here is
computed/dynamic; a base+per-target-overlay-merge approach was deliberately rejected in favor of
two complete, independently-readable files) — `manifest.store.json` (the Chrome Web Store
submission candidate; this is the manifest that existed alone, as the repo's only manifest, before
the preview/store split) and `manifest.preview.json` (for testers, installed outside the store;
today differs from the store manifest only in `name`/`description` — its `name` carries a
"(Preview)" suffix so it's visually distinguishable in `chrome://extensions` — but is expected to
diverge further once debug-only tooling lands). `vite.config.ts` picks one via Vite's `mode`
(`defineConfig(({ mode }) => ...)`, not a plain object — needed specifically to branch on this) and
reads it with `readFileSync`+`JSON.parse` rather than a JSON import attribute (Node-version-sensitive
syntax; the plain `fs` read sidesteps it): `mode === "preview"` reads `manifest.preview.json` into
`dist/preview/`, anything else (including no `--mode` flag at all — `npm run dev`, `build:watch`)
falls back to `manifest.store.json` into `dist/store/`, preserving this repo's original
single-target behavior as the default. `npm run build` passes `--mode store` explicitly;
`npm run build:preview` passes `--mode preview`. A few decisions worth knowing before changing the
config:

- **`root: "src"`** — Vite's build root is `src/`, not the repo root, so `dist/<target>/popup/index.html`,
  `dist/<target>/options/report.html`, etc. land without an `src/` prefix leaking into the runtime
  URLs. Every extension-page path string lives in `shared/pages.ts`; if this `root` decision is
  ever reversed, that's the one file to update. `publicDir`/`build.outDir` are both set explicitly
  in `vite.config.ts` since their Vite defaults are relative to `root` (would otherwise become
  `src/public`/`src/dist`); `build.outDir` is additionally derived from `target` now, not a fixed
  path.
- **`build.rollupOptions.input`** lists the eight extra HTML pages (five `options/*.html`, three
  `status/*.html`) that aren't discoverable from either manifest alone. `popup/index.html` is
  deliberately **not** listed there — crxjs picks it up automatically from the active manifest's
  `action.default_popup`; double-listing it would be redundant, not just harmless, so don't add it.
- The built service worker is a real ESM bundle, loaded via a thin generated
  `dist/<target>/service-worker-loader.js` that crxjs writes (visible in the build output) — this is
  normal, not a build error; the real background code is the hashed chunk it imports.
- **Two release zips per version**, both cut in one run by `.github/workflows/release.yml`,
  triggered manually from the Actions tab: it bumps `package.json` and both manifests' `version`
  together, builds both targets, and attaches
  `toastmasters-vpe-assistant-preview-v<version>.zip` (from `dist/preview/`) and
  `toastmasters-vpe-assistant-store-v<version>-candidate.zip` (from `dist/store/`) to one GitHub
  Release. The release note explicitly tells testers to install the preview zip and to ignore the
  store-candidate zip (that one's for the maintainer's own Chrome Web Store submission).
- `npm run dev` (`vite`) is useful for iterating on options/popup page markup with faster feedback,
  but MV3 background/`chrome.scripting` behavior (the EasySpeak flow especially) should always get a
  real `npm run build` + "Reload" in `chrome://extensions` before you trust it — crxjs's dev-mode
  service worker is a loader that pulls the real worker via dynamic import, which registers
  `chrome.runtime.onMessage` listeners asynchronously; an event fired in the very first tick after a
  cold service-worker wake could theoretically be dropped in dev mode in a way production's
  synchronous bundle wouldn't. In practice every message here is popup-click-initiated (worker
  already warm), so this is a low-probability footgun, not a blocker — just don't debug a suspiciously
  flaky message-not-received issue in dev mode before ruling this out.
- **Node version note**: this environment's toolchain is pinned to versions that work on Node 18
  (`vite@^6`, `vitest@^3`, `jsdom@^26`, `typescript@^5.9`) rather than each package's latest major —
  `vite@8`/`vitest@4`/`jsdom@27+`/`typescript@7` all require Node ≥20, and `typescript@7`'s `bin/tsc`
  additionally fails to load at all under this project's Node 18 + `"type":"module"` combination (an
  `ERR_UNKNOWN_FILE_EXTENSION` from Node's ESM loader, not a TypeScript bug). If the project's Node
  version is ever bumped to 20+, revisiting these pins to the latest majors is a reasonable, isolated
  follow-up — but don't bump the packages without also bumping Node, or `npm install`/`vite
  build`/`tsc` will break exactly as they did during this migration.

## Conventions

- UI strings, comments, and README are in English; keep new user-facing text and comments
  consistent with that.
- **TypeScript + Vite + `@crxjs/vite-plugin`, real ES module `import`/`export` everywhere.** This
  reverses an earlier "no transpilation/bundling, no ES module imports across files, no npm
  dependencies" convention — don't reintroduce plain `<script src>`/`importScripts` loading or
  "port back to unbundled JS for simplicity"; that's the old architecture, not a simpler version of
  the current one. `dist/` is a generated build artifact — gitignored, never hand-edited, never
  committed.
- `chrome.storage.*` is called only from `shared/storage.ts`; `shared/**` must never import from
  `background/**` (see the layering rule under "Architecture"); a dynamically-injected content
  script must go through the `?iife` pattern documented above, never a hardcoded file path.
- `public/icons/*.png` were generated once via a scratchpad-only Node script (hand-written SVGs
  rasterized with `sharp`) — that tool isn't part of the repo and never will be; if the icon designs
  need to change, regenerate the PNGs the same throwaway way rather than adding an image-processing
  dependency to the project itself. Icons are organized one subfolder per state — `default/`,
  `error/`, `success/` (each `<size>.png` for sizes 16/32/48/128), and `loading/` (`<frame>-<size>.png`
  for frames 0-7) — read by `background/icon-state.ts` at runtime; this folder layout and naming must
  be preserved exactly if these ever change.
