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
5. Click the extension icon — the popup is just a branded header + vertical stepper (no scrape
   buttons of its own, see Architecture) — then click its "Sync Data" step, which focuses/opens the
   merged app on `#syncData` (`shared/app-tab.ts`'s `focusOrOpenAppTab()`; re-clicking it later
   re-routes that same tab instead of opening a duplicate). On that tab, click "Import Basecamp
   Data" and/or "Import EasySpeak Data" — no Basecamp tab needs to stay open (unless a login is
   required — see Architecture). EasySpeak scraping always opens and focuses a *further* brand-new
   tab on the configured EasySpeak server (never reuses an already-open one — see Architecture for
   why); that tab redirects to a "data fetched" confirmation page and closes itself a few seconds
   later once scraping finishes, returning focus to the Sync Data tab. (If the popup itself happens
   to still be open when a scrape starts, stealing tab/window focus this way does still close it —
   both Chrome and Firefox tear down `action` popups the instant they lose focus, and that's exactly
   what `ensureEasySpeakTab()`/`ensureBasecampDashboardTab()` do — but the scrape itself no longer
   depends on the popup staying open, unlike the older popup-hosted-buttons design this replaced.)
6. Inspect each source's card on the Sync Data tab (badge, member count, "View details" for the
   summary table + raw JSON), or check the background entrypoint's console (`chrome://extensions` →
   this extension → "service worker" inspect link on Chrome; `about:debugging` → "Inspect" on
   Firefox) for errors. Code injected into the EasySpeak tab via `browser.scripting` logs to that
   *tab's* own DevTools console, not the background's.
7. Watch the toolbar icon while a scrape runs: it should animate (spinning), then land on a green
   check or red cross, then revert to the classic icon the next time you open the popup (see
   `background/icon-state.ts` in Architecture). Each source's "Import"/"Re-import" button on the
   Sync Data tab should be disabled only while *that* source is loading.

Background errors surface via the response returned to the caller (`{ ok: false, error }`), not the
console — check `entrypoints/app/views/syncData.ts`'s per-source status line first when debugging a
failed scrape.

`.github/workflows/ci.yml` runs `test` (Vitest), then `lint:css` (stylelint against
`src/shared/styles.css` only — see below), then the store/Chrome build, then the Playwright
`test:e2e` suite (see below) against that build, then the remaining 3 build combinations
(store/preview × chrome/firefox) on every push/PR to `main` — a green run there is not a substitute
for the manual walkthrough above, which is the only thing that exercises the real `browser.*` flows,
**on both browsers** — Firefox's
non-persistent MV2 background page has a similar but not necessarily identical idle-suspension model
to Chrome's MV3 service worker, so don't assume a flow that works on Chrome automatically works on
Firefox too, especially the EasySpeak scrape's multi-minute login-wait timeouts.

`npm run typecheck` (`tsc --noEmit`, no `wxt build`) is the fast way to check types alone.

`npm run lint:css` (stylelint, config in `stylelint.config.js`) checks `src/shared/styles.css`
only — per-page inline `<style>` blocks aren't covered (would need `postcss-html` syntax support,
not added). `stylelint-config-standard`'s selector-naming/blank-line/color-notation opinions are
disabled in that config, since they conflict with this file's established conventions (BEM `__`/`--`
class names, declarations grouped without blank lines) rather than indicating an actual mistake —
don't re-enable them without reformatting the file to match, and don't treat a clean `lint:css` run
as a full CSS style-guide check, just a catch for genuine errors (typos, invalid values, unknown
at-rules).

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

This suite is also what caught a real, previously-invisible bug in
`entrypoints/app/views/syncData.ts`'s `refresh()` (not a test-infra issue at all — a
`locator.waitFor: Target page, context or browser has been closed` timeout kept reproducing waiting
on `#badgeEasySpeak` specifically, and its captured page snapshot showed the "Data Import Complete"
banner and Export card already correctly reflecting both sources loaded while that one badge alone
stayed stuck on "Importing"). Root cause: `refresh()` awaits `sendMessage({type: "POPUP_OPENED"})`
(→ `statuses`) and `local.get(...)` (→ `cached`) *sequentially*, not as one atomic snapshot, while
`background/messaging.ts`'s `runScrape()` always writes the scraped data to `storage.local` *before*
flipping that source's `storage.session` icon status to `"success"`. A call whose two reads straddle
that exact instant can see `cached` already holding the finished data while its earlier `statuses`
read still says `"loading"` — a single call's own two-reads-at-different-times inconsistency, not
(only) a race between overlapping `refresh()` invocations (`browser.storage.onChanged` also triggers
`refresh()` independently the moment the `local` write lands, well before that status flip — see the
layering note in that view's own comments). Fixed with two mechanisms, both still in place: a
`refreshToken` counter so a stale, later-resolving `refresh()` call never overwrites a fresher one's
render, and — the fix that actually closed the gap — treating data presence as authoritative over a
possibly-stale loading flag (`basecampLoading = statuses.basecamp === "loading" &&
!cached.basecampData`, same for EasySpeak): a source with its data already in storage is never still
"loading," regardless of what a status flag captured a moment earlier claims. Verified by running the
suite repeatedly with `retries: 0` (to stop retries from masking a still-partially-fixed bug) until
it stayed consistently green. If a similar "stuck on a transient status despite the underlying data
already being ready" symptom shows up on another view sharing this same `POPUP_OPENED`/
`storage.local` pattern, look here first.

The same repeated-`retries: 0` technique later caught two more real bugs, this time in the SPA shell
itself (`entrypoints/app/main.ts`) rather than in any one view — introduced by the report/members/
settings/sync-data/club-review/global-settings merge into one client-routed entrypoint, and specific
to the concurrency that merge introduces (every "navigation" used to be a full page load with no
in-flight state to race; a client-side route change has both). Both were caught by literally running
`npx playwright test --retries=0 --repeat-each=5` until failures stopped reproducing, not by
inspection — don't trust a single green run of a new SPA-shell change, repeat it.
- **Stale mount torn down by an unrelated same-route refresh**: `sync-data-export.spec.ts`'s
  "upgrades the automatic fallback pick" test failed reproducibly (2 of 3 bare runs) with the Export
  popover stuck open and its outside-click-to-close listener silently gone — confirmed with a
  throwaway Node+Playwright script that dispatched a manual `mousedown` on `document.body` and
  observed the popover simply didn't react. Root cause: `navigate()` used one `navToken`, bumped on
  *every* call, to decide whether an in-flight `VIEWS[route].mount()` was still wanted by the time it
  resolved. `setActiveProfile()`'s two sequential `storage.local` writes (the profile itself, then
  `clearProfile("demo")`) each fire their own `storage.onChanged` — the second one raced a still-
  mounting `syncData` view: it re-entered `navigate()`, saw `route === currentRoute` (a same-route,
  chrome-only refresh, no remount needed) and returned early, but that early call had already bumped
  the shared token past what the in-flight mount was compared against — so when that mount finally
  resolved, it read itself as stale and called its own `dispose()`, ripping out the listener it had
  just registered while its DOM stayed live on screen (nothing else had cleared `#viewRoot`). Fixed
  by splitting the single counter into two: `navToken` (bumped every call, only ever used to bail out
  of a superseded chrome-only render) and a separate `mountToken` (bumped only at the moment a *real*,
  route-changing mount actually begins) — a same-route no-op call can no longer poison a real mount's
  staleness check. If a view's listeners mysteriously stop firing after an unrelated storage write
  lands mid-navigation, check this split hasn't regressed back into one counter.
