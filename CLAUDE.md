# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cross-browser extension (Manifest V3 on Chrome/Chromium browsers, Manifest V2 on Firefox) for a
Toastmasters VPE (Vice President Education) to consolidate member Pathways progress following, from
two sources: **Basecamp Toastmasters** (a clean internal JSON API) and **EasySpeak** (no API — HTML
pages that must be parsed; runs as three separate regional deployments — `tmclub.eu` (default),
`toastmasterclub.org`, `easy-speak.org` — picked on Setup, see `shared/settings-store.ts` below).
Both scrapers store their extraction locally.

The extension is written in **TypeScript, built with [WXT](https://wxt.dev)** (a Vite-based,
cross-browser web-extension framework), under `src/` (see "Architecture" below for the full tree).
WXT replaced an earlier Vite + `@crxjs/vite-plugin` Chrome-only setup — that migration is what
introduced Firefox support (previously there was no Firefox target at all) and the `entrypoints/`
file-based-routing convention described below. Don't reintroduce hand-authored `manifest.*.json`
files or a bare `vite.config.ts` — `wxt.config.ts` generates the manifest per browser/mode now.

Every extension API call goes through the `browser` global (a WXT-provided auto-import: `chrome` on
Chrome, native `browser` on Firefox — never call `chrome.*` directly, it silently doesn't exist on
Firefox). `defineBackground()`/`defineContentScript()` are similarly WXT auto-imports, not manual
imports — see the entrypoint files themselves for the pattern, don't add `import` statements for
these.

## Running / testing changes

1. `npm install` once (`postinstall` runs `wxt prepare`, generating the gitignored `.wxt/` directory
   — types + a base tsconfig `tsconfig.json` extends; regenerable, never hand-edit).
2. `npm run build` — type-checks (`tsc --noEmit`) then runs `wxt build --mode store` for **Chrome**,
   producing `.output/store/chrome-mv3/` (the Chrome Web Store submission candidate — see "Build
   modes × browsers" under "Build tooling" below). The full combination matrix:
   - `npm run build` → `.output/store/chrome-mv3/`
   - `npm run build:firefox` → `.output/store/firefox-mv2/`
   - `npm run build:preview` → `.output/preview/chrome-mv3/`
   - `npm run build:preview:firefox` → `.output/preview/firefox-mv2/`

   The "store" targets are Chrome-Web-Store/AMO submission candidates; "preview" is the
   tester-facing build (adds the update-checker, an "(Preview)" name suffix). Pick `build`
   (store, Chrome) if in doubt. Or `npm run dev` / `npm run dev:firefox` for WXT's dev server
   (works for iterating on popup/options page UI, but MV3 background/`browser.scripting` flows
   — the EasySpeak flow especially — should always get a real build + reload before you trust
   them; see the dev-mode caveat under "Build tooling"). `.output/` is gitignored, regenerable —
   never hand-edit anything under it.
3. **Chrome/Chromium**: open `chrome://extensions`, enable "Developer mode", "Load unpacked" →
   select `.output/store/chrome-mv3/` (or "Reload" after rebuilding).
   **Firefox**: go to `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → select
   the `manifest.json` inside `.output/store/firefox-mv2/`. This is temporary (cleared on Firefox
   restart) since the build isn't Mozilla-signed locally — that's expected for day-to-day dev.
4. Log in normally at `https://apps.basecamp.toastmasters.org/` and/or your configured EasySpeak
   server (`https://tmclub.eu/` by default — see Setup to change it; any tab, any time
   beforehand).
5. Click the extension icon, then "Extract Basecamp data" and/or "Extract EasySpeak data" — no
   Basecamp tab needs to stay open (unless a login is required — see Architecture). EasySpeak
   scraping always opens and focuses a brand-new tab on the configured EasySpeak server (never
   reuses an already-open one — see Architecture for why), which
   **closes the popup immediately** (both Chrome and Firefox tear down `action` popups as soon as
   they lose focus, and stealing tab/window focus is exactly what `ensureEasySpeakTab()` does).
   That tab redirects to a "data fetched" confirmation page and closes itself a few seconds later
   once scraping finishes; reopen the popup to see the result — see the storage note below for why
   this works.
6. Inspect the popup summary table and the raw JSON under "Raw data", or check the background
   entrypoint's console (`chrome://extensions` → this extension → "service worker" inspect link on
   Chrome; `about:debugging` → "Inspect" on Firefox) for errors. Code injected into the EasySpeak
   tab via `browser.scripting` logs to that *tab's* own DevTools console, not the background's.
7. Watch the toolbar icon while a scrape runs: it should animate (spinning), then land on a green
   check or red cross, then revert to the classic icon the next time you open the popup (see
   `background/icon-state.ts` in Architecture). Each source's button should be disabled only while
   *that* source is loading.

Background errors surface via the response returned to the popup (`{ ok: false, error }`), not the
console — check `entrypoints/popup/main.ts`'s status line first when debugging a failed scrape.

`.github/workflows/ci.yml` runs `test` (Vitest), then the store/Chrome build, then the Playwright
`test:e2e` suite (see below) against that build, then the remaining 3 build combinations
(store/preview × chrome/firefox) on every push/PR to `main` — a green run there is not a substitute
for the manual walkthrough above, which is the only thing that exercises the real `browser.*` flows,
**on both browsers** — Firefox's
non-persistent MV2 background page has a similar but not necessarily identical idle-suspension model
to Chrome's MV3 service worker, so don't assume a flow that works on Chrome automatically works on
Firefox too, especially the EasySpeak scrape's multi-minute login-wait timeouts.

`npm run typecheck` (`tsc --noEmit`, no `wxt build`) is the fast way to check types alone.

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
- `tests/export.test.ts` exercises the pure sheet-row shaping in `shared/export/rows.ts`
  (`buildAggregatedRows`, `buildMatchesRows`, `buildBasecampRows`, `buildEasySpeakRows`,
  `buildMetadataRows`, `buildExportSheets`) against the same `test-data/report/*.sample.json`
  fixtures `tests/report.test.ts` uses, reusing `buildReport()` to get a real `ReportResult` rather
  than hand-building one. `shared/export/workbook.ts`/`download.ts`/`export-to-excel.ts` stay
  manual-only, same category as `shared/resolution-store.ts` below.
- `test-data/` is **fully synthetic and versioned** (fabricated names, `example.test`/`example.com`
  emails) — deliberately *not* derived from `example/`, which stays a separate, gitignored,
  real-data-only scratch folder for manual debugging that the automated suite never reads.
- Tests use real ESM `import` from `../src/...` — no `require()`/`module.exports` workaround needed
  now that everything is a real TS module (that workaround was only ever needed back when these
  files were plain globals-exporting `<script>`s).
