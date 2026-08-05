# Toastmasters VPE Assistant

Chrome extension (Manifest V3) that helps a Toastmasters VPE (Vice President
Education) consolidate members' Pathways progress from two sources —
**Basecamp Toastmasters** (`basecamp.toastmasters.org`, via its internal JSON
API) and **EasySpeak** (no API — HTML pages that get parsed; available as
three regional deployments, see "EasySpeak regions" below) — matches members
and paths across both, and reports where the two disagree.

Written in TypeScript, built with Vite + `@crxjs/vite-plugin`.

## Installation (developer mode)

1. `npm install`
2. `npm run build` — type-checks and bundles into `dist/` (gitignored,
   regenerated on every build)
3. Open `chrome://extensions`, enable "Developer mode"
4. "Load unpacked" → select this repo's `dist/` folder (after any code
   change, rebuild and click "Reload" on the extension instead of
   re-selecting the folder)

`npm run dev` starts Vite's dev server, useful for iterating on options/popup
page markup, but the background service worker and any `chrome.scripting`
flow (EasySpeak scraping) should be verified with a real `npm run build` +
"Reload" before trusting them.

## Usage

Click the extension icon to open the popup — a vertical stepper that walks
through five steps, each opening as its own tab (`chrome.tabs.create`, not a
popup window):

1. **Setup** — choose "Try with demo data" (a bundled, fully fabricated demo
   club — no login needed, useful for a first look or a Chrome Web Store
   review) or "Use my club data", which additionally asks which EasySpeak
   region your club uses (Continental Europe / `tmclub.eu`, UK & Ireland /
   `toastmasterclub.org`, or Rest of the World / `easy-speak.org`). This
   choice is a "profile" — demo data and each region keep their own
   extracted data and review decisions, so switching between them never
   overwrites another profile's data (demo data itself is scratch space and
   is wiped every time you switch away from or into it).
2. **Sync Data** — log in normally at
   `https://apps.basecamp.toastmasters.org/` and your configured EasySpeak
   server beforehand (any tab, any time), then click "Extract Basecamp
   data" / "Extract EasySpeak data". Extracting EasySpeak data opens and
   focuses a brand-new tab on the configured server — this **closes the
   popup immediately** if you triggered it from there (Chrome tears down
   popups the instant they lose focus); use this Sync Data tab itself, or
   reopen the popup afterwards, to see the result. A summary and the raw
   extracted JSON are shown per source.
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
├── background/            # service worker only
│   ├── index.ts             # entry point
│   ├── messaging.ts         # onMessage listener, SCRAPE_*/POPUP_OPENED handling
│   ├── icon-state.ts        # toolbar icon state machine (loading/success/error)
│   └── api/
│       ├── basecamp.ts       # Basecamp scraping (fetch-based)
│       └── easyspeak.ts      # EasySpeak scraping (tab-navigation based)
├── content/
│   └── easyspeak-parser.iife.ts  # injected into the live EasySpeak tab
├── popup/                  # manifest.json's action.default_popup — just the
│   │                          branded header + vertical stepper
│   ├── index.html
│   └── index.ts
├── options/                 # five pages, each its own tab (chrome.tabs.create)
│   ├── settings.html + settings.ts       # "Setup" — demo/real profile + EasySpeak region
│   ├── sync-data.html + sync-data.ts     # "Sync Data" — extraction + raw data
│   ├── club-review.html + club-review.ts # "Club Review" — club name matching
│   ├── members.html + members.ts         # "Member Review" — member/path matching
│   └── report.html + report.ts           # "Club Progress" — the comparison report
├── status/                  # background-initiated interstitial pages
│   ├── basecamp-auth.html    # shown after a mid-scrape Basecamp login
│   ├── easyspeak-done.html   # shown once an EasySpeak scrape finishes
│   └── countdown.ts          # shared auto-close-in-5s behavior for both
└── shared/                  # no chrome.* dependency except storage.ts/
    │                          resolution-store.ts/settings-store.ts/sync-status-panel.ts
    ├── types.ts               # domain type catalog
    ├── storage.ts             # the only file allowed to call chrome.storage.* directly
    ├── settings-store.ts      # active profile (demo / EasySpeak region) storage
    ├── resolution-store.ts    # persisted club/member/path matching decisions
    ├── stepper-info.ts        # per-step info lines shared by popup + options pages
    ├── app-shell.ts           # shared header/nav + stepper rendering
    ├── sync-status-panel.ts   # shared Data Extraction card, used by Sync Data
    ├── pages.ts / send-message.ts / dom-utils.ts / styles.css
    ├── sync/
    │   ├── conflicts.ts        # club/member/path matching + override logic
    │   └── delta.ts            # buildReport orchestrator, diffing, level summary
    ├── parsers/
    │   └── easyspeak-parser.ts # pure DOM parsing, imported by content/*.iife.ts
    └── mock/
        └── mockData.ts         # fabricated demo-mode fixture data
```

## How it works

### Basecamp

Fetched directly from the privileged background service worker —
`fetch(..., { credentials: "include" })` carries the browser's existing
Basecamp session cookie automatically, since `manifest.json`'s
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

Parsing logic runs via `chrome.scripting.executeScript`, injecting a bundled
IIFE built from `content/easyspeak-parser.iife.ts` (see that file and
`background/api/easyspeak.ts` for why this specific injection shape is
required under Vite/crxjs).

### Matching & persistence

Basecamp and EasySpeak share no ID space and don't always agree on
club/member/path names (including French/German localization on EasySpeak),
so every comparison is a best-effort name-similarity match
(`shared/sync/conflicts.ts`), not a join. Once a human confirms, rejects, or
manually links a pairing (Club Review / Member Review), that decision is
persisted (`shared/resolution-store.ts`) so future re-syncs don't silently
re-derive — or un-derive — it from names alone.

## Development

- `npm run typecheck` — `tsc --noEmit` only, faster than a full build
- `npm test` — runs the Vitest suite in `tests/` against fixtures in
  `test-data/` (all synthetic — fabricated names, `example.test` emails);
  covers the pure EasySpeak HTML parsing and the matching/diff pipeline,
  not the `chrome.*`-dependent code (background scraping, storage, options
  page glue), which is manual-only
- `example/` (gitignored, not part of the repo) is a scratch folder for real
  HTML/JSON fixtures pulled from a live account while debugging the parser —
  never read by the automated test suite

See `CLAUDE.md` for a full architectural deep-dive (module-by-module
responsibilities, storage schema, build-tooling decisions).

## Known limitations

- No automatic/scheduled refresh — extraction is manual, triggered from the
  Sync Data page only
- EasySpeak "needed"/"done" counts only account for mandatory speeches and
  "Complete N elective speech(es)" groups — roles and named series
  (Successful/Better Speaker/Leadership Series, optional roles) aren't
  counted
- If the service worker is killed mid-scrape in a way that aborts the scrape
  itself, its status can stay stuck on "loading" until the browser restarts
- If Cloudflare ever requires an interactive puzzle and it isn't solved
  within 30 seconds, the EasySpeak scrape fails with a message asking you to
  switch to the tab and solve it, rather than hanging indefinitely
- If EasySpeak ends up on its login page and you don't log in within 5
  minutes, the scrape fails with a message asking you to log in and retry
