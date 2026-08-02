# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) for a Toastmasters VPE (Vice President Education) to consolidate
member Pathways progress tracking, from two sources: **Basecamp Toastmasters** (a clean internal
JSON API) and **EasySpeak** (no API — HTML pages that must be parsed; runs as three separate
regional deployments — `tmclub.eu` (default), `toastmasterclub.org`, `easy-speak.org` — picked in
Settings, see `lib/settings-store.js` below). Both scrapers store their extraction locally; there's
no build step, no package manager, and no test suite — this is plain, unbundled JS loaded directly
by Chrome.

## Running / testing changes

There are no build/lint/test commands. To try changes:

1. Open `chrome://extensions`, enable "Developer mode".
2. "Load unpacked" → select this repo's root folder (or "Reload" the extension after edits).
3. Log in normally at `https://apps.basecamp.toastmasters.org/` and/or your configured EasySpeak
   server (`https://tmclub.eu/` by default — see Settings to change it; any tab, any time
   beforehand).
4. Click the extension icon, then "Extract Basecamp data" and/or "Extract EasySpeak data" — no
   Basecamp tab needs to stay open (unless a login is required — see Architecture). EasySpeak
   scraping always opens and focuses a brand-new tab on the configured EasySpeak server (never
   reuses an already-open one — see Architecture for why), which
   **closes the popup immediately** (Chrome tears down `action` popups as soon as they lose focus,
   and stealing tab/window focus is exactly what `ensureEasySpeakTab()` does). That tab redirects to
   a "data fetched" confirmation page and closes itself a few seconds later once scraping finishes;
   reopen the popup to see the result — see the storage note below for why this works.
5. Inspect the popup summary table and the raw JSON under "Raw data", or check the background
   service worker's console (`chrome://extensions` → this extension → "service worker" inspect
   link) for errors. Code injected into the EasySpeak tab via `chrome.scripting` logs to that
   *tab's* own DevTools console, not the service worker's.
6. Watch the toolbar icon while a scrape runs: it should animate (spinning), then land on a green
   check or red cross, then revert to the classic icon the next time you open the popup (see
   `lib/icon-state.js` in Architecture). Each source's button should be disabled only while *that*
   source is loading.

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
  (see the `lib/*-api.js` bullets below). Loading is communicated purely via the triggering button
  itself (`setButtonLoading`: disabled + relabeled to "Basecamp data loading..." / "EasySpeak data
  loading..."), **not** the status line or the summary/raw-data panels — `onScrapeClick` never
  touches `els.status`/`els.summary`/`els.rawData` while a request is in flight, so "Last extraction:
  ..." and the previous result stay visible the whole time; only a completed extraction or an error
  updates the status line. `init()` sends `{type: "POPUP_OPENED"}` before anything else, both to let
  background acknowledge any finished success/error status (see `lib/icon-state.js` below) and to
  learn whether either source is currently `"loading"`, so it can apply the same disabled/relabeled
  button state even though this popup instance didn't trigger the in-progress scrape itself (e.g.
  reopening the popup while EasySpeak is still running in its own tab). Does not touch `chrome.tabs`,
  `chrome.action`, or `chrome.storage.session` itself — all tab handling for EasySpeak lives in
  `lib/easyspeak-api.js`, all icon/status handling lives in `lib/icon-state.js`, both background-only.
- **`background.js`** — service worker. `importScripts()`s `lib/basecamp-api.js`,
  `lib/settings-store.js`, `lib/easyspeak-api.js`, and `lib/icon-state.js`. One `onMessage`
  listener: `SCRAPE_BASECAMP`/`SCRAPE_EASYSPEAK` both go
  through a shared `runScrape(source, scrapeFn, sendResponse)` helper that brackets the call with
  `setSourceStatus(source, "loading"/"success"/"error")` (see below) before `sendResponse({ok:
  true, data} / {ok: false, error})`; `POPUP_OPENED` calls `acknowledgeIconStatuses()` and replies
  with the resulting statuses. Also the intended home for future work (`chrome.alarms` scheduling,
  centralizing storage across both sources, delta computation).