- `vitest.config.ts` is a **standalone config that must not import `wxt.config.ts`** — loading WXT's
  config during a test run breaks, since it expects a manifest, a file writer, and an extension
  build environment Vitest doesn't provide.
- Out of scope, unchanged manual-only workflow: `background/api/basecamp.ts`,
  `background/api/easyspeak.ts`, `shared/resolution-store.ts`, `shared/settings-store.ts`'s
  `getEasySpeakServer`/`setEasySpeakServer`, `background/icon-state.ts`,
  `shared/export/export-to-excel.ts`/`download.ts`, and every popup/options/
  status page — all genuinely `browser.*`-dependent (tabs, scripting, storage) with no pure logic
  worth isolating.

`npm run test:e2e` (Playwright, config in `playwright.config.ts`, specs in `e2e/`) drives a real
**built** extension in a persistent Chromium context (`e2e/fixtures.ts`'s `context` fixture —
`chromium.launchPersistentContext()` with `--load-extension=.output/store/chrome-mv3`), the same way
a human tester loads it via "Load unpacked". Requires `npm run build` first (the fixture throws a
clear error if `.output/store/chrome-mv3/manifest.json` is missing) and, once ever, `npx playwright
install chromium` to fetch the browser binary — neither is run automatically. Every spec seeds data
via `e2e/fixtures.ts`'s `seedDemoData()`: it drives Setup's "Try with demo data" card, then clicks
both import buttons on Sync Data — this hits the same `"demo"` profile short-circuit in
`background/api/basecamp.ts`/`background/api/easyspeak.ts` described above (see Architecture,
`shared/mock/mockData.ts`), so no real network/login/Cloudflare flow is ever involved, and results
are deterministic. Currently covers the Sync Data → Export card flow (selector availability/auto-
select + an actual file download) and a render/console-error smoke check on Report/Members/Club
Review. Wired into `.github/workflows/ci.yml`, right after the "Build (store, Chrome)" step (the
exact `.output/store/chrome-mv3` this suite launches). The browser binary itself is cached
(`actions/cache` on `~/.cache/ms-playwright`, keyed on `runner.os` + a `package-lock.json` hash so a
`@playwright/test` version bump correctly invalidates it) — a fresh GitHub-hosted runner still needs
`npx playwright install --with-deps chromium` to fetch it and the apt-level shared libraries Chromium
needs to launch at all, but a cache hit skips the (slow) download and only re-runs `playwright
install-deps chromium` for those OS packages, which apt doesn't persist across runs either way.
`playwright.config.ts` sets `workers: 1` unconditionally (launching several persistent extension
contexts concurrently was observed to make one worker's browser process unresponsive — a real flake
reproduced locally, not a hypothetical) and `retries: 1` unconditionally, locally too, not just in
CI, as a general safety net against real-browser-launch flakiness — cheap, since a retry gets a fully
independent fresh context rather than another attempt in the same unlucky one.
`e2e/fixtures.ts`'s `page` fixture also closes the extra tabs a fresh install always opens (the
context's own initial blank tab, plus `entrypoints/welcome/` from `onInstalled`'s "install" branch)
before handing the page to a test, since every test already launches/tears down a full persistent
Chromium + extension process and there's no reason to make that heavier than it needs to be.

This suite is also what caught a real, previously-invisible bug in `entrypoints/sync-data/main.ts`'s
`refresh()` (not a test-infra issue at all — a `locator.waitFor: Target page, context or browser has
been closed` timeout kept reproducing waiting on `#badgeEasySpeak` specifically, and its captured
page snapshot showed the "Data Import Complete" banner and Export card already correctly reflecting
both sources loaded while that one badge alone stayed stuck on "Importing"). Root cause: `refresh()`
awaits `sendMessage({type: "POPUP_OPENED"})` (→ `statuses`) and `local.get(...)` (→ `cached`)
*sequentially*, not as one atomic snapshot, while `background/messaging.ts`'s `runScrape()` always
writes the scraped data to `storage.local` *before* flipping that source's `storage.session` icon
status to `"success"`. A call whose two reads straddle that exact instant can see `cached` already
holding the finished data while its earlier `statuses` read still says `"loading"` — a single call's
own two-reads-at-different-times inconsistency, not (only) a race between overlapping `refresh()`
invocations (`browser.storage.onChanged` also triggers `refresh()` independently the moment the
`local` write lands, well before that status flip — see the layering note in that entrypoint's own
comments). Fixed with two mechanisms, both still in place: a `refreshToken` counter so a stale,
later-resolving `refresh()` call never overwrites a fresher one's render, and — the fix that actually
closed the gap — treating data presence as authoritative over a possibly-stale loading flag
(`basecampLoading = statuses.basecamp === "loading" && !cached.basecampData`, same for EasySpeak): a
source with its data already in storage is never still "loading," regardless of what a status flag
captured a moment earlier claims. Verified by running the suite repeatedly with `retries: 0` (to
stop retries from masking a still-partially-fixed bug) until it stayed consistently green. If a
similar "stuck on a transient status despite the underlying data already being ready" symptom shows
up on another page sharing this same `POPUP_OPENED`/`storage.local` pattern, look here first.

`playwright.config.ts` is deliberately standalone from `wxt.config.ts`/`vitest.config.ts`, same
isolation reasoning as the `vitest.config.ts` bullet above, and `e2e/**/*.spec.ts` lives outside
`tests/` so Vitest's own `include` glob never picks it up.

## Architecture

WXT imposes structure only on **entrypoints** — background, popup, and every other page/script
referenced at runtime, each declared under `src/entrypoints/` via file-based routing (one HTML page
per directory, `index.html` + a same-directory script; a background/content-script is a single `.ts`
file using WXT's `defineBackground()`/`defineContentScript()`). Everything else (pure logic, storage
I/O, matching/diff code, DOM helpers) is a plain supporting module living wherever makes sense —
WXT doesn't care, only entrypoints are special:

```
src/
├── entrypoints/
│   ├── background.ts                # defineBackground() — consolidates what used to be
│   │                                 # background/index.ts + background/index.preview.ts (see below)
│   ├── popup/                       # the generated manifest's action.default_popup
│   │   ├── index.html
│   │   └── main.ts
│   ├── report/, members/, settings/, sync-data/, club-review/
│   │   │                            # five independent unlisted pages, NOT a merged options_page/
│   │   │                            # dashboard — each opened via browser.tabs.create, exactly like
│   │   │                            # popup does, built flat (report.html, members.html, ...) at
│   │   │                            # the extension root regardless of source directory depth
│   │   └── index.html + main.ts     # report = read-only comparison view ("Club Progress");
│   │                                 # members = interactive member-matching review ("Member Review");
│   │                                 # settings = demo/mock mode + EasySpeak server picker ("Setup");
│   │                                 # sync-data = Data Extraction card, backed by
│   │                                 #   shared/sync-status-panel.ts ("Sync Data");
│   │                                 # club-review = club-name/path-name lookup editors ("Club Review")
│   ├── basecamp-auth/, easyspeak-done/
│   │   └── index.html + main.ts     # background-initiated interstitial pages, no user entry point
│   ├── welcome/                     # first-run-only tab, opened by entrypoints/background.ts's onInstalled
│   │   └── index.html + main.ts
│   └── easyspeak-parser.content.ts  # registration:"runtime" content script, dynamically injected
│                                     # into a live EasySpeak tab — see below
├── background/                      # plain supporting modules for entrypoints/background.ts —
│   │                                 # not entrypoints themselves, never imported from a page
│   ├── messaging.ts                 # onMessage listener + runScrape() helper
│   ├── icon-state.ts                # toolbar icon state machine
│   ├── scrape-progress.ts           # live scrape-progress reporting (session storage)
│   └── api/
│       ├── basecamp.ts              # Basecamp scraping (fetch-based)
│       ├── easyspeak.ts             # EasySpeak scraping (tab-navigation based)
│       └── update-checker.ts        # preview-build-only GitHub-release poller
└── shared/                          # no browser.* dependency except storage.ts/resolution-store.ts/
                                      # settings-store.ts/sync-status-panel.ts/update-store.ts/countdown.ts
    ├── types.ts             # the domain type catalog — read this first when touching data shapes
    ├── storage.ts           # the ONLY file allowed to call browser.storage.* directly
    ├── pages.ts             # extension page URL constants (browser.runtime.getURL wrapper)
    ├── send-message.ts      # typed browser.runtime.sendMessage() client for entrypoints/popup/main.ts
    ├── countdown.ts         # shared auto-close-in-5s behavior for the two status pages above
    ├── app-shell.ts         # shared header/nav bar (renderAppShell), rendered into #appShell on every options page
    ├── sync-status-panel.ts # shared sync-status summary + Data Extraction logic, used by entrypoints/popup/main.ts and entrypoints/sync-data/main.ts
    ├── dom-utils.ts         # escapeHtml/escapeAttr/warningIconHtml
    ├── settings-store.ts    # EasySpeak server choice
    ├── resolution-store.ts  # the 6 persisted name-resolution keys
    ├── sync/
    │   ├── conflicts.ts      # name/path/member matching + override logic
    │   └── delta.ts          # buildReport orchestrator, diffing, level summary — imports conflicts.ts
    ├── export/               # "Export to Excel" (Sync Data page) — see below
    │   ├── rows.ts            # pure sheet-row shaping (Aggregated/Matches & Resolutions/Basecamp/
    │   │                       # EasySpeak/Metadata) — no exceljs/browser.* dep, Vitest-testable
    │   ├── workbook.ts         # the only file importing exceljs — turns rows.ts's row arrays into
    │   │                       # an actual ExcelJS.Workbook (headers, widths, freeze pane, autofilter)
    │   ├── download.ts          # DOM-only Blob/createObjectURL/<a download> helper, library-agnostic
    │   └── export-to-excel.ts    # browser.*-dependent orchestrator: storage + resolution-store +
    │                              # buildReport() -> rows -> workbook -> download
    ├── parsers/
    │   └── easyspeak-parser.ts   # pure DOM parsing, imported by entrypoints/easyspeak-parser.content.ts
    └── mock/
        └── mockData.ts       # demo/mock-mode scaffold — NOT wired up anywhere yet
```