- **In-flight `refresh()`/`init()` writing into a different view's DOM after being disposed**:
  running the `pages-render.spec.ts` smoke tests repeatedly surfaced `"Cannot set properties of null
  (setting 'textContent')"` console errors on Club Progress/Member Review/Club Review, reproducing on
  ~2 of 3 runs. Root cause: `#viewRoot` is one persistent DOM node reused across every view's
  `mount()` (not a fresh container per view), so a view's own async `refresh()`/`init()` — triggered
  by a `storage.onChanged` event fired *before* the user navigated away, e.g. `syncData`'s own
  `refresh()` still awaiting `loadMatchSummary()` when the test's next `page.goto()` lands — resumes
  after the shell has already disposed that view and mounted a different one into the same node.
  Every view's own `document.getElementById(...)`/`root.querySelector(...)` calls inside that stale
  continuation then either return `null` for an id the new view doesn't have (a crash) or — worse,
  though not yet observed — silently hit an id the new view *does* happen to share, corrupting its
  DOM instead of crashing. Fixed by giving every `entrypoints/app/views/*.ts` a local `disposed`
  flag, set `true` by the returned disposer and checked after each `await` that precedes a DOM write
  inside `refresh()`/`init()` (and the write skipped, not attempted, once `disposed` is true) — see
  `syncData.ts`'s `mount()` for the fullest example and the pattern every other view follows. When
  adding a new view or a new async entry point to an existing one, thread this same guard through any
  `await` that's followed by a DOM write; skipping it re-opens this exact crash class.

`playwright.config.ts` is deliberately standalone from `wxt.config.ts`/`vitest.config.ts`, same
isolation reasoning as the `vitest.config.ts` bullet above, and `e2e/**/*.spec.ts` lives outside
`tests/` so Vitest's own `include` glob never picks it up.