- **`lib/icon-state.js`** — toolbar icon state machine, `importScripts`'d into `background.js` only
  (never loaded by `popup.html` — see its top-of-file comment: it owns a running `setInterval` for
  the spin animation, and a second copy loaded into the popup would start its own independent
  interval fighting the background's over `chrome.action.setIcon()` whenever the popup happened to
  be open while something was loading). Tracks `{basecamp, easyspeak}` status
  (`"idle"|"loading"|"success"|"error"`) in `chrome.storage.session` — session-scoped, not `.local`,
  specifically so a status can never survive a browser restart and permanently disable a button.
  `combineStatus()` reduces both sources to the single icon shown, priority **loading > error >
  success > idle**. `setSourceStatus()` is called by `runScrape()` around each scrape.
  `acknowledgeIconStatuses()` is called on `POPUP_OPENED`: reverts any `success`/`error` source back
  to `idle` (opening the popup = "seen it") but leaves `loading` alone. The loading icon is a real
  8-frame animation (`icons/icon-loading-{0..7}-{16,32,48,128}.png`, 150ms/frame); the interval only
  runs while the combined state is `loading` and is stopped the moment it isn't.
- **`lib/basecamp-api.js`** — all Basecamp scraping logic, loaded into the service worker via
  `importScripts` (classic script, not an ES module). Data fetching itself needs no tab: `fetch(...,
  { credentials: "include" })` runs directly from the privileged service worker context, and because
  `manifest.json`'s `host_permissions` covers the Basecamp hosts, the browser's existing session
  cookie is sent automatically.
  1. `GET /api/members/roles` → clubs, filtered to those where the current user has `is_bcm: true`.
  2. For each such club, paginates `GET /api/bcm/progress/?club={uuid}&page=N` following the `next`
     field until `null` (capped at 200 pages as a safety guard).
  3. Writes the result to `chrome.storage.local` itself before returning, for the same reason
     `lib/easyspeak-api.js` does (see below) — belt-and-suspenders here since Basecamp doesn't steal
     focus, but the popup can still close mid-scrape for other reasons (user clicks away, etc.), and
     losing a completed scrape's result silently is worse than one redundant write.
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
     `status/basecamp-auth.html` — a confirmation page explaining that auth succeeded and the scrape
     is continuing in the background — instead of closing it, so the user gets explicit confirmation
     of a successful login. Like EasySpeak's equivalent confirmation page below, it auto-closes the
     tab 5 seconds later via the shared `status/countdown.js` (see there), with a visible countdown
     and a "Keep this tab open" button to cancel it. On failure/timeout, the tab is left open exactly
     as-is (not redirected) so the user can see what went wrong.
