# Toastmasters VPE Assistant

Cross-browser extension (Manifest V3 on Chrome/Chromium, Manifest V2 on
Firefox) that helps a Toastmasters VPE (Vice President Education) consolidate
members' Pathways progress from two sources — **Basecamp Toastmasters**
(`basecamp.toastmasters.org`, via its internal JSON API) and **EasySpeak**
(no API — HTML pages that get parsed; available as three regional
deployments, see "EasySpeak regions" below) — matches members and paths
across both, reports where the two disagree, and can export everything to an
Excel workbook.

Written in TypeScript, built with [WXT](https://wxt.dev).

Project site (install instructions, feedback link):
https://alc-1.github.io/toastmasters-vpe-assistant/

## Installation

**Chrome / Chromium / Edge / Brave / etc.**: install from the
[Chrome Web Store](https://chromewebstore.google.com/detail/toastmasters-vpe-assistan/gafpnibfjlomcifmlpnlkioijmbdnccc).

**Firefox**, or if you want the latest **preview** build ahead of a Chrome
Web Store release: grab the relevant zip from the
[latest release](https://github.com/alc-1/toastmasters-vpe-assistant/releases/latest)
— that page's own instructions walk through unzipping and loading it for
each browser. Firefox doesn't support permanently loading an unsigned
extension, so a Firefox preview install is temporary (cleared on browser
restart) until this extension is approved and listed on addons.mozilla.org —
each release is now submitted there automatically for review, but Mozilla's
review process takes time, so a temporary install is still what you'll need
for now.

## Feedback / bugs

Found a bug or have an idea? Please
[open an issue](https://github.com/alc-1/toastmasters-vpe-assistant/issues/new/choose).

## Development setup

1. `npm install` (runs `wxt prepare` automatically via `postinstall`)
2. `npm run build` — type-checks and bundles the **store** target for
   **Chrome** into `.output/store/chrome-mv3/`. Other combinations:
   `npm run build:firefox` (`.output/store/firefox-mv2/`),
   `npm run build:preview` / `build:preview:firefox` (adds an
   update-checker + "(Preview)" name suffix, for testers ahead of a store
   release). Pick `npm run build` if in doubt.
3. **Chrome**: open `chrome://extensions`, enable "Developer mode", "Load
   unpacked" → select `.output/store/chrome-mv3/`.
   **Firefox**: go to `about:debugging#/runtime/this-firefox` → "Load
   Temporary Add-on…" → select the `manifest.json` inside
   `.output/store/firefox-mv2/`. This is temporary (cleared on Firefox
   restart), since a local build isn't Mozilla-signed.
4. After any code change, rebuild and click "Reload" on the extension
   instead of re-selecting the folder.

`npm run dev` / `npm run dev:firefox` start WXT's dev server — useful for
iterating on popup/options page markup, but the background service
worker/background script and any `browser.scripting` flow (EasySpeak
scraping especially) should always get a real build + reload before you
trust them.

## Usage

Click the extension icon to open the popup — a vertical stepper that walks
through five steps, each opening as its own tab (not a popup window):

1. **Setup** — choose "Try with demo data" (a bundled, fully fabricated demo
   club — no login needed, useful for a first look or a store review) or
   "Use my club data", which additionally asks which EasySpeak region your
   club uses (Continental Europe / `tmclub.eu`, UK & Ireland /
   `toastmasterclub.org`, or Rest of the World / `easy-speak.org`). This
   choice is a "profile" — demo data and each region keep their own
   extracted data and review decisions, so switching between them never
   overwrites another profile's data (demo data itself is scratch space and
   is wiped every time you switch away from or into it).
2. **Sync Data** — log in normally at
   `https://apps.basecamp.toastmasters.org/` and your configured EasySpeak
   server beforehand (any tab, any time), then click "Import Basecamp Data"
   / "Import EasySpeak Data". Importing EasySpeak data opens and focuses a
   brand-new tab on the configured server — this **closes the popup
   immediately** if you triggered it from there (both browsers tear down an
   `action` popup the instant it loses focus); use this Sync Data tab
   itself, or reopen the popup afterwards, to see the result. A summary and
   the raw extracted JSON are shown per source. This page also has an
   **Export** card once data is loaded: pick **All data**, **Basecamp**, or
   **EasySpeak**, then "Export to Excel" downloads a `.xlsx` workbook scoped
   to that choice (aggregated + match history + both raw sources for "All
   data"; just the one source's raw data + a metadata sheet otherwise).
3. **Club Review** — once both sources are extracted, review how clubs on
   each side were matched by name (exact / suggested / unmatched) and pin
   any pairing that didn't match automatically.
4. **Member Review** — a spreadsheet-style, per-club table for confirming
   fuzzy name-match suggestions, manually linking members that didn't match
   at all, and resolving members whose Pathways path didn't match across the
   two systems.
5. **Club Progress** — the final report: per-club KPIs and a sortable "Next
   Level Summary" table (expandable per-member-path detail) showing who's
   ready to advance and where Basecamp and EasySpeak disagree.

Steps are gated in order (each locks until its prerequisite is satisfied —
e.g. Member Review needs both sources extracted and every club matched) but,
once visited, stay directly reachable from the stepper without redoing
earlier steps.

## Project structure

```
src/
├── entrypoints/             # WXT entrypoints — file-based routing, one
│   │                          HTML page per directory
│   ├── background.ts          # MV3 service worker / MV2 background script
│   ├── popup/                  # toolbar popup — vertical stepper only
│   ├── settings/                # "Setup" — demo/real profile + EasySpeak region
│   ├── sync-data/                 # "Sync Data" — extraction + raw data + Export to Excel
│   ├── club-review/                # "Club Review" — club name matching
│   ├── members/                     # "Member Review" — member/path matching
│   ├── report/                       # "Club Progress" — the comparison report
│   ├── basecamp-auth/, easyspeak-done/  # background-initiated interstitial pages
│   ├── welcome/                       # first-run onboarding tab
│   └── easyspeak-parser.content.ts    # injected into the live EasySpeak tab
├── background/               # plain supporting modules for entrypoints/background.ts
│   ├── messaging.ts             # onMessage listener, SCRAPE_*/POPUP_OPENED handling
│   ├── icon-state.ts            # toolbar icon state machine (loading/success/error)
│   └── api/
│       ├── basecamp.ts           # Basecamp scraping (fetch-based)
│       └── easyspeak.ts          # EasySpeak scraping (tab-navigation based)
└── shared/                   # no browser.* dependency except storage.ts/
    │                           resolution-store.ts/settings-store.ts/sync-status-panel.ts
    ├── types.ts                 # domain type catalog
    ├── storage.ts               # the only file allowed to call browser.storage.* directly
    ├── settings-store.ts        # active profile (demo / EasySpeak region) storage
    ├── resolution-store.ts      # persisted club/member/path matching decisions
    ├── app-shell.ts             # shared header/nav + stepper rendering
    ├── sync-status-panel.ts     # shared Data Extraction card, used by popup + Sync Data
    ├── sync/
    │   ├── conflicts.ts           # club/member/path matching + override logic
    │   └── delta.ts               # buildReport orchestrator, diffing, level summary
    ├── export/                  # "Export to Excel" — pure row-shaping, workbook
    │   │                          assembly, and the storage/browser.*-dependent orchestrator
    │   └── ...
    ├── parsers/
    │   └── easyspeak-parser.ts  # pure DOM parsing, imported by easyspeak-parser.content.ts
    └── mock/
        └── mockData.ts           # fabricated demo-mode fixture data

e2e/                          # Playwright end-to-end tests (drive a real built extension)
tests/                        # Vitest unit tests (pure logic) + test-data/ fixtures
```

## How it works

### Basecamp

Fetched directly from the privileged background service worker/script —
`fetch(..., { credentials: "include" })` carries the browser's existing
Basecamp session cookie automatically, since the manifest's
`host_permissions` covers the Basecamp hosts. No tab needs to be open unless
the session isn't authenticated, in which case a tab is opened to trigger
Basecamp's own login flow and the request is retried once login completes.

1. `GET /api/members/roles` → clubs, filtered to those the logged-in user is
   an officer (`is_bcm: true`) of.
2. For each club, `GET /api/bcm/progress/?club={uuid}&page=N` is paginated
   via the `next` field until exhausted.

### EasySpeak

EasySpeak has no API, and every regional deployment sits behind Cloudflare,
which blocks plain `fetch()`/`XHR` outright (bot detection tells a real page
navigation apart from a programmatic fetch via request headers, regardless
of which extension context issues it) — so unlike Basecamp, this can't be
done tab-lessly. A dedicated tab is opened and focused (visible, in case an
interactive Cloudflare challenge ever needs solving by hand):

1. Navigate to `profile.php?mode=editprofile#tab_ti`, wait for the real page
   (past any Cloudflare interstitial), then parse the "Connected to these
   Toastmaster clubs" table for clubs where the user is an officer.
2. For each such club, navigate to `memberchart.php?chart=10&c={clubId}` and
   parse the member×path roster: name, path, and a needed/done speech count
   per Pathways level (1–5).
3. If the session isn't authenticated (or expires mid-scrape), the scraper
   detects it and waits up to 5 minutes for a manual login in that same tab,
   then automatically resumes.

Parsing logic runs via `browser.scripting.executeScript`, injecting a
bundled content script built from `entrypoints/easyspeak-parser.content.ts`
(see that file and `background/api/easyspeak.ts` for why this specific
injection shape is required).

### Matching & persistence

Basecamp and EasySpeak share no ID space and don't always agree on
club/member/path names (including French/German localization on EasySpeak),
so every comparison is a best-effort name-similarity match
(`shared/sync/conflicts.ts`), not a join. Once a human confirms, rejects, or
manually links a pairing (Club Review / Member Review), that decision is
persisted (`shared/resolution-store.ts`) so future re-syncs don't silently
re-derive — or un-derive — it from names alone.

### Export to Excel

The Sync Data page's Export card turns whatever's in storage into a `.xlsx`
workbook (via [ExcelJS](https://github.com/exceljs/exceljs), client-side,
no server involved) — scoped to **All data** (Aggregated + Matches &
Resolutions + both raw sources + Metadata), **Basecamp** (raw Basecamp data
+ Metadata), or **EasySpeak** (raw EasySpeak data + Metadata). Each option
is only selectable once its underlying source is actually loaded.

## Development

- `npm run typecheck` — `tsc --noEmit` only, faster than a full build
- `npm test` — runs the Vitest suite in `tests/` against fixtures in
  `test-data/` (all synthetic — fabricated names, `example.test` emails);
  covers pure logic only (EasySpeak HTML parsing, the matching/diff
  pipeline, Excel export row-shaping, DOM helpers) — not the
  `browser.*`-dependent code (background scraping, storage, options page
  glue), which is manual-only
- `npm run test:e2e` — Playwright end-to-end tests in `e2e/`, driving a real
  **built** extension in a real browser (`npm run build` first, and once
  ever, `npx playwright install chromium`). Everything is seeded through the
  "demo" profile, so no real Basecamp/EasySpeak login or network call is
  ever involved. Covers the Sync Data → Export flow and a render/
  console-error smoke check on Report/Members/Club Review.
- `example/` (gitignored, not part of the repo) is a scratch folder for real
  HTML/JSON fixtures pulled from a live account while debugging the parser —
  never read by the automated test suite

See `CLAUDE.md` for a full architectural deep-dive (module-by-module
responsibilities, storage schema, build-tooling decisions).

`.github/workflows/ci.yml` runs the Vitest suite, a Chrome store build, the
Playwright e2e suite against that build (Chromium binary cached between
runs), then the remaining store/preview × Chrome/Firefox build combinations
— on every push/PR to `main`. Releases are cut manually via
`.github/workflows/release.yml` (Actions tab → "Release" → "Run workflow"),
which bumps the version, tags it, builds + zips all 4 combinations (plus a
Firefox sources zip for AMO), attaches them to a new GitHub Release, and
publishes the Chrome build to the Chrome Web Store and the Firefox build to
addons.mozilla.org for review.

## Known limitations

- No automatic/scheduled refresh — extraction is manual, triggered from the
  Sync Data page only
- EasySpeak "needed"/"done" counts only account for mandatory speeches and
  "Complete N elective speech(es)" groups — roles and named series
  (Successful/Better Speaker/Leadership Series, optional roles) aren't
  counted
- Firefox isn't approved/listed on addons.mozilla.org yet (each release is
  submitted there automatically, but Mozilla review takes time), so a
  Firefox install is still a temporary add-on cleared on every browser
  restart (see Installation above)
- If the background service worker/script is killed mid-scrape in a way
  that aborts the scrape itself, its status can stay stuck on "loading"
  until the browser restarts
- If Cloudflare ever requires an interactive puzzle and it isn't solved
  within 30 seconds, the EasySpeak scrape fails with a message asking you to
  switch to the tab and solve it, rather than hanging indefinitely
- If EasySpeak ends up on its login page and you don't log in within 5
  minutes, the scrape fails with a message asking you to log in and retry

## License

MIT — see [LICENSE](LICENSE).