**This e2e suite cannot be extended to Firefox — confirmed by testing, not assumption.** Chromium's
`--load-extension`/`--disable-extensions-except` args (`e2e/fixtures.ts`'s `context` fixture) are
Chromium-only: passing them to `firefox.launchPersistentContext()` gets them silently ignored (with
`DEBUG=pw:browser` on, Firefox itself logs `"Warning: unrecognized command line flag"
"-disable-extensions-except"`) — no extension loads, `context.pages()` stays empty. The classic
"extension proxy file" sideloading trick (a pointer file in the profile's `extensions/` folder) also
does not work against Playwright's bundled Firefox: modern Firefox removed profile-directory
sideloading entirely as an anti-malware measure, regardless of `xpinstall.signatures.required`/
`extensions.autoDisableScopes` prefs. Even if a working install method existed, `BrowserContext
.backgroundPages()` is hardcoded to return `[]` outside Chromium (the Playwright type itself says
"Background pages have been removed from Chromium together with Manifest V2 extensions" — Firefox
was never supported here at all), so there'd be no way to read a Firefox background page's console
through Playwright regardless. **Practical consequence: this repo has zero automated regression
coverage for Firefox-specific `browser.*` behavior.** Every Firefox bug found so far (see the
`background/messaging.ts`, `background/icon-state.ts`/`shared/browser-action.ts`, and
`background/api/basecamp.ts` bullets below) was caught only by manual testing against a real
Firefox build — the manual walkthrough in "Running / testing changes" above is not optional
diligence for a Firefox-touching change, it is the *only* diligence available. When debugging a
Firefox-only issue with no other lead, the most direct path is: add temporary `console.log`s in the
suspect background code, have the tester reload the build, reproduce, and open
`about:debugging#/runtime/this-firefox` → "Inspect" on the extension *before* reproducing (so the
background console's history isn't already gone) — then remove the logging once fixed, as this
project's own history in `background/api/basecamp.ts` did.

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
│   ├── app/                         # the merged single-page app — all six wizard/settings views
│   │   │                             # (Setup, Sync Data, Club Review, Member Review, Club Progress,
│   │   │                             # Global Settings) in ONE entrypoint, client-side hash-routed
│   │   │                             # (#setup, #syncData, ...), no full page reload between
│   │   │                             # steps — see "The merged app/ SPA" below for the full writeup
│   │   ├── index.html + main.ts     # the shell: #appShell/#viewRoot/#stepFooter roots + the router
│   │   ├── router.ts                # resolveRoute() — pure hash -> AppRoute resolution
│   │   └── views/                   # plain TS modules, NOT entrypoints themselves (no index.html)
│   │       ├── report.ts            # read-only comparison view ("Club Progress")
│   │       ├── members.ts           # interactive member-matching review ("Member Review")
│   │       ├── setup.ts             # demo/real-data profile picker ("Setup")
│   │       ├── syncData.ts          # Data Extraction card, backed by
│   │       │                        #   shared/sync-status-panel.ts ("Sync Data")
│   │       ├── clubReview.ts        # club-name lookup editor ("Club Review")
│   │       ├── globalSettings.ts    # Anonymize Mode + path-name lookup ("Global Settings")
│   │       └── index.ts             # the AppRoute -> ViewModule registry main.ts routes against
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
                                      # settings-store.ts/sync-status-panel.ts/update-store.ts/
                                      # countdown.ts/app-tab.ts/browser-action.ts
    ├── types.ts             # the domain type catalog — read this first when touching data shapes
    ├── storage.ts           # the ONLY file allowed to call browser.storage.* directly
    ├── pages.ts             # extension page URL constants (browser.runtime.getURL wrapper), plus
    │                        # AppRoute/appRouteUrl() addressing the merged app's hash-routed views
    ├── send-message.ts      # typed browser.runtime.sendMessage() client for entrypoints/popup/main.ts
    ├── browser-action.ts    # actionApi = browser.action ?? browser.browserAction — see
    │                        # background/icon-state.ts below for why this fallback is required
    ├── countdown.ts         # shared auto-close-in-5s behavior for the two status pages above
    ├── app-shell.ts         # shared header/nav bar (renderAppShell), rendered into #appShell once
    │                        # by entrypoints/app/main.ts (not per-view — see below)
    ├── app-tab.ts           # focusOrOpenAppTab() — finds-or-opens the merged app's tab on a given
    │                        # route, used by the popup instead of always opening a new tab
    ├── view.ts              # ViewModule — the mount(root)/dispose contract every
    │                        # entrypoints/app/views/*.ts implements
    ├── sync-status-panel.ts # Data Extraction card logic, currently used only by
    │                        # entrypoints/app/views/syncData.ts (not the popup — see below)
    ├── dom-utils.ts         # escapeHtml/escapeAttr/warningIconHtml
    ├── settings-store.ts    # active profile (demo, or one of the three EasySpeak regions) + Anonymize Mode
    ├── resolution-store.ts  # the 6 persisted name-resolution keys
    ├── sync/
    │   ├── conflicts.ts      # name/path/member matching + override logic
    │   └── delta.ts          # buildReport orchestrator, diffing, level summary — imports conflicts.ts
    ├── export/               # "Export to Excel" (Sync Data view) — see below
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
options views (never the background entrypoint) but `delta.ts` imports matching functions from
`conflicts.ts`, so the dependency graph is `entrypoints/app/views/*.ts → shared/sync/delta →
shared/sync/conflicts → shared/types`, always acyclic. `background/icon-state.ts` conversely is
deliberately *never* imported by any page (it owns a running `setInterval` for the icon spin
animation; a second copy imported into a page would start its own independent interval fighting the
background's own over `browser.action.setIcon()`) — the popup only ever asks background for the
current statuses via the `POPUP_OPENED` message (`entrypoints/app/views/syncData.ts`'s `mount()`
sends the identical message the same way, since it drives the same shared
`shared/sync-status-panel.ts` rendering/status logic).

Two scraper pipelines with different shapes, sharing one trigger flow from the popup: **popup →
background entrypoint → source-specific scraper**.

- **`shared/sync-status-panel.ts`** — the shared logic behind the Data Extraction card's per-source
  rendering/formatting/scrape-click code, currently used only by `entrypoints/app/views/syncData.ts`
  (see that view's bullet below) — the popup no longer has its own copy of this UI at all (see the
  popup bullet immediately below), so this is a single-consumer shared module today, kept separate
  from `syncData.ts` on the expectation a future page could reuse it, not because two pages
  currently do. Exports `bindSourceEls()` (looks up a source's four elements by id), `onScrapeClick()`
  (sends `{type: "SCRAPE_BASECAMP"}` / `{type: "SCRAPE_EASYSPEAK"}` to the background entrypoint via
  `shared/send-message.ts`'s typed `sendMessage()`, parameterized by message type and a render
  function), `renderScrapeResult()` (renders a source's summary table + raw JSON), `setButtonLoading()`
  (disables + relabels the triggering button while a request is in flight — **not** the status line
  or summary/raw-data panels, so "Last extraction: ..." and the previous result stay visible the
  whole time; only a completed extraction or an error updates the status line), and
  `loadMatchSummary()` (re-derives the matched/total count via `buildReport()`, used by `syncData.ts`'s
  completion summary). `renderStatusSummary()`/`#statusSummary` are also exported but currently
  unwired — no page renders into a `#statusSummary` root — pre-existing dead code, not something the
  SPA merge introduced or removed. On a successful scrape, `onScrapeClick()` writes to
  `browser.storage.local` itself (via `shared/storage.ts`'s `local.set`:
  `basecampData`/`basecampScrapedAt`, `easyspeakData`/`easyspeakScrapedAt`) — **this write cannot be
  the only copy** (see the `background/api/*.ts` bullets below).
- **`entrypoints/popup/main.ts`** — deliberately thin: just the branded header, the vertical stepper
  (`renderVerticalStepper()`, `shared/app-shell.ts`), and the update banner (preview builds only,
  see `background/api/update-checker.ts` below) — no scrape buttons, no per-source status, no raw
  data, and no direct dependency on `shared/sync-status-panel.ts` at all; all of that now lives
  exclusively on the Sync Data view (`entrypoints/app/views/syncData.ts`), reached by clicking the
  stepper. `init()` sends `{type: "POPUP_OPENED"}` before anything else, purely so background can
  acknowledge any finished success/error icon status (see `background/icon-state.ts` below) — the
  popup itself no longer shows per-source status, so this is only about the toolbar icon now, not
  about restoring button state. The gear icon and every stepper item call
  `shared/app-tab.ts`'s `focusOrOpenAppTab()` (a stepper item's `AppShellPage` key comes off its
  `data-page-key` attribute via a single delegated click listener on `#popupStepperRoot`) instead of
  `browser.tabs.create()` directly, so re-clicking a step while the merged app is already open in
  some tab focuses and re-routes that tab rather than piling up duplicates — see `shared/app-tab.ts`'s
  own bullet below. Never calls `browser.tabs.*`/`browser.windows.*` itself (that's all inside
  `shared/app-tab.ts`), and doesn't touch `browser.storage.session` or EasySpeak's own tab handling
  at all — icon/status handling lives in `background/icon-state.ts`, EasySpeak's tab-navigation
  scrape lives in `background/api/easyspeak.ts`, both background-only.
- **`entrypoints/app/views/syncData.ts`** — the Sync Data view, wired up against
  `shared/sync-status-panel.ts`: the Data Extraction card + Export card. Unlike the popup, the merged
  app runs in a regular tab, not an `action` popup — Chrome/Firefox never tear it down just because
  `ensureEasySpeakTab()` steals tab/window focus, so a scrape triggered here survives exactly the
  focus-loss event that kills the popup mid-scrape (see `background/api/easyspeak.ts` below). Has
  its own `browser.storage.onChanged` listener re-running `refresh()` (registered/removed inside
  `mount()`/its disposer — see "The merged app/ SPA" below), matching every other view's convention;
  the popup doesn't need this since it's re-created fresh on each open. Also owns a third card,
  Export, with a single "Export to Excel" button that calls `shared/export/export-to-excel.ts`'s
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
  own "Get started" button (`location.href = appRouteUrl("setup")`, `shared/pages.ts` — navigating
  that same tab rather than opening a second one). `entrypoints/welcome/main.ts` has no
  `browser.storage`/resolution-store dependency at all — it's a static walkthrough, not part of the
  stepper flow the merged app's six views share (no `app-shell.ts` nav on it), so it isn't wired into
  `NAV_ITEMS`.

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
  `entrypoints/app/views/members.ts`'s direct resolution-store writes (no background-lifetime
  constraint applies here, unlike EasySpeak's tab-navigation). This used to trigger the release zip download
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

  **The listener must `return` each branch's response promise, not a bare `true`** — this was a real,
  shipped Firefox bug, not a style preference. The original code called `runScrape(...)`/
  `acknowledgeIconStatuses().then(sendResponse)` without returning the resulting promise, then
  separately `return true`d to signal "responding asynchronously" (the Chrome-only callback-style
  idiom). On Firefox this produced an uncaught `"Promised response from onMessage listener went out
  of scope"` error on essentially every message — Firefox needs the listener's own return value to
  *be* the pending promise it tracks, not a disconnected boolean, or its internal bookkeeping for that
  pending response can be torn down before `sendResponse` ever fires. Silent-looking but not
  harmless: `entrypoints/popup/main.ts`'s `init()` and `entrypoints/app/views/syncData.ts`'s
  `refresh()` both `await sendMessage({type: "POPUP_OPENED"})` with no error handling at the time,
  so the resulting rejection aborted their whole function before ever reaching the actual UI
  render — the popup showed its header with no stepper, and Sync Data never updated its cards. Fixed
  by having every branch `return` its response promise (a `Promise` object is exactly as truthy as
  literal `true`, so Chrome's callback-style channel-keepalive check is unaffected) *and* by making
  `sendMessage({type: "POPUP_OPENED"})` calls resilient to rejection instead of letting them gate
  rendering (both call sites now fall back to a default rather than throwing).

  A second, easy-to-miss layer of the same bug: **the returned promise's own resolved *value* also
  matters on Firefox**, independent of the `sendResponse()` call. Chrome only ever looks at the
  `sendResponse()` callback for the actual payload and ignores what the returned promise resolves to
  — but Firefox uses the *returned promise's resolution* as the authoritative response. The first fix
  above returned `runScrape(...)`'s promise correctly (silencing the Firefox error) but `runScrape()`
  itself only called `sendResponse(envelope)` as a side effect and implicitly returned `void` —
  meaning Firefox delivered `undefined` as every scrape's response even though `sendResponse` had
  sent the real data. Symptom: the "went out of scope" error disappeared, but Import buttons did
  nothing (Chrome, tested via the e2e suite, was completely unaffected by either the bug or the fix,
  since it never looks at the resolved value at all). Fixed by having `runScrape()` (and the
  `POPUP_OPENED` branch) build the response value once and both `sendResponse()` it *and* `return` it
  — so Chrome and Firefox always end up with the identical payload regardless of which delivery
  mechanism actually wins. If a new message type is ever added here, it must follow this same
  "build once, `sendResponse()` it, `return` it" shape — anything that only calls `sendResponse()`
  without returning that same value reintroduces this exact bug on Firefox, invisibly on Chrome.
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

  Every icon mutation goes through `shared/browser-action.ts`'s `actionApi` (`browser.action ??
  browser.browserAction`), never `browser.action` directly — this was a real, shipped Firefox bug.
  `browser.action` is the MV3-era name; Firefox only aliases it onto its native MV2
  `browser.browserAction` starting in **Firefox 128** (mid-2024), and WXT does not polyfill this
  itself (verified against its bundled output — no `browserAction` string appears anywhere in it).
  On an older Firefox, `browser.action` is simply `undefined`, and `applyIcon()`'s
  `actionApi.setIcon(...)` call — reached as the very first `await` inside `runScrape()`, before any
  network activity — threw immediately, silently failing every single scrape with **no** visible
  error anywhere a tester would normally look (not the status line, since the failure happened before
  `runScrape()`'s own `try`/`catch`; the rejection just propagated out as the message response — see
  the `background/messaging.ts` bullet above for why *that* was silent too, before its own fix).
  `shared/update-store.ts` and `background/api/update-checker.ts` (preview-build-only) hit the exact
  same API and use the same `actionApi` import for the same reason. If a future browser API split
  like this shows up elsewhere (MV3 name existing only from some Firefox version onward), this is the
  established pattern to follow: a tiny `shared/*.ts` module exporting a `?? `-fallback constant, not
  a scattered `browser.foo ?? browser.bar` inline at each call site.
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
     (`APPROVALS_URL`) via `waitForLoginRedirect()`, which registers its `browser.tabs.onUpdated`/
     `onRemoved` listeners **before** calling `browser.tabs.update()`, for the identical
     race-avoidance reason documented below for `navigateAndWaitForRealPage()`.

     **`waitForLoginRedirect()` cannot just wait for the tab's URL to equal `APPROVALS_URL`
     again — this was a real, shipped Firefox bug, found and fixed only through live testing against
     a real (unauthenticated) account, not something apparent from reading the code.**
     `APPROVALS_URL` is a **client-rendered SPA**, not a server-redirected page: an unauthenticated
     visit's static shell reaches the browser's `"complete"` state almost immediately — well before
     the page's own JS has even made the auth-check call that decides whether to redirect — and only
     afterward (confirmed over a second later against a real account) does it client-side-redirect,
     via `window.location`, to an Azure AD B2C login page under `login.toastmasters.org`
     (`BASECAMP_LOGIN_ORIGIN`). A first fix trusted a single `"complete"`-at-`APPROVALS_URL` snapshot
     immediately, resolving with no real Basecamp page ever shown and no real login ever attempted — a
     false positive that made every scrape appear to hang with zero network activity, since the retry
     fetch after the "resolved" login was still unauthenticated. A second fix added a fixed re-check
     delay (250ms, then 2s) before trusting that snapshot, which reduced but did not eliminate the
     false positive, since the real redirect's timing varies per attempt and can exceed any fixed
     guess. The actual, current fix mirrors `navigateAndWaitForRealPage()` below exactly instead of
     guessing a delay: `checkTab()` explicitly recognizes a `"complete"` at a URL starting with
     `BASECAMP_LOGIN_ORIGIN` as "still waiting for the human to log in" (`awaitingLogin`, its own long
     5-minute timeout, mirroring EasySpeak's `login.php` handling) rather than treating absence of a
     redirect as proof of success. Every `"complete"`-at-`APPROVALS_URL` candidate — the first sighting
     *and* the one after a real login — must then survive a 3-second settle window
     (`APPROVALS_SETTLE_MS`) before being trusted. Critically, that settle window's own expiry
     **re-reads the tab's actual live state via a fresh `browser.tabs.get()` call, rather than
     trusting only whether the `onUpdated`-driven `awaitingLogin` flag had already flipped** — an
     even subtler race than the delay-length one: `onUpdated` firing for the login redirect is not
     guaranteed to be *processed* before the settle timer's callback runs, so trusting the flag alone
     let a real, visibly-occurring redirect lose that race (the user watched the real Microsoft login
     page appear, then get yanked away to the extension's own confirmation page underneath them,
     because the flag hadn't been set yet when the timer fired even though the tab had already
     navigated). The live re-read is what actually closes this: it reflects the tab's true current
     state regardless of event-delivery timing. **If a similar "trusted a `complete` event/absence of
     a redirect too early" symptom shows up in a browser-tab-navigation flow again, this is the
     pattern to reach for: explicit recognition of the known "not authenticated" URL/content signal
     (matching `navigateAndWaitForRealPage()`'s `loginPath`/`RESTRICTED_ACCESS_TEXT` checks), not a
     bare status+URL match, and never trust a settle timer's expiry without an independent live
     re-read alongside whatever event-driven flag exists.** Once resolved, `fetchJson()` retries the
     original request exactly once; a second 401/403 (e.g. wrong account) throws instead of looping.
     Once `waitForLoginRedirect()` resolves, `waitForBasecampLogin()` redirects the tab to
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
    a hardcoded per-caller behavior switch. `entrypoints/app/views/members.ts` relies on the default
    (`true`): fuzzy suggestions are exactly what that view exists to surface and let a human
    confirm/reject. `entrypoints/app/views/report.ts` explicitly passes `false`: Club Progress is
    meant to show only what's certain, so an unconfirmed fuzzy guess must never render there as if
    it were a fact. Setting it `false` simply drops fuzzy-confidence candidates from
    `matchMembers`'s candidate pool before `greedyAssign` runs — the pair falls through to the *same*
    leftover-handling code that already produces separate `basecamp-only`/`easyspeak-only` entries
    for anyone unassigned, so no separate "strict" rendering path exists anywhere downstream (the
    Next Level Summary table and its per-row detail in `report.ts` all automatically reflect it for
    free). A `memberLinks`-confirmed pair
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
  `shared/sync-status-panel.ts`'s `loadMatchSummary()`, used by Sync Data's own completion summary
  — the popup gets its own match-related stepper info through a separate path,
  `shared/stepper-info.ts`'s own inline `buildReport()`/`computeMatchSummary()` calls, not through
  `sync-status-panel.ts` at all); never imported into `background/`, since none of this needs the background entrypoint.
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

**The merged `app/` SPA**: the five wizard steps (Setup, Sync Data, Club Review, Member Review, Club
Progress) plus Global Settings used to be six fully separate WXT entrypoints, each its own tab-opened
page with a full reload on every step transition. They're now one entrypoint,
`entrypoints/app/` (`app.html`), with client-side hash routing (`#setup`, `#syncData`,
`#clubReview`, `#members`, `#report`, `#globalSettings`) and no reload between steps — hash routing,
not the History API, since an extension page has no server to fall back to for a direct/bookmarked
`/report`-style path, and a hash router needs none. Popup and the three background-initiated
interstitials (`welcome/`, `basecamp-auth/`, `easyspeak-done/`) stay separate entrypoints, unrelated
to this merge — the popup is a distinct manifest surface with its own lifecycle, and the
interstitials are tab-lifecycle-driven single-purpose confirmation pages.
- **`entrypoints/app/main.ts`** — the shell: owns the three roots every view shares
  (`#appShell`/`#stepFooter`/`#viewRoot`) and the `navigate(rawHash)` driver, called on `hashchange`
  and once at module load. Centralizes what each of the six former pages used to render
  independently — `renderAppShell()`/`renderStepFooter()`/`markStepVisited()` — into one place,
  `renderChrome()`, called once per navigation; a view (below) now owns only its own body content,
  never the shared chrome. Also owns a shell-only `browser.storage.onChanged` listener that
  re-renders just the chrome on any `local` change, independent of whatever the currently-mounted
  view does with its own listener — the two write to disjoint DOM subtrees and both re-derive fresh
  state from storage every time, so there's nothing to get out of sync between them regardless of
  firing order. `navigate()` disposes the outgoing view (calling the disposer its `mount()` returned
  — see `shared/view.ts` below), clears `#viewRoot`, sets `document.body.dataset.view = route` (the
  scoping hook `shared/styles.css`'s few view-specific rules key off), then mounts the incoming one —
  strictly in that order, since a view's `mount()` relies on being the only one whose markup exists
  in `#viewRoot` at a time (see `shared/view.ts`). Uses two separate monotonic counters,
  `navToken`/`mountToken` — not one — to guard against two different concurrency classes a client
  router introduces that a full-page-load navigation never had to worry about: `navToken` (bumped on
  *every* `navigate()` call) lets a call bail out early if a newer one already started while it was
  awaiting `computeStepperInfo()`; `mountToken` (bumped only when actually about to mount a *new*
  view) decides whether an in-flight `mount()` is still wanted by the time it resolves. Collapsing
  these into one counter was a real, shipped bug — see "Stale mount torn down by an unrelated
  same-route refresh" under "Running / testing changes" above for the exact race and its symptom;
  don't re-merge them.
- **`entrypoints/app/router.ts`** — `resolveRoute(rawHash, info)`, pure and independently reasoned
  about from `main.ts`'s actual navigation driver. An empty/unrecognized hash defaults to
  `"setup"` (the wizard's first step); a recognized-but-currently-`disabled` wizard step (per
  `shared/stepper-info.ts`'s `StepperInfo` — e.g. a bookmarked `#report` saved before Setup was ever
  finished) is redirected back to `"setup"` too. `globalSettings` is never gated, since it isn't
  one of the five wizard steps `StepperInfo` tracks disabled-ness for.
- **`shared/view.ts`** — the `ViewModule` contract every `entrypoints/app/views/*.ts` module
  implements: `mount(root): Promise<() => void>`. All DOM binding, event-listener registration, and
  per-visit state must happen inside `mount()`, not at module top level (unlike the old one-page-per-
  view code, which could safely do `const el = document.getElementById(...)` at module load — that
  now runs once total, at extension-page load, long before any specific view's markup exists).
  Because `main.ts`'s `navigate()` guarantees only one view's markup exists in `#viewRoot` at a time
  (dispose old → clear → mount new, always in that order), plain `document.getElementById()`/
  `root.querySelector()` lookups inside `mount()` stay exactly as safe as they were in the old
  per-page code — the previous view's same-named elements are provably gone by the time a new
  `mount()` runs, so `shared/sync-status-panel.ts`'s `bindSourceEls()` (plain `getElementById`)
  needed no signature change to keep working. The returned disposer must remove every listener
  `mount()` registered *outside* `root` itself (a `document`-level listener, most notably —
  `syncData.ts`'s popover-outside-click handler is the one view with one) since clearing `#viewRoot`'s
  innerHTML does nothing for those. Just as important, and easy to miss: an async `refresh()`/`init()`
  that was already in flight when the view got disposed does **not** stop running just because its
  listeners were removed — every view keeps a local `disposed` flag, set by its disposer and checked
  after each `await` that precedes a DOM write, specifically to stop a stale continuation from
  writing into whatever view has since taken over the same `#viewRoot` node. See "In-flight
  `refresh()`/`init()` writing into a different view's DOM after being disposed" under "Running /
  testing changes" above for the crash this guards against and why it wasn't optional.
- **`shared/app-tab.ts`** — `focusOrOpenAppTab(route)`, `browser.tabs`/`browser.windows`-dependent
  (same established `shared/**`-with-a-`browser.*`-exception category as `storage.ts`/
  `settings-store.ts`/`sync-status-panel.ts`/`update-store.ts`/`countdown.ts`/`browser-action.ts`,
  listed at the top of this section). Used by the popup's gear icon and vertical-stepper clicks instead of
  `browser.tabs.create()` directly: finds an existing tab already showing the merged app (any route,
  via a wildcarded `browser.tabs.query({url: base + "*"})`, since a plain URL match wouldn't see past
  the fragment) and `browser.tabs.update()`s it to the requested route + focuses its window, rather
  than piling up a duplicate tab every time a step is re-clicked. No precedent for this "find or
  create" pattern existed anywhere else in this codebase to reuse — `background/api/basecamp.ts`'s
  `ensureBasecampDashboardTab()`/`background/api/easyspeak.ts`'s `ensureEasySpeakTab()` are
  explicitly documented as "always create new, never reuse" by design, the opposite need, for an
  unrelated login/Cloudflare-tab concern.

The six views below plug into the shell just described — each is a plain `ViewModule`, not an
entrypoint itself (no `index.html`, no separate build output):
- **`entrypoints/app/views/report.ts`** — the comparison view, titled "Club Progress" (a
  `ViewModule`, reached from the popup's vertical stepper via `focusOrOpenAppTab("report")`, or by
  clicking its `app-shell.ts` nav item once already inside the merged app — see "The merged app/
  SPA" above for how a view's `mount()`/disposer lifecycle works). Reads `basecampData`/
  `easyspeakData` straight from storage (no live scraping) plus resolution data via
  `loadResolutionData()` — loading resolution here is required, not optional, otherwise this view's
  "Next Level Summary" would silently diverge from what the Member Review view shows for the same
  data. `#reportMeta` (`formatReportMeta()`) is a
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
  `members.ts`, see below; `.warning-icon`/`.conflict-warning` are defined once,
  centrally, in `shared/styles.css`) onto any club tab whose pair has no counterpart on the other side, and appends a
  `.tab-count` badge (same convention as `members.ts`'s own tab badges) showing that club's
  `needsAction()` count (`shared/sync/delta.ts` — fuzzy suggestion, unmatched, or a path issue),
  shown only when > 0 — this tab-level badge/icon is a fast at-a-glance signal across *all* clubs,
  complementary to (not replaced by) the active club's own detailed banner. Neither the tab badge
  nor any presence badge in the table/detail renders for `presence === "both"` — only the
  Basecamp-only/EasySpeak-only exceptions are shown, since those are the only ones actionable.

  "Next Level Summary" and the second, separately-sortable "Pending review" table below it
  (`renderSummaryTable()`/`renderSummaryBody()`, shared by both — `mount()` builds two independent
  `SummaryTableState` instances, `mainTable`/`pendingTable`, each with its own `rootId`/`sort`/
  `expandedRowKey`, so sorting or expanding a row in one table never affects the other) are this
  view's only member-facing tables — there is no separate "Member List" of per-member `<details>`
  cards. Each row carries a `` `${memberKey}::${pathKey}` `` composite key (`data-row-key`, built
  from `memberKey()` and `PathReport.canonicalKey` — both from `shared/sync/delta.ts`/
  `shared/types.ts`'s `LevelSummaryRow.memberKey`/`.pathKey`, added specifically so a row survives
  being re-sorted without losing its link back to the source `MemberReport`/`PathReport`). Same
  convention as `members.ts`'s own path-review detail rows (below): a table's detail `<tr>` here is
  only emitted for whichever row matches that table's own `expandedRowKey` (`string | null`, at most
  one expanded row per table at a time) — every other row has no sibling `<tr>` at all, so
  `.data-table tbody tr:nth-child(2n)`'s plain odd/even zebra
  striping (`shared/styles.css`) lines up with the visible rows instead of counting hidden detail
  rows too. A single delegated `click` listener on each table's `tbody` (attached once per table, in
  `renderSummaryTable()`) resolves the clicked row via `closest("tr[data-row-key]")`, toggles that
  table's `expandedRowKey`, and calls `renderSummaryBody()` to re-render just that table's rows.
  Both tables' `expandedRowKey` are reset to `null` whenever the active club changes (both on a tab
  click and on a full `renderClubTabs()` rebuild), so switching clubs always starts collapsed.
  `renderRowDetail()` looks the row's member up in a module-level `activeMembers: Map<string,
  MemberReport>` (rebuilt in `renderActiveClub()` from the active club's `members[]`, keyed by
  `memberKey()`), finds the specific `PathReport` by `canonicalKey`, and renders the member's
  presence/confidence badges plus the same level-by-level diff table (`renderLevelsTable()`) both
  tables share.
- **`entrypoints/app/views/members.ts`** — the primary member-matching review workflow,
  titled "Member Review" (a `ViewModule`, reached from the popup's vertical stepper, and
  cross-linked with Club Review/Club Progress via in-app hash links, e.g. `<a href="#clubReview">`).
  Same storage-reads-only pattern as `report.ts`.
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
  `needsAction()`, specifically so `report.ts`'s club-tab badges and this view's own tab
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
- **`entrypoints/app/views/setup.ts`** — titled "Setup", the merged app's entry route (empty/
  invalid/disabled hashes all resolve here — see `entrypoints/app/router.ts`'s `resolveRoute()`
  below). A two-option "how do you want to prepare your club progress report" step — "Try with demo
  data" vs. "Use my club data" — backed by `shared/settings-store.ts`'s single `activeProfile` key
  (`"demo"`, or one of the three EasySpeak region ids): picking a card is exactly "switch profile,"
  and each profile keeps its own extracted data and review decisions (`shared/storage.ts`'s
  profile-scoping) rather than one overwriting another. Choosing "Use my club data" reveals a second
  card of region picker cards (image + radio, from `EASYSPEAK_SERVERS`); every choice — the initial
  card, then the region — writes through immediately via `setActiveProfile()` (no explicit Save
  button; the bottom "Your setup:" summary is the confirmation). Switching *into* Demo, *out of* it,
  or between two other profiles always wipes the Demo profile's own storage
  (`setActiveProfile()`'s `local.clearProfile("demo")` call) so it never carries stale data across a
  switch — a no-op re-pick of the already-active profile doesn't count as "changing profile" and
  skips the wipe. Small, low-cardinality, edited rarely, so — unlike `members.ts`/`report.ts` —
  there's no live-recompute loop; `init()` just re-reads `getActiveProfile()`/
  `getLastEasySpeakRegion()` after every `storage.onChanged` and re-renders all three roots fresh.
  Club name lookup and path name lookup used to live on this view too — they moved to their own
  "Club Review" view (see below) since they're a different concern (reconciling scraped data) from
  this view's remaining "which profile" scope; path name lookup has since moved again, to "Global
  Settings" (see below), since it's a global alias table rather than a per-scrape reconciliation
  concern.
- **`entrypoints/app/views/clubReview.ts`** — titled "Club Review". Club-name
  lookup editor, split out of `setup.ts` (a path-name lookup editor lived here
  too for a while, but has since moved to "Global Settings" — see below). This is a
  review table (every club from both sources, not just already-pinned ones), same shape/vocabulary
  as `members.ts`'s member-matching table: a status badge per club pair (Exact/Suggested/
  Linked manually/Unmatched) and Confirm/"Not this one"/Unlink actions, backed by `matchClubs()`
  (`shared/sync/conflicts.ts`, `allowFuzzy: true` — unlike `buildReport()`'s own `matchClubs()`
  call, this is the one place a fuzzy club-name suggestion is meant to be reviewed) and
  `pinClub()`/`rejectClubPair()`/`removeClubPin()` (`shared/resolution-store.ts`); the "add mapping"
  form is populated from `basecampData`/`easyspeakData`'s current club lists (excluding
  already-pinned ones).
- **`entrypoints/app/views/globalSettings.ts`** — titled
  "Global Settings", reached via the header gear icon (`shared/app-shell.ts`'s `renderAppShell()`,
  `<a href="#globalSettings">`) or the popup's gear icon (`shared/app-tab.ts`'s
  `focusOrOpenAppTab("globalSettings")`), not one of the five wizard steps in `NAV_ITEMS`
  (`active: null` + `settingsActive: true`, so no step circle renders as current — and the shell
  renders no `#stepFooter` content for this route either, since Previous/Next only make sense
  between wizard steps). Hosts cross-cutting preferences that aren't tied to a specific
  wizard step and don't fit the "which profile" scope of Setup: the Anonymize Mode toggle
  (`shared/settings-store.ts`'s `getAnonymizeMode()`/`setAnonymizeMode()`), and the path-name
  lookup table (moved here from Club Review). The path-lookup section edits `pathLookup` directly
  via `setPathAliases()`/`deletePathCanonical()` (`shared/resolution-store.ts`); adding a new
  canonical name lowercases it before saving, since `canonicalizePathName()` always lowercases the
  raw path before consulting the lookup, so a mixed-case key would simply never match. Deliberately
  **not** gated behind Anonymize Mode the way Club Review is — path names aren't personal data, and
  this is the very page that defines that toggle.
- **`shared/settings-store.ts`** — storage I/O for general extension settings, centered on a single
  `activeProfile` key (`ProfileId`: `"demo"`, or one of the three EasySpeak region ids) rather than
  two independent flat settings, so a mock-mode flag and a region choice can never drift apart, and
  `shared/storage.ts`'s profile-scoping has one unambiguous id to key off of. Deliberately **not**
  folded into `shared/resolution-store.ts`, which is scoped specifically to member/club/path
  matching decisions — a different, unrelated concern. `getActiveProfile()` returns the raw stored
  choice (`null` = nothing picked yet, Setup's required no-default state); `setActiveProfile()`
  writes it (remembering the region separately in `lastEasySpeakRegion` so switching into Demo and
  back restores it) and wipes the Demo profile's own data on any real profile change (never on a
  no-op re-pick — see `setup.ts`'s bullet above). `resolveActiveProfile()` is the
  defaulted read the scrapers need instead (`??  DEFAULT_EASYSPEAK_SERVER`, defensive against
  scraping being triggered before Setup was ever visited); `getMockMode()` (`=== "demo"`) and
  `getEasySpeakServer()` (the region, or the default if Demo/unset) are both derived from it.
  `EASYSPEAK_SERVERS` (id + display label + region name for each of the three deployments) and
  `DEFAULT_EASYSPEAK_SERVER` (`"tmclub.eu"`) are the single source of truth for both Setup's region
  cards and `getEasySpeakServer()`'s fallback. Also owns the unrelated, not-profile-scoped
  `getAnonymizeMode()`/`setAnonymizeMode()` (`anonymizeMode` key, Global Settings' toggle) — kept in
  this file rather than a separate one since it's the same "general extension settings, not matching
  decisions" category. Used from `entrypoints/app/views/setup.ts` (the profile/region pickers) and
  `entrypoints/app/views/globalSettings.ts` (Anonymize Mode) *and* `background/api/easyspeak.ts` (the
  actual URL construction that needs the chosen server happens in the background entrypoint) *and*
  `shared/stepper-info.ts` (the Setup step's own info line, and gating Club Review/Member Review
  while Anonymize Mode is on).
- **`shared/app-shell.ts`** — the shared branded header + primary nav (`renderAppShell()`),
  rendered via `innerHTML` into `entrypoints/app/main.ts`'s `#appShell` placeholder once per
  navigation (not the popup, which has its own static header and a separate `renderVerticalStepper()`
  export from this same file — see the popup's bullet above). `NAV_ITEMS` fixes both the set of
  wizard steps and their left-to-right display order: Setup, Sync Data, Club Review, Member Review,
  Club Progress — each entry's `key` is an `AppShellPage` (`"setup"|"syncData"|"clubReview"|
  "members"|"report"`, a subset of `shared/pages.ts`'s broader `AppRoute`, which also includes
  `"globalSettings"`) and `href` is now an in-page hash fragment (`"#setup"`, etc.) rather than a
  separate page's filename — plain `<a href="#members">` navigates via the browser's native
  `hashchange` event, no click handler needed. The active view passes its own key as `active` so its
  own nav link renders highlighted.
- **`shared/dom-utils.ts`** — `escapeHtml()` and `escapeAttr()`, shared by all extension pages. **Use
  `escapeAttr`, not `escapeHtml`, for any untrusted text (scraped member/path names) written into an
  HTML attribute value** (e.g. an `<option value="...">`, a `data-*` attribute) — `escapeHtml`'s
  `div.textContent` → `div.innerHTML` round-trip only entity-encodes what's needed for *text-node*
  content and does not escape a literal `"`, so it can't safely go inside a double-quoted attribute.
  Also `warningIconHtml(title)` — the shared warning-triangle SVG used by both `report.ts` and
  `members.ts` (`.warning-icon`/`.conflict-warning` are defined once, centrally, in
  `shared/styles.css`, not per-view).

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
- **`entrypoints/` uses one-directory-per-page, not flat co-located files** — `entrypoints/app.html`
  + `entrypoints/app.ts` as *siblings* does **not** work: WXT treats a same-named `.html`/`.ts`
  pair at the top level of `entrypoints/` as two conflicting entrypoints named `app` and errors
  with "Multiple entrypoints with the same name detected." The fix (already applied throughout) is
  the directory form — `entrypoints/app/index.html` + `entrypoints/app/main.ts` — where only
  `index.html` is the recognized entrypoint file and `main.ts` is just an ordinary sibling script the
  HTML references via `<script type="module" src="./main.ts">`. Every unlisted page and the popup
  follow this pattern; `entrypoints/background.ts` and `entrypoints/easyspeak-parser.content.ts` are
  flat single files (their own type — background, content-script — is unambiguous from the filename
  alone, so there's no `.html` sibling to collide with). `entrypoints/app/views/` is a different,
  unrelated convention layered inside that same entrypoint directory — a plain subfolder of ordinary
  TS modules (`report.ts`, `members.ts`, ...), none of them an `index.html`/entrypoint themselves, so
  WXT doesn't see or build them independently at all; they only exist because `entrypoints/app/main.ts`
  imports them. Don't read "one entrypoint = one directory" as "one directory = one entrypoint" —
  `views/` is proof a directory can hold plenty of non-entrypoint files alongside one.
- **Icon/image references from HTML must be absolute (`/icons/...`, `/images/...`), not
  relative** — `public/` assets aren't visible to Vite's source-relative asset resolution (they're
  copied verbatim to the output root, not bundled), so an `<img src="...">`/`<link href="...">`
  pointing at one is left completely untouched by the build, string-for-string. Since every
  unlisted page/popup entrypoint builds flat at the output root regardless of its *source* nesting
  depth (`entrypoints/app/index.html` → `app.html`, not `app/index.html`), an absolute
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
  (kept in sync with whichever store the Chrome build is actually on — see below); then two
  independent, parallel jobs, both depending only on `release` (each with its own GitHub Environment
  approval gate and its own concurrency group, so neither store's outage/rejection/approval delay
  blocks the other or the GitHub Release itself): `publish-store` downloads the just-built Chrome
  store zip and runs `wxt submit --chrome-zip ...` against the `chrome-web-store` GitHub
  Environment's secrets (`CHROME_EXTENSION_ID`/`CHROME_PUBLISHER_ID`/a service-account client email +
  private key — `CHROME_API_VERSION: v2`, since the older client-ID/secret/refresh-token v1.1 flow is
  deprecated and shuts down October 15, 2026); `publish-firefox-store` downloads the just-built
  Firefox store zip + its companion sources zip and runs `wxt submit --firefox-zip ...
  --firefox-sources-zip ... --firefox-extension-id ...` against the `firefox-addon-store` GitHub
  Environment's secrets (`FIREFOX_EXTENSION_ID`/`FIREFOX_JWT_ISSUER`/`FIREFOX_JWT_SECRET`),
  submitting to AMO's `listed` channel (public review) — `wxt submit`'s own default, left unset in
  the workflow rather than pinned to a variable since there's no current need to switch channels.
  **The extension is live on the Chrome Web Store** (see README's Installation section for the
  listing URL) — don't write or leave copy anywhere implying otherwise (a stale line to that effect
  in `release.yml`'s own GitHub Release body template is a known leftover from before this job
  existed, not a discovered-and-still-true fact; check `landing/src/data/releaseInfo.ts`'s
  `CHROME_WEB_STORE_URL` for the canonical live listing link before writing install instructions
  anywhere). **Firefox submission is automated but the extension is not yet live on
  addons.mozilla.org** — `publish-firefox-store` submits each release for Mozilla's review, but
  submission and approval are different things: AMO's listed-channel review can take anywhere from
  hours to weeks, and the very first submission additionally requires the maintainer to have manually
  created the AMO listing (registering the real `gecko.id`, replacing the placeholder in
  `wxt.config.ts`, and provisioning the three `FIREFOX_*` secrets above) before this job can even
  authenticate. Until Mozilla approves a first review, a Firefox install still requires "Load
  Temporary Add-on" (see README) — don't update README's or `landing/`'s copy to claim a live AMO
  listing exists until it verifiably does.
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