- **EasySpeak is architecturally different, and deliberately so** — don't "simplify" it to match
  Basecamp's fetch-only shape. All three EasySpeak deployments (see `lib/settings-store.js` below)
  sit behind Cloudflare, which blocks plain `fetch()`/`XHR` outright regardless of which extension
  context issues it (background worker, content script, or an offscreen document all get challenged
  identically) — Cloudflare's bot detection tells a real page navigation apart from a programmatic
  fetch via the `Sec-Fetch-Mode`/`Sec-Fetch-Dest` request headers (`navigate`/`document` vs.
  `cors`/`empty`), and only an actual tab navigation produces the former. A
  background-fetch-plus-`chrome.offscreen`-DOM-parsing design was tried first and confirmed broken
  in real testing (Cloudflare's "Just a moment..." managed-challenge page came back instead of the
  real content) before landing on the current tab-navigation design — if you're tempted to move
  EasySpeak back to a tab-less fetch for symmetry with Basecamp, it will not work.
  - **`lib/easyspeak-api.js`** — orchestration, `importScripts`'d into `background.js`. Every
    domain-specific URL is derived at call time rather than hardcoded: `scrapeAllEasySpeakClubs()`
    reads the configured server via `getEasySpeakServer()` (`lib/settings-store.js`) into a `root`
    (`https://${server}`) used to build both `profile.php`/`memberchart.php` URLs;
    `navigateAndWaitForRealPage(tabId, url)` derives its own
    `loginPath` from `` `${new URL(url).origin}/login.php` `` rather than a fixed constant, so it
    works against whichever server `url` itself points at without needing a separate parameter.
    `ensureEasySpeakTab()` always creates and focuses a brand-new tab (never reuses an already-open
    one on that server, so the user's own open tabs are never hijacked mid-navigation — visible, not
    hidden, so the user can solve an interactive
    Cloudflare puzzle if the usually-automatic "managed" challenge ever escalates to one).
    `loadAndParse(tabId, url,
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
    `loadAndParse` call. Once the real page is confirmed loaded, `loadAndParse` injects `lib/easyspeak-parser.js` via
    `chrome.scripting.executeScript({ files: [...] })` and invokes the named parser function by
    name (`window[fnName]()`) in a second `executeScript` call, returning its result.
    `scrapeAllEasySpeakClubs()` ties it together: `profile.php?mode=editprofile#tab_ti` → officer
    clubs, then
    `memberchart.php?chart=10&c={clubId}` per club → members; writes the result to
    `chrome.storage.local` (`easyspeakData`/`easyspeakScrapedAt`) itself first, then redirects the tab
    to `status/easyspeak-done.html` — a confirmation page that counts down 5 seconds (visibly, via a
    `#countdown` span) and closes itself via `chrome.tabs.remove()` (not `window.close()`, which only
    works on a tab/window a script itself opened via `window.open()`), with a "Keep this tab open"
    button to cancel the close. This countdown/cancel behavior lives in `status/countdown.js`, shared
    with `status/basecamp-auth.html` (see `waitForBasecampLogin()` above) rather than duplicated per
    page — each including page just needs to define `#countdownText`/`#countdown`/`#cancelBtn`. If
    anything above throws
    (Cloudflare stuck, login timeout, parse failure), that redirect line is never reached and the tab
    is left open exactly as-is so the user can see/solve whatever went wrong. **The storage write is
    load-bearing, not redundant with popup.js's**: `ensureEasySpeakTab()` steals
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

Data shape produced by a scrape (both sources): `Record<clubId, {name: string, members: object[]}>`,
one entry in `members` per member×path row. Basecamp's member objects are raw API progress records;
EasySpeak's are `{memberId, name, path, levels: [{level, needed, done}, ...]}`. This shared
`Record<clubId, {...}>` shape is intentional — it's what the matching/delta computation below keys
off of. (Note: `README.md`'s "Next steps"/"Known MVP limitations" still describe member-matching as
unimplemented future work — that's stale; matching, persistence, and three review UIs already exist,
see below. The README hasn't been updated to match; don't trust it over this file or the code.)

`example/` holds real (anonymize before sharing) HTML fixtures for the two EasySpeak pages
(`profile.php_mode=editprofile`, `memberchart.php_chart=10&c=359`) — the source of truth for the
parsing logic in `lib/easyspeak-parser.js`. If EasySpeak's markup changes, re-capture fresh fixtures
there before touching the parser.

## Matching, persistence, and the review UIs

Basecamp and EasySpeak agree on nothing structurally (different club-id spaces, no shared member
id, differently-spelled club/path names including French/German localization on EasySpeak), so
every level of comparison is a best-effort name-similarity match, not a join — and once a human
corrects a match, that decision must survive future re-scrapes rather than being silently
re-derived (and possibly un-derived) from names again.