**Layering rule, enforced by convention not tooling — don't violate it**: `shared/**` must never
import from `background/**`. `shared/sync/conflicts.ts` and `shared/sync/delta.ts` run only in
options pages (never the background entrypoint) but `delta.ts` imports matching functions from
`conflicts.ts`, so the dependency graph is `entrypoints/*/main.ts → shared/sync/delta →
shared/sync/conflicts → shared/types`, always acyclic. `background/icon-state.ts` conversely is
deliberately *never* imported by any page (it owns a running `setInterval` for the icon spin
animation; a second copy imported into a page would start its own independent interval fighting the
background's own over `browser.action.setIcon()`) — the popup only ever asks background for the
current statuses via the `POPUP_OPENED` message (`entrypoints/sync-data/main.ts`'s `init()` sends
the identical message the same way, since it drives the same shared `shared/sync-status-panel.ts`
rendering/status logic).

Two scraper pipelines with different shapes, sharing one trigger flow from the popup: **popup →
background entrypoint → source-specific scraper**.

- **`shared/sync-status-panel.ts`** — the shared logic behind the "Data Extraction" card + the
  compact sync-status summary, used by both `entrypoints/popup/main.ts` and `entrypoints/sync-data/main.ts` (see that
  page's bullet below) — the two pages render matching markup with matching element ids
  (`scrapeBasecampBtn`/`statusBasecamp`/`summaryBasecamp`/`rawDataBasecamp` and the EasySpeak
  equivalents, plus a shared `#statusSummary` root) and both call into this module instead of
  duplicating the rendering/formatting/scrape-click code. Exports `bindSourceEls()` (looks up a
  source's four elements by id), `onScrapeClick()` (sends `{type: "SCRAPE_BASECAMP"}` /
  `{type: "SCRAPE_EASYSPEAK"}` to the background entrypoint via `shared/send-message.ts`'s
  typed `sendMessage()`, parameterized by message type, storage keys, and a render function; takes
  an optional `onDone` hook for page-specific post-scrape follow-up), `renderScrapeResult()`
  (merges what used to be two near-identical `renderBasecampResult`/`renderEasySpeakResult`
  functions — both only ever touched the shared `{name, members}` shape), and
  `renderStatusSummary()` (renders into `#statusSummary`, returns the cached
  `{basecampData, easyspeakData}` so each page can layer its own follow-up on top — e.g. the
  popup's subtitle update — without this module needing to know about it). On a successful scrape,
  `onScrapeClick()` writes to `browser.storage.local` itself (via `shared/storage.ts`'s
  `local.set`: `basecampData`/`basecampScrapedAt`, `easyspeakData`/`easyspeakScrapedAt`) — **this
  write cannot be the only copy** (see the `background/api/*.ts` bullets below). Loading is
  communicated purely via the triggering button itself (`setButtonLoading`: disabled + relabeled
  to "Basecamp data loading..." / "EasySpeak data loading..."), **not** the status line or the
  summary/raw-data panels — `onScrapeClick` never touches `els.status`/`els.summary`/`els.rawData`
  while a request is in flight, so "Last extraction: ..." and the previous result stay visible the
  whole time; only a completed extraction or an error updates the status line.
- **`entrypoints/popup/main.ts`** — UI layer only, composed on top of `shared/sync-status-panel.ts`. `init()`
  sends `{type: "POPUP_OPENED"}` before anything else, both to let background acknowledge any
  finished success/error status (see `background/icon-state.ts` below) and to learn whether either
  source is currently `"loading"`, so it can apply the same disabled/relabeled button state even
  though this popup instance didn't trigger the in-progress scrape itself (e.g. reopening the
  popup while EasySpeak is still running in its own tab). Restores cached data on open via
  `renderScrapeResult()`, and passes an `onDone` hook into each `onScrapeClick()` call that
  re-renders the status summary and updates `updateReportButton()`/`updatePopupSubtitle()` — both
  of which stay popup-only (no such buttons/subtitle element on `entrypoints/sync-data/main.ts`). Does not
  touch `browser.tabs`, `browser.action`, or `browser.storage.session` itself — all tab handling for
  EasySpeak lives in `background/api/easyspeak.ts`, all icon/status handling lives in
  `background/icon-state.ts`, both background-only.
- **`entrypoints/sync-data/index.html` + `entrypoints/sync-data/main.ts`** — a thin page wired up against
  `shared/sync-status-panel.ts`: same Data Extraction card + sync-status summary markup as the
  popup (same element ids), same underlying rendering/formatting/scrape-click logic, no duplicated
  code. Unlike the popup it isn't torn down when `ensureEasySpeakTab()` steals tab/window focus,
  since it's a regular tab, not an `action` popup — so a scrape triggered here survives exactly the
  focus-loss event that kills the popup mid-scrape (see `background/api/easyspeak.ts` below). Has
  its own `browser.storage.onChanged` listener re-running `init()`, matching the other long-lived-
  tab options pages' convention (the popup doesn't need this since it's re-created fresh on each
  open). No report/review-matches buttons or Setup link — those stay popup-only. Also owns a third
  card, Export, with a single "Export to Excel" button that calls `shared/export/export-to-excel.ts`'s
  `exportToExcel()` directly on click — no `sendMessage`/background round trip, since Excel generation
  is plain synchronous client-side work with no `browser.tabs`/background-lifetime dependency (same
  reasoning as Member Review's direct resolution-store writes, unlike EasySpeak's tab-navigation).
  The button is never disabled for missing data — a partial or even empty export is still legitimate,
  since `buildReport()` already tolerates an empty/one-sided scrape — and feedback is a plain status
  line (`#statusExport`), matching this codebase's no-modal/no-toast convention. See `shared/export/`
  above for the module breakdown.
- **`entrypoints/background.ts`** — the background entrypoint (`export default defineBackground(()
  => {...})`), consolidating what used to be two physically separate files (`background/index.ts`
  for the store build, `background/index.preview.ts` for preview — a leftover from the pre-WXT
  two-manifest setup). Calls `background/messaging.ts`'s `registerMessageHandlers()`, and registers
  `browser.runtime.onInstalled`: on `details.reason === "install"` only (never `"update"`, so an
  existing user reloading/upgrading the extension never sees this again) it opens
  `entrypoints/welcome/index.html` in a new tab via `pageUrl(PAGES.welcome)` — neither Chrome nor
  Firefox pins a freshly installed extension's toolbar icon by default, so this page exists purely
  to point a first-time user at the menu and prompt them to pin it, then hands off to Setup via its
  own "Get started" button (`location.href = pageUrl(PAGES.settings)`, navigating that same tab
  rather than opening a second one). `entrypoints/welcome/main.ts` has no `browser.storage`/
  resolution-store dependency at all — it's a static walkthrough, not part of the stepper flow
  those five options pages share (no `app-shell.ts` nav on it), so it isn't wired into `NAV_ITEMS`.

  The store-vs-preview split those two old files existed for is now a **build-time-eliminated
  dynamic import**, gated on WXT's build mode:
  ```ts
  if (import.meta.env.MODE === "preview") {
    import("../background/api/update-checker").then((m) => m.registerUpdateChecker());
  }
  ```
  Vite/Rollup statically inlines `import.meta.env.MODE` and dead-code-eliminates the whole branch
  — including the dynamic `import()` expression itself — for any other mode, so the store build's
  bundle graph never reaches `background/api/update-checker.ts` (and therefore never contains the
  literal GitHub Releases API host string), verified by `.github/workflows/ci.yml` grepping
  `.output/store/` for it. `alarms`/`notifications` permissions and the `api.github.com` host
  permission are likewise only added to the manifest when `wxt.config.ts`'s `manifest()` function
  sees `mode === "preview"` (see "Build tooling" below). `background/api/update-checker.ts` is
  what keeps the preview-only "check GitHub for a newer preview release" poller (`browser.alarms`
  every 6h + on install/update, badges the toolbar icon, fires one `browser.notifications` toast
  per newly-seen version). The release-page flow (`shared/update-store.ts`'s `openUpdateRelease()`,
  which just does `browser.tabs.create({url: info.releaseUrl})` against the GitHub release's own
  `html_url`) is called both from the popup's update banner and from
  `browser.notifications.onClicked` directly — no message-passing round trip, same reasoning as
  `entrypoints/members/main.ts`'s direct resolution-store writes (no background-lifetime constraint
  applies here, unlike EasySpeak's tab-navigation). This used to trigger the release zip download
  directly via `chrome.downloads.download()` (a Chrome-only API) plus a reload-instructions status
  page, but that download was silently getting cancelled: Chrome doesn't create the real
  `DownloadItem` until it gets a server response, and the very next step (opening a tab) steals
  window focus, which — called from the popup — closes the popup and cancels any download that
  hadn't started yet. Simplified instead to just open the GitHub release page and let the user
  click the asset themselves, same as the release notes' own instructions already say to do — no
  `downloads` permission, no `status/update-available.html`, no asset-lookup logic in
  `update-checker.ts` needed anymore.
- **`background/messaging.ts`** — the `onMessage` listener: `SCRAPE_BASECAMP`/`SCRAPE_EASYSPEAK`
  both go through a shared `runScrape(source, scrapeFn, sendResponse)` helper that brackets the call
  with `setSourceStatus(source, "loading"/"success"/"error")` (see below) before `sendResponse({ok:
  true, data} / {ok: false, error})`; `POPUP_OPENED` calls `acknowledgeIconStatuses()` and replies
  with the resulting statuses (note this response is a bare `IconStatuses`, not the `{ok,data}`
  envelope the two scrape messages use — a pre-existing inconsistency, preserved and now visible in
  `shared/types.ts`'s `ResponseFor<M>` type rather than implicit). `entrypoints/background.ts` is
  also the intended home for future work (`browser.alarms` scheduling, centralizing storage across
  both sources, delta computation).
- **`background/icon-state.ts`** — toolbar icon state machine, imported only by
  `entrypoints/background.ts` (via `messaging.ts`) — see the layering rule above for why it must
  never be imported by a page. It owns a running `setInterval` for the spin animation. Follows
  `{basecamp, easyspeak}` status (`"idle"|"loading"|"success"|"error"`) in `browser.storage.session`
  (via `shared/storage.ts`'s `session` wrapper) — session-scoped, not `.local`, specifically so a
  status can never survive a browser restart and permanently disable a button. `combineStatus()`
  reduces both sources to the single icon shown, priority **loading > error > success > idle**.
  `setSourceStatus()` is called by `runScrape()` around each scrape. `acknowledgeIconStatuses()` is
  called on `POPUP_OPENED`: reverts any `success`/`error` source back to `idle` (opening the popup =
  "seen it") but leaves `loading` alone. The loading icon is a real 8-frame animation
  (`public/icons/loading/{0..7}-{16,32,48,128}.png`, 150ms/frame — `public/` is copied verbatim into
  every build's output root by WXT, same as before the WXT migration, just under `.output/<mode>/
  <browser>-mv<version>/` now instead of `dist/<target>/`); the interval only runs while the combined
  state is `loading` and is stopped the moment it isn't.
- **`background/api/basecamp.ts`** — all Basecamp scraping logic. Data fetching itself needs no tab:
  `fetch(..., { credentials: "include" })` runs directly from the privileged background context,
  and because the manifest's `host_permissions` covers the Basecamp hosts, the browser's existing
  session cookie is sent automatically.
  1. `GET /api/members/roles` → clubs, filtered to those where the current user has `is_bcm: true`.
  2. For each such club, paginates `GET /api/bcm/progress/?club={uuid}&page=N` following the `next`
     field until `null` (capped at 200 pages as a safety guard).
  3. Writes the result to `browser.storage.local` itself before returning, for the same reason
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
     registers its `browser.tabs.onUpdated`/`onRemoved` listeners **before** calling
     `browser.tabs.update()`, for the identical race-avoidance reason documented below for
     `navigateAndWaitForRealPage()`, and simply ignores every "complete" event until the tab's URL is
     exactly the approvals URL again (no Cloudflare-challenge or restricted-text checks are needed
     here, unlike EasySpeak, since Basecamp's own redirect is the only signal that matters) — capped
     at a flat 5-minute timeout. Once resolved, `fetchJson()` retries the original request exactly
     once; a second 401/403 (e.g. wrong account) throws instead of looping. Once
     `waitForLoginRedirect()` resolves, `waitForBasecampLogin()` redirects the tab to
     `entrypoints/basecamp-auth/index.html` (via `shared/pages.ts`'s `pageUrl()`) — a confirmation page
     explaining that auth succeeded and the scrape is continuing in the background — instead of
     closing it, so the user gets explicit confirmation of a successful login. Like EasySpeak's
     equivalent confirmation page below, it auto-closes the tab 5 seconds later via the shared
     `shared/countdown.ts` (see there), with a visible countdown and a "Keep this tab open" button to
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
    `browser.tabs.onUpdated`/`onRemoved` listeners **before** calling `browser.tabs.update(tabId,
    {url})`, and only resolves on an actual `"complete"` event whose `tab.url` matches the target
    url and whose `document.title` is no longer `"Just a moment..."`. This ordering matters: an
    earlier version called `browser.tabs.update()` first and then eagerly checked the tab's state —
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
    `browser.tabs.update(tabId, {url})` itself once login is detected, now that the session is
    authenticated, and reverts the timeout back to the normal 30s. This lives in
    `navigateAndWaitForRealPage` itself (not `scrapeAllEasySpeakClubs`), so it transparently covers a
    session that expires mid-scrape too, not just one that's already expired before the first
    `loadAndParse` call. Once the real page is confirmed loaded, `loadAndParse` injects the built
    parser bundle (see the injection-pattern bullet immediately below) and invokes the named parser
    function by name in a second `executeScript` call, returning its result. `scrapeAllEasySpeakClubs()` ties it
    together: `profile.php?mode=editprofile#tab_ti` → officer clubs, then
    `memberchart.php?chart=10&c={clubId}` per club → members; writes the result to
    `browser.storage.local` (`easyspeakData`/`easyspeakScrapedAt`, via `shared/storage.ts`) itself
    first, then redirects the tab to `entrypoints/easyspeak-done/index.html` (via `shared/pages.ts`) — a
    confirmation page that counts down 5 seconds (visibly, via a `#countdown` span) and closes itself
    via `browser.tabs.remove()` (not `window.close()`, which only works on a tab/window a script itself
    opened via `window.open()`), with a "Keep this tab open" button to cancel the close. This
    countdown/cancel behavior lives in `shared/countdown.ts`, shared with `entrypoints/basecamp-auth/index.html`
    (see `waitForBasecampLogin()` above) rather than duplicated per page — each including page just
    needs to define `#countdownText`/`#countdown`/`#cancelBtn`. If anything above throws (Cloudflare
    stuck, login timeout, parse failure), that redirect line is never reached and the tab is left open
    exactly as-is so the user can see/solve whatever went wrong. **The storage write is load-bearing,
    not redundant with entrypoints/popup/main.ts's**: `ensureEasySpeakTab()` steals tab/window focus, and Chrome
    closes an `action` popup the instant it loses focus — so the popup that triggered the scrape is
    gone long before `scrapeAllEasySpeakClubs()` resolves, and its `await sendMessage(...)` in
    `onScrapeClick` never gets a chance to run its follow-up storage write. This was a real bug
    (background logs confirmed each club scraped correctly with distinct data, but the popup never
    showed updated results because it had already been torn down) — don't remove this write to "avoid
    duplication" with `entrypoints/popup/main.ts`.
  - **THE ONE INJECTION PATTERN THAT ISN'T OBVIOUS — read before touching this file.** The parser
    is `src/entrypoints/easyspeak-parser.content.ts`, a WXT content-script entrypoint declared with
    `registration: "runtime"` — meaning it's never auto-injected by a manifest match rule (`matches:
    []`), only injected on demand via `browser.scripting`. It imports the pure parsing functions from
    `shared/parsers/easyspeak-parser.ts` and does `Object.assign(globalThis, { parseProfileLinks,
    parseMemberchart, parseLevelCell })` inside `main()`. `background/api/easyspeak.ts` injects it by
    its **stable, predictable built path** — WXT bundles every content-script entrypoint as a plain
    IIFE and outputs it at a fixed location derived from the entrypoint's filename, not content-hashed
    (unlike a page/background bundle), so the path is safe to hardcode as a plain string constant:
    ```ts
    const PARSER_FILE = "/content-scripts/easyspeak-parser.js" as const;
    await browser.scripting.executeScript({ target: { tabId }, files: [PARSER_FILE] });
    ```
    (Note the leading `/` — WXT's generated `PublicPath` type, which `files` is typed against, always
    includes it; verify the exact string in `.wxt/types/paths.d.ts` after `wxt prepare` if this ever
    drifts — a wrong path is a compile-time `ScriptPublicPath` type error, not a silent runtime miss.)

    **Why this is safe without the old crxjs `?iife`-query workaround**: WXT's content-script IIFE
    wraps `main()` in an async function, but `main()`'s entire synchronous body (the `Object.assign`
    call) still runs to completion *before* that wrapper's first `await` suspends — so by the time
    `chrome.scripting.executeScript()`'s classic-script injection resolves, the globals are already
    set. The very next line calls the named parser function by name in a second `executeScript` call
    (`func: (fnName) => (globalThis as any)[fnName]()`) — this two-step "inject globals, then call by
    name" shape is plain `scripting` API behavior, unrelated to WXT or crxjs; if you ever see an
    intermittent "not a function" error from that second call, it means this synchronous-body
    guarantee broke (e.g. `main()` itself became `async` and did real work before its first `await`),
    not a WXT bundling regression.
  - **`shared/parsers/easyspeak-parser.ts`** — pure DOM-parsing functions, no `browser.*` dependency
    at all (this is what makes them both wrappable for injection via
    `entrypoints/easyspeak-parser.content.ts` *and* independently testable with `jsdom`). Each takes a
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

- **`shared/sync/conflicts.ts`** — name/path/member matching + override logic, zero `browser.*`
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
    a hardcoded per-caller behavior switch. `entrypoints/members/main.ts` relies on the default (`true`):
    fuzzy suggestions are exactly what that view exists to surface and let a human confirm/reject.
    `entrypoints/report/main.ts` explicitly passes `false`: Club Progress is meant to show only what's
    certain, so an unconfirmed fuzzy guess must never render there as if it were a fact. Setting it
    `false` simply drops fuzzy-confidence candidates from `matchMembers`'s candidate pool before
    `greedyAssign` runs — the pair falls through to the *same* leftover-handling code that already
    produces separate `basecamp-only`/`easyspeak-only` entries for anyone unassigned, so no separate
    "strict" rendering path exists anywhere downstream (the Next Level Summary table and its
    per-row detail in `entrypoints/report/main.ts` all automatically reflect it for free). A
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
  keys in `browser.storage.local` (alongside the pre-existing `basecampData`/`basecampScrapedAt`/
  `easyspeakData`/`easyspeakScrapedAt` — all 10 keys, plus `easyspeakServer` and `iconStatus`, are
  enumerated in `shared/storage.ts`'s `LocalSchema`/`SessionSchema`, which is the single source of
  truth for storage key names — **do not call `browser.storage.*` directly from anywhere outside
  `shared/storage.ts`**). Unlike `shared/sync/*`, this file is legitimately `browser.*`-dependent
  (pure storage I/O) so it isn't Vitest-testable — same as `background/api/basecamp.ts`/
  `background/api/easyspeak.ts`. Used from Club Review, Member Review, and Club Progress (plus
  `shared/sync-status-panel.ts`'s `loadMatchSummary()`, shared by the popup and Sync Data, for the
  Matches count); never imported into `background/`, since none of this needs the background entrypoint.
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
- **`entrypoints/report/index.html` + `entrypoints/report/main.ts`** — the comparison page, titled "Club Progress"
  (reached from the popup's "Open Club Progress" button as a full tab, not a popup window —
  `browser.tabs.create({url: pageUrl(...)})`). Reads `basecampData`/`easyspeakData` straight from
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
  `entrypoints/members/main.ts`, see below; each page defines its own `.warning-icon`/`.conflict-warning`
  CSS) onto any club tab whose pair has no counterpart on the other side, and appends a
  `.tab-count` badge (same convention as `entrypoints/members/main.ts`'s own tab badges) showing that club's
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
  `entrypoints/members/main.ts`'s own path-review detail rows. A single delegated `click` listener on
  `tbody` (attached once, in `renderSummaryTable()`) resolves the clicked row via
  `closest("tr[data-row-key]")`, toggles its key in the module-level `expandedRowKeys: Set<string>`,
  and flips the sibling's `.collapsed` class directly — no full re-render needed for the toggle
  itself. Several rows can stay expanded at once. `expandedRowKeys` is cleared whenever the active
  club changes (both on a tab click and on a full `renderClubTabs()` rebuild), so switching clubs
  always starts collapsed. `renderRowDetail()` looks the row's member up in a module-level
  `activeMembers: Map<string, MemberReport>` (rebuilt in `renderActiveClub()` from the active
  club's `members[]`, keyed by `memberKey()`), finds the specific `PathReport` by `canonicalKey`,
  and renders the member's presence/confidence badges plus the same level-by-level diff table
  (`renderLevelsTable()`, unchanged) the old member cards used to show — reused, not reimplemented.
- **`entrypoints/members/index.html` + `entrypoints/members/main.ts`** — the primary member-matching review workflow,
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
  when a member has no Basecamp counterpart — within each group, even inside "All"; within the
  unmatched group specifically, members with a Basecamp name sort ahead of easyspeak-only members
  before the alphabetical tiebreak applies, so Basecamp names never get interleaved with
  easyspeak-only ones).
  `classifyMember()` (`shared/sync/delta.ts` — exported from there, alongside `memberKey()` and
  `needsAction()`, specifically so `entrypoints/report/main.ts`'s club-tab badges and this page's own tab
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
  `background/`-side message type, since this is plain `browser.storage.local` I/O any extension page
  can do itself (unlike EasySpeak's tab-navigation, which genuinely needs the background entrypoint's
  lifetime across popup teardown — that constraint doesn't apply here). **Every write triggers a
  full `refresh()`** (re-read storage, rebuild the whole report, re-render) rather than a targeted
  DOM patch — simplest way to stay correct given how much a single decision can ripple (e.g. one
  rejection turns one row into two), and consistent with the rest of this codebase's
  rebuild-and-reassign-`innerHTML` rendering style. A member with more than one simultaneous
  orphaned path pair renders one picker row per `basecamp-only` path (`<select>` over that member's
  `easyspeak-only` candidates) rather than assuming exactly one pair.
- **`entrypoints/settings/index.html` + `entrypoints/settings/main.ts`** — titled "Setup". Just the demo/mock mode
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
- **`entrypoints/club-review/index.html` + `entrypoints/club-review/main.ts`** — titled "Club Review". Club-name
  lookup and path-name lookup editors, split out of `entrypoints/settings/main.ts`. The club section is a
  review table (every club from both sources, not just already-pinned ones), same shape/vocabulary
  as `entrypoints/members/main.ts`'s member-matching table: a status badge per club pair (Exact/Suggested/
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
  entry). Used from both `entrypoints/settings/main.ts` (for the dropdown) *and* `background/api/easyspeak.ts`
  (because the actual URL construction that needs the chosen server happens in the background entrypoint).
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
needs EasySpeak's tab-navigation + `browser.scripting` approach (required for anything behind
Cloudflare or similar). And if it needs the latter, its parser must be a `registration: "runtime"`
content-script entrypoint injected by its stable built path, the same way
`entrypoints/easyspeak-parser.content.ts` is — see the injection-pattern bullet above.

## Build tooling

[WXT](https://wxt.dev) (`wxt.config.ts`) builds `src/` into `.output/<mode>/<browser>-mv<manifestVersion>/`
— e.g. `.output/store/chrome-mv3/`, `.output/preview/firefox-mv2/`. There is no hand-authored
`manifest.*.json` anymore (that was crxjs's pre-WXT convention) — `wxt.config.ts`'s `manifest`
option is a function of `{ mode, browser, manifestVersion, command }` that generates the whole
manifest per build, and WXT itself derives the Chrome/Firefox structural differences
(`host_permissions` vs. folding hosts into `permissions`, `background.service_worker` vs.
`background.scripts`, `action` vs. `browser_action`, MV3 vs. MV2) — don't hand-write manifest JSON
again.

### Build modes × browsers

Two independent axes, 4 combinations:
- **Mode** (`--mode store` / `--mode preview`, mirroring the old two-manifest split): `store` is the
  Chrome-Web-Store/AMO submission candidate; `preview` adds `alarms`/`notifications` permissions +
  the `api.github.com` host permission + an "(Preview)" name/title suffix, for the update-checker
  (see `entrypoints/background.ts` above). `wxt.config.ts`'s `manifest()` function branches on
  `mode === "preview"` to add/omit all of this — there's no separate manifest file to keep in sync.
- **Browser** (`-b chrome` / `-b firefox`, default `chrome`): WXT builds Chrome as MV3, Firefox as
  MV2 (Firefox's stable, fully-supported target; `browser.scripting` — which the EasySpeak flow
  leans on hardest — has worked there since Firefox 102). `browser_specific_settings.gecko.id` is
  only added for the `firefox` build.

`outDirTemplate: "{{mode}}/{{browser}}-mv{{manifestVersion}}"` in `wxt.config.ts` is what keeps all
4 combinations in separate output directories — WXT's *default* template only varies by
dev-vs-not, which would otherwise let a `--mode preview` build silently overwrite a `--mode store`
build for the same browser.

npm scripts, one pair per mode × browser: `build`/`build:firefox` (store), `build:preview`/
`build:preview:firefox` (preview) — each runs `tsc --noEmit` first, then `wxt build`. Matching
`zip`/`zip:firefox`/`zip:preview`/`zip:preview:firefox` scripts run `wxt zip` instead (build + zip
in one step) — see `.github/workflows/release.yml` for the exact filenames each produces.
`dev`/`dev:firefox` run `wxt`'s dev server (`-b firefox` auto-launches Firefox via `web-ext`, a WXT
peer dependency).

A few decisions worth knowing before changing the config:

- **`srcDir: "src"`** — same role `root: "src"` played in the old `vite.config.ts`: keeps the
  `src/` prefix out of runtime URLs. Every extension-page path string lives in `shared/pages.ts`.
  `publicDir` (`public/`, unchanged) stays at the repo root by WXT's own default, so `public/icons/**`
  needed no path changes migrating off crxjs.
- **`entrypoints/` uses one-directory-per-page, not flat co-located files** — `entrypoints/report.html`
  + `entrypoints/report.ts` as *siblings* does **not** work: WXT treats a same-named `.html`/`.ts`
  pair at the top level of `entrypoints/` as two conflicting entrypoints named `report` and errors
  with "Multiple entrypoints with the same name detected." The fix (already applied throughout) is
  the directory form — `entrypoints/report/index.html` + `entrypoints/report/main.ts` — where only
  `index.html` is the recognized entrypoint file and `main.ts` is just an ordinary sibling script the
  HTML references via `<script type="module" src="./main.ts">`. Every unlisted page and the popup
  follow this pattern; `entrypoints/background.ts` and `entrypoints/easyspeak-parser.content.ts` are
  flat single files (their own type — background, content-script — is unambiguous from the filename
  alone, so there's no `.html` sibling to collide with).
- **Icon/image references from HTML must be absolute (`/icons/...`, `/images/...`), not
  relative** — `public/` assets aren't visible to Vite's source-relative asset resolution (they're
  copied verbatim to the output root, not bundled), so an `<img src="...">`/`<link href="...">`
  pointing at one is left completely untouched by the build, string-for-string. Since every
  unlisted page/popup entrypoint builds flat at the output root regardless of its *source* nesting
  depth (`entrypoints/report/index.html` → `report.html`, not `report/index.html`), an absolute
  `/icons/default/32.png` reference resolves correctly from every page uniformly; a relative
  `../icons/...` would only happen to work at exactly one specific source nesting depth and silently
  break if that depth ever changes. Genuinely-bundled assets (e.g. `shared/styles.css`, referenced
  via `<link rel="stylesheet" href="../../shared/styles.css">`) are the opposite: they **must** be a
  correct *source*-relative path so Vite's HTML asset pipeline can find, hash, and rewrite them —
  WXT/Vite then rewrites a successfully-resolved reference to an absolute, content-hashed
  `/assets/*.css` path automatically, so the output-depth mismatch that bites unprocessed `public/`
  references doesn't apply here.
- **`entrypoints/easyspeak-parser.content.ts` builds to a stable, predictable path**
  (`content-scripts/easyspeak-parser.js`, no content hash) — this is what lets
  `background/api/easyspeak.ts` hardcode it as a plain string constant instead of needing an import
  trick; see the injection-pattern bullet earlier in this doc.
- **Two zips for Firefox, one for Chrome** — `wxt zip -b firefox` also produces a companion
  `*-sources-<mode>.zip`, since AMO review requires the full source tree for any submission built
  with a bundler/minifier. `.github/workflows/release.yml` attaches all 6 resulting files (chrome ×
  {store, preview}, firefox × {store, preview} + their 2 sources zips) to one GitHub Release.
  `SOURCE_CODE_REVIEW.md` at the repo root (a plain, non-dot file, so it's picked up for free by
  WXT's default `includeSources: ["**/*"]`) exists specifically to ride along in that sources zip
  — it tells an AMO reviewer the two commands (`npm i`, `npm run zip:firefox`) needed to reproduce
  the submitted build from source. Don't move/rename it without checking it still lands inside
  `wxt.config.ts`'s `zip.sourcesRoot` (the project root, unset/default today).
- **`.github/workflows/release.yml`** (manual `workflow_dispatch`, patch/minor/major bump choice) is
  two jobs: `release` bumps `package.json`'s version, tags it, builds+zips all 4 combinations (via
  `wxt zip`, which builds and zips in one step — see above) plus the Firefox sources zip, and creates
  a GitHub Release attaching all 6 files with tester-facing install instructions in the release body
  (kept in sync with whichever store the Chrome build is actually on — see below); then
  `publish-store` (depends on `release`, its own job so a Chrome Web Store API failure never blocks
  the GitHub Release itself) downloads the just-built Chrome store zip and runs `wxt submit
  --chrome-zip ...` against the `chrome-web-store` GitHub Environment's secrets (`CHROME_EXTENSION_ID`/
  `CHROME_PUBLISHER_ID`/a service-account client email + private key — `CHROME_API_VERSION: v2`,
  since the older client-ID/secret/refresh-token v1.1 flow is deprecated and shuts down October 15,
  2026). **The extension is live on the Chrome Web Store** (see README's Installation section for the
  listing URL) — don't write or leave copy anywhere implying otherwise (a stale line to that effect
  in `release.yml`'s own GitHub Release body template is a known leftover from before this job
  existed, not a discovered-and-still-true fact; check `landing/src/data/releaseInfo.ts`'s
  `CHROME_WEB_STORE_URL` for the canonical live listing link before writing install instructions
  anywhere). Firefox has no equivalent auto-publish step — no AMO submission has happened yet, so a
  Firefox install stays "Load Temporary Add-on" only (see README).
- `npm run dev`/`dev:firefox` are useful for iterating on options/popup page markup with faster
  feedback, but MV3/MV2 background + `browser.scripting` behavior (the EasySpeak flow especially)
  should always get a real build + reload before you trust it — same reasoning as the old crxjs
  dev-server caveat this replaced: a cold background wake's very first event tick is the
  lowest-confidence moment for dev-mode module loaders in general. In practice every message here is
  popup-click-initiated (background already warm), so this is a low-probability footgun, not a
  blocker.
- **Node version note**: this project targets **Node 24** (`"engines": { "node": ">=24" }` in both
  `package.json` and `landing/package.json`, enforced nowhere automatically — `npm install` won't
  refuse an older Node on its own — but every CI workflow's `actions/setup-node` pins `node-version:
  24` to match). This replaced an earlier Node 18 pin that held the toolchain back from each
  package's latest major (`vite@^6`, `vitest@^3`, `jsdom@^26`, `typescript@^5.9`) — those majors all
  require Node ≥20, and `typescript@7`'s `bin/tsc` additionally failed to load at all under Node 18 +
  `"type":"module"` (`ERR_UNKNOWN_FILE_EXTENSION` from Node's ESM loader, not a TypeScript bug).
  Current pins: `vite@^8`, `vitest@^4`, `jsdom@^30`, `typescript@^7`, `@types/node@^24`, `wxt@^0.21`.
  Note `typescript@7` is not an incremental release — it's a from-scratch native (Go-based) compiler
  rewrite that deliberately skips major version 6, so watch for it behaving subtly differently from
  the 5.x `tsc` this project used before (edge cases in type-checking, possible gaps vs. less common
  tsconfig flags) rather than assuming it's a drop-in replacement. If the project's Node version is
  ever bumped again, revisiting these pins to whatever's newest at that point follows the same
  pattern — but don't bump the packages without also bumping Node (and the `engines`/CI pins to
  match), or `npm install`/`wxt build`/`tsc` will break exactly as they did before this migration.
- **`tsconfig.json` extends `.wxt/tsconfig.json`** (generated by `wxt prepare`, which `postinstall`
  runs automatically) for the `browser`/`defineBackground`/`defineContentScript`/`import.meta.env`
  ambient types — `include` explicitly adds `.wxt/wxt.d.ts` too, since TypeScript's `extends` does
  **not** merge `include` arrays (the extending config's `include` completely replaces the base's).
  `noUncheckedIndexedAccess` — which WXT's generated base tsconfig turns on by default — is
  explicitly overridden back to `false` in this project's own `compilerOptions`, to preserve the
  pre-WXT strictness level rather than surfacing a wave of unrelated "possibly undefined" errors
  project-wide; don't remove that override without fixing the resulting errors throughout
  `shared/sync/*`/`shared/parsers/*`/`tests/*` first.

## Conventions

- UI strings, comments, and README are in English; keep new user-facing text and comments
  consistent with that.
- **TypeScript + [WXT](https://wxt.dev), real ES module `import`/`export` everywhere, cross-browser
  via the `browser` global (never `chrome.*` directly).** This reverses an earlier "no
  transpilation/bundling" convention (long gone) and, more recently, replaced a Chrome-only Vite +
  `@crxjs/vite-plugin` setup with WXT specifically to add Firefox support — don't reintroduce
  hand-authored `manifest.*.json` files, a bare `vite.config.ts`, or direct `chrome.*` calls; that's
  the old architecture, not a simpler version of the current one. `.output/` (and the generated
  `.wxt/`) are build artifacts — gitignored, never hand-edited, never committed.
- `browser.storage.*` is called only from `shared/storage.ts`; `shared/**` must never import from
  `background/**` (see the layering rule under "Architecture"); a dynamically-injected content
  script must be a `registration: "runtime"` WXT content-script entrypoint (see the injection-pattern
  bullet above), injected by its stable built path — not a manifest-declared `content_scripts` match
  rule, and not the old crxjs `?iife`-import workaround (WXT bundles content scripts as IIFEs by
  default, so that trick no longer applies at all).
- `public/icons/*.png` were generated once via a scratchpad-only Node script (hand-written SVGs
  rasterized with `sharp`) — that tool isn't part of the repo and never will be; if the icon designs
  need to change, regenerate the PNGs the same throwaway way rather than adding an image-processing
  dependency to the project itself. Icons are organized one subfolder per state — `default/`,
  `error/`, `success/` (each `<size>.png` for sizes 16/32/48/128), and `loading/` (`<frame>-<size>.png`
  for frames 0-7) — read by `background/icon-state.ts` at runtime; this folder layout and naming must
  be preserved exactly if these ever change.