- **`lib/report.js`** — the matching/diff pipeline, zero `chrome.*` dependency (loaded via a plain
  `<script>` tag in `report/report.html`/`members/members.html`, and via `module.exports` for
  Node/jsdom testing — same reasoning as `lib/easyspeak-parser.js`). `buildReport(basecampData,
  easyspeakData, meta, resolution)` groups each source's member×path rows into one entry per person
  (`groupBasecampMembers`/`groupEasySpeakMembers`), matches clubs (`matchClubs`: auto-matches only
  on an *exact* normalized-name match — `clubNameScore(...) === 1` — never a partial/fuzzy
  similarity guess; there's no "suggested club" review UI anywhere to correct a wrong fuzzy guess,
  unlike members, so a club short of exact must be pinned via `clubLookup` in Settings), matches
  members within each matched club pair (`matchMembers`: exact-normalized-name short-circuit, else
  — when fuzzy matching is allowed for this call, see below — a `0.3*Jaccard +
  0.7*Levenshtein-similarity` blend against `NAME_MATCH_THRESHOLD = 0.72`), and matches paths within
  each matched member (`matchPaths`: canonicalizes via a French/German `PATH_ALIASES` table). Club
  and member matching share one greedy 1:1 assignment helper, `greedyAssign(candidates,
  preAssigned)`.
  - The optional 4th param, `resolution` (`{clubLookup, memberLinks, rejectedPairs,
    memberPathOverrides, pathAliasLookup, allowFuzzyMemberMatches}`, all default to
    empty/hardcoded/`true`), is how persisted decisions from `lib/resolution-store.js` override pure
    name-similarity matching — omitting it entirely reproduces plain automatic matching (exact +
    fuzzy), unchanged, so any Node-side caller that doesn't pass it keeps working. Precedence,
    applied *before* scoring/assignment runs: **confirmed link > rejected pair (exclusion) > exact
    name match > fuzzy suggestion (if allowed) > unmatched**. Confirmed links/club pins are injected
    as `preAssigned` entries into `greedyAssign` (claimed before any scored candidate, so a fresh
    high-scoring candidate can never displace a persisted decision); rejected pairs are filtered out
    of candidate generation entirely (so they can never resurface as a suggestion); member-scoped
    path-bind overrides are spliced out of both sides' raw path lists in `matchPaths` *before* the
    normal canonicalization loop runs, force-paired under a synthetic key, and tagged
    `overridden: true` — this is what keeps an override from touching the global path-name lookup
    other members rely on.
  - `resolution.allowFuzzyMemberMatches` (default `true`) is **not** a persisted storage key — it's
    a hardcoded per-caller behavior switch. `members/members.js` relies on the default (`true`):
    fuzzy suggestions are exactly what that view exists to surface and let a human confirm/reject.
    `report/report.js` explicitly passes `false`: the Comparison Report is meant to show only what's
    certain, so an unconfirmed fuzzy guess must never render there as if it were a fact. Setting it
    `false` simply drops fuzzy-confidence candidates from `matchMembers`'s candidate pool before
    `greedyAssign` runs — the pair falls through to the *same* leftover-handling code that already
    produces separate `basecamp-only`/`easyspeak-only` entries for anyone unassigned, so no separate
    "strict" rendering path exists anywhere downstream (CSV export, Level Summary, Member List cards
    in `report/report.js` all automatically reflect it for free). A `memberLinks`-confirmed pair
    (even one originally confirmed from a fuzzy suggestion) is unaffected by this flag either way,
    since confirmed links are seeded as `preAssigned` before candidate scoring ever runs.
  - `matchConfidence` on a member row is now `"confirmed"|"exact"|"fuzzy"|null` (added
    `"confirmed"` for a persisted `memberLinks` entry). When `matchConfidence === "confirmed"`,
    `matchSource` (`"fuzzy-confirmed"|"manual-search"|null`, threaded all the way from the
    `memberLinks` entry's own `source` field through `matchMembers`'s `preAssigned`/`pairs`) tells
    the UI *how* the link was made — confirming an algorithmic suggestion vs. manually searching for
    the right person — without changing matching precedence at all (both sources are just
    `"confirmed"` for assignment purposes). Member rows also carry `basecampName`/`easyspeakName`
    (the two raw per-source names, even when matched — needed for the Members view's side-by-side
    columns; `name` stays as the pre-existing single display name for the CSV/report view).
    `hasOrphanedPaths(member)` — both a `basecamp-only` and an `easyspeak-only` non-`nonPathway` path
    present on the same (necessarily `presence: "both"`) member — is the exact definition backing
    the Members view's "Path issues" filter; it lives here, next to the matching logic it reads, not
    duplicated in UI code.
- **`lib/resolution-store.js`** — the only place that reads/writes the 6 persisted resolution keys
  in `chrome.storage.local` (alongside the pre-existing `basecampData`/`basecampScrapedAt`/
  `easyspeakData`/`easyspeakScrapedAt`). Unlike `lib/report.js`, this file is legitimately
  `chrome.*`-dependent (pure storage I/O) so it isn't Node-testable — same as `lib/basecamp-api.js`/
  `lib/easyspeak-api.js`. Loaded via `<script>` in `report.html`/`members.html`/`settings.html`;
  never `importScripts`'d into `background.js`, since none of this needs the service worker. Every
  write is an upsert enforcing a 1:1 invariant where applicable (e.g. confirming a link first strips
  any prior record touching either id). The Members view can now unlink/unbind everything this file
  can create (see below) — there is intentionally still no "un-reject"/"un-exclude" UI action,
  mirroring how a rejected pair or a path exclusion, once recorded, has no undo either. The 6 keys:
  - `memberLinks: [{basecampUserId, easyspeakMemberId, source: "fuzzy-confirmed"|"manual-search",
    confirmedAt}]` — persisted only for human-reviewed pairs; exact matches stay dynamic
    (recomputed every sync) on purpose, so an exact match that later drifts (e.g. a name change)
    just needs one re-confirm click once it degrades to fuzzy/unmatched. `unlinkMember()` removes an
    entry outright (the Members view's "Unlink" action on a `matchConfidence === "confirmed"` row) —
    this alone does *not* stop the pair from being re-matched/re-suggested; pair it with
    `rejectMemberPair()` for that.
  - `memberRejectedPairs: [{basecampUserId, easyspeakMemberId, rejectedAt}]` — a specific candidate
    pair the user explicitly dismissed as "not this one"; excluded from candidate generation forever
    after, but doesn't stop either person from matching someone else. Also doubles as the "Unlink"
    action for an `matchConfidence === "exact"` row: an exact match is recomputed fresh every call
    (there's no stored record to delete), so the only way to actually break it — and let the user
    "resolve the matching again" via manual search — is to reject the pair so it can't just
    auto-match right back on the next refresh.
  - `clubLookup: [{basecampClubId, easyspeakClubId, basecampClubName, easyspeakClubName}]` — ID
    pins (not a name-alias table), forcing a 1:1 club match regardless of name-similarity score. The
    two `*ClubName` fields are denormalized purely for the Settings page's display.
  - `pathLookup: {"<canonical path name>": ["<alias 1>", ...]}` — the user-editable form of what
    used to be only the hardcoded `PATH_ALIASES` table; seeded from `PATH_ALIASES` the first time
    it's read (`ensurePathLookupSeeded`) so the already-verified aliases don't regress.
  - `memberPathOverrides: [{basecampUserId, easyspeakMemberId, basecampPathName,
    easyspeakPathLabel, boundAt}]` — member-scoped, not global: fixes the case where one member
    picked mismatched paths across the two systems (both sides orphaned) without touching
    `pathLookup` for everyone else. `basecampPathName`/`easyspeakPathLabel` are the raw, verbatim
    path strings for that member's rows (matched by exact string equality in `matchPaths`, not
    re-normalized). `removeMemberPathOverride()` is the "Unbind" action — the pair just goes back
    through normal canonicalization afterward (may re-match automatically, or fall back to orphaned).
  - `memberPathExclusions: [{basecampUserId, easyspeakMemberId, basecampPathName,
    easyspeakPathLabel, excludedAt}]` — the member-scoped *inverse* of an override: a path pair that
    canonicalizes together *automatically* has nothing stored to delete (same problem as an exact
    member match), so `excludePathMatch()` records an exclusion instead. `matchPaths()` checks this
    *after* canonicalization groups paths by key — if a "both"-presence pair matches an exclusion for
    that member, it's force-split back into two independently-orphaned entries (synthetic keys
    `` `${key}:basecamp` ``/`` `${key}:easyspeak` ``) instead of the merged entry canonicalization
    would otherwise produce. This is the "Force unbind" action in the Members view, letting the user
    then re-resolve the pair manually (bind to something else, or leave as orphan) instead of it
    snapping back together on every refresh.
- **`report/report.html` + `report/report.js`** — the pre-existing comparison/CSV-export page
  (reached from the popup's "Open comparison report" button as a full tab, not a popup window —
  `chrome.tabs.create({url: chrome.runtime.getURL(...)})`). Reads `basecampData`/`easyspeakData`
  straight from storage (no live scraping) plus resolution data via `loadResolutionData()`
  — loading resolution here is required, not optional, otherwise this page's CSV export and "Next
  Level Summary" would silently diverge from what the Members view shows for the same data. Renders
  club tabs, a sortable per-member-path summary table, and per-member `<details>` cards with
  level-by-level diff tables. `renderConflictWarning(report)` (`#conflictWarning`) shows a banner
  whenever any club has no counterpart at all in the other system, or any member is left
  `presence !== "both"` within a matched club pair (an unconfirmed fuzzy guess counts as unmatched
  here too, per `allowFuzzyMemberMatches: false` above) — with links to Settings (club fixes) and
  Member matching (member fixes). `renderClubTabs()` additionally prefixes a warning-sign icon
  (`warningIconHtml()`, `lib/dom-utils.js` — shared with `members.js`, see below; each page defines
  its own `.warning-icon`/`.conflict-warning` CSS) onto any club tab whose pair has no counterpart
  on the other side.
- **`members/members.html` + `members/members.js`** — the primary member-matching review workflow
  (reached from the popup's "Review Matches" button, and cross-linked with Settings/Report). Same
  storage-reads-only pattern as `report.js`. `renderClubMatchWarning()` (`#conflictWarning`, called
  from `refresh()`) mirrors `report.js`'s conflict banner but with member-matching-specific advice:
  whenever any club has no counterpart in the other system, it names the affected club(s) and points
  at Settings, since a club with nothing to match against can't be member-matched properly — best
  fixed before spending time reviewing that club's members. `renderClubTabs()` also prefixes the
  same `warningIconHtml()` icon onto those clubs' tabs, same as `report.js`. One spreadsheet-style
  table per club (club tabs reused from `report.js`'s pattern), **Basecamp name first** (Basecamp
  is the source of truth) then
  EasySpeak name / member-link status / path-bind status / actions, plus filter chips (All / To do
  / Suggested / Unmatched / Path issues / Linked manually — "To do" is the default view and means
  Suggested ∪ Unmatched ∪ Path issues) and a fixed sort (action-needed rows first, alphabetical by
  **Basecamp name** — `sortName()`, falling back to the EasySpeak name only when a member has no
  Basecamp counterpart — within each group, even inside "All"). `classifyMember()` (members.js)
  tags are **not mutually exclusive**: a member can carry more than one at once (e.g. a
  manually-confirmed link that still has an unresolved path issue shows under both "Path issues"
  and "Linked manually", so each chip stays an accurate view of everything that needs — or already
  got — a fix, rather than the two being an either/or classification). `"linked-manually"` is
  pushed whenever `matchConfidence === "confirmed"` (regardless of `matchSource`) *or* the member
  has a `memberPathOverride` bound (`hasPathOverride()`, lib/report.js, next to
  `hasOrphanedPaths()`) — the member identity may have matched automatically, but a human still had
  to manually correct which path pairs with which. There's deliberately no `"linked-automatically"`
  tag/chip: a plain automatic match with nothing to flag simply carries no tags at all, and is
  still visible via "All". The "Member link" column shows a "Linked manually" badge (reusing the
  `.badge-confirmed` styling) for any `matchConfidence === "confirmed"` row, with a tooltip
  distinguishing "confirmed from a suggested match" vs. "linked via manual search" via
  `matchSource`; the "Path bind" column shows a "Bound" badge (also `.badge-confirmed`, tooltip
  listing the bound path pair(s)) instead of a blank dash once `hasPathOverride()` is true —
  otherwise a resolved override would leave that column looking empty (`hasOrphanedPaths()` goes
  back to `false` once bound), silently losing the "this was manually corrected" signal the row's
  classification now depends on.

  Every `presence === "both"` member (except a still-`"fuzzy"` suggestion, which uses
  Confirm/"Not this one" instead) gets an **"Unlink"** action in the Actions column —
  `onUnlink()` calls `unlinkMember()` for a `"confirmed"` row, or `rejectMemberPair()` for an
  `"exact"` row (see `lib/resolution-store.js` above for why exact needs rejection, not deletion).
  `hasReviewablePaths(member)` (`presence === "both"` and at least one non-`nonPathway` path) —
  broader than `hasOrphanedPaths()` — now gates the "Review path(s)" toggle, so it's available on
  essentially every linked member, not just ones with an active orphan. The expanded
  `renderPathBindDetail()` lists three kinds of rows: **matched paths** (`presence === "both"`)
  each with "Unbind" (if `overridden`, calls `removeMemberPathOverride()`) or "Force unbind"
  (if automatic, calls `excludePathMatch()`) — one or the other, never both, since an overridden
  pair never re-enters normal canonicalization; **orphan pairs** (the pre-existing bind/leave-as-
  orphan picker, unchanged); and a fallback note when only one side has a leftover orphan with
  nothing to bind it to. Both club tabs and
  filter chips carry a count badge (`.tab-count`/`.chip-count`) computed via `needsAction()`/
  `matchesFilter()` against that club's own `members[]` — filter-chip counts are re-rendered by
  `renderActiveClub()` every time the active club or filter changes (so they always reflect the
  currently-selected club, not a global total), while a club tab's badge only appears when that
  club actually has action-needed members (a fully-resolved club shows no badge, rather than a
  "0"). A missing name cell
  becomes a `<input list> + <datalist>` type-ahead (native, not a custom dropdown — deliberate
  choice, accepted limitation: can't show rich per-candidate metadata) whose candidate pool is the
  other side's currently-unmatched members in the same club; the datalist option's visible text
  embeds the candidate's id as a `"Name (#id)"` suffix so a typed/selected value can be resolved
  back to an id without a second lookup. A suggested (fuzzy) row's "Not this one" button
  immediately persists the rejection (`rejectMemberPair`) — it doesn't wait for a replacement pick —
  then re-renders, so the pair's own row and the newly-freed-up other-side row (if it isn't the same
  UI position) both land in the normal unmatched state with the identical search component;
  "Confirm"/"Bind for this member only"/manual "Link" writes all go straight through
  `lib/resolution-store.js` with no new `background.js` message type, since this is plain
  `chrome.storage.local` I/O any extension page can do itself (unlike EasySpeak's tab-navigation,
  which genuinely needs the service worker's lifetime across popup teardown — that constraint
  doesn't apply here). **Every write triggers a full `refresh()`** (re-read storage, rebuild the
  whole report, re-render) rather than a targeted DOM patch — simplest way to stay correct given how
  much a single decision can ripple (e.g. one rejection turns one row into two), and consistent with
  the rest of this codebase's rebuild-and-reassign-`innerHTML` rendering style. A member with more
  than one simultaneous orphaned path pair renders one picker row per `basecamp-only` path (`<select>`
  over that member's `easyspeak-only` candidates) rather than assuming exactly one pair.
- **`settings/settings.html` + `settings/settings.js`** — EasySpeak server picker, club-name lookup,
  and path-name lookup editors (small, low-cardinality, edited rarely — no live-recompute loop like
  `members.js`; each section just re-reads its own storage after a write). The EasySpeak server
  section (first on the page — a foundational "which data source" choice, unlike the other two
  sections which reconcile whatever data comes back) renders a `<select>` from
  `EASYSPEAK_SERVERS` (`lib/settings-store.js`) preselected via `getEasySpeakServer()`, with an
  explicit "Save" button (matching this page's existing button-triggered-write convention rather
  than auto-saving on `change`) that calls `setEasySpeakServer()`; a "Saved." confirmation
  (`.save-status.visible`) is hidden again the moment the selection changes, so it can't linger
  next to an unsaved new choice. Changing it does **not** clear any already-extracted
  `easyspeakData`/`easyspeakScrapedAt` — it only affects the URL the *next* "Extract EasySpeak
  data" run targets, same as any ordinary stale-data situation; the help text calls this out. Club
  section's "add mapping" form is populated from `basecampData`/`easyspeakData`'s current club
  lists (excluding already-pinned ones). Path section edits `pathLookup` directly; adding a new
  canonical name lowercases it before saving, since `canonicalizePathName()` always lowercases the
  raw path before consulting the lookup, so a mixed-case key would simply never match.
- **`lib/settings-store.js`** — storage I/O for general extension settings, currently just the
  EasySpeak server choice (`easyspeakServer` key). Deliberately **not** folded into
  `lib/resolution-store.js`, which is scoped specifically to member/club/path matching decisions —
  this is a different, unrelated concern. `EASYSPEAK_SERVERS` (id + display label for each of the
  three deployments) and `DEFAULT_EASYSPEAK_SERVER` (`"tmclub.eu"`) are the single source of truth
  for both the Settings dropdown and `getEasySpeakServer()`'s fallback (used whenever the stored
  value is absent or isn't one of the three known ids — defensive against a future removed/renamed
  entry). **Loaded in two places, unlike every other `lib/*-store.js` file**: via `<script>` in
  `settings.html` (for the dropdown) *and* `importScripts`'d into `background.js` (new — the first
  settings/resolution store the service worker needs), because the actual URL construction that
  needs the chosen server happens in `lib/easyspeak-api.js`, which only runs there.
- **`lib/dom-utils.js`** — `escapeHtml()` (extracted from being duplicated in `popup.js`/`report.js`;
  now shared by all four HTML pages) and `escapeAttr()`. **Use `escapeAttr`, not `escapeHtml`, for
  any untrusted text (scraped member/path names) written into an HTML attribute value** (e.g. an
  `<option value="...">`, a `data-*` attribute) — `escapeHtml`'s `div.textContent` →
  `div.innerHTML` round-trip only entity-encodes what's needed for *text-node* content and does not
  escape a literal `"`, so it can't safely go inside a double-quoted attribute. Also
  `warningIconHtml(title)` — the shared warning-triangle SVG used by both `report.js` and
  `members.js` (each page still owns its own `.warning-icon`/`.conflict-warning` CSS).

When extending this codebase with a new data source, don't assume Basecamp's tab-less fetch pattern
is the default template — check first whether the target site can be reached with a plain
privileged `fetch()` (works if there's no bot protection distinguishing fetch from navigation) or
needs EasySpeak's tab-navigation + `chrome.scripting` approach (required for anything behind
Cloudflare or similar).

## Conventions

- UI strings, comments, and README are in English; keep new user-facing text and comments
  consistent with that.
- No transpilation/bundling — code must run as-is in a Manifest V3 service worker / content script
  / popup context (plain `<script src>`, no ES module imports across files, no npm dependencies).
- `icons/*.png` were generated once via a scratchpad-only Node script (hand-written SVGs rasterized
  with `sharp`) — that tool isn't part of the repo and never will be; if the icon designs need to
  change, regenerate the PNGs the same throwaway way rather than adding an image-processing
  dependency to the project itself.
