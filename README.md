# Toastmasters VPE Tracker — MVP

Chrome extension (Manifest V3) that extracts, for the clubs the logged-in
user belongs to, the Pathways progress of all members from two sources:
**Basecamp Toastmasters** (`basecamp.toastmasters.org`, via its internal
JSON API) and **EasySpeak** (`tmclub.eu`, by parsing its HTML pages).

Scope of this MVP: **extraction and local storage only**. No matching
members between the two sources yet, no delta report yet — these are the
next steps.

## Installation (developer mode)

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `toastmasters-vpe-tracker/` folder

## Usage

1. Log in normally at `https://apps.basecamp.toastmasters.org/` and/or
   `https://tmclub.eu/` (in any tab, at any point before extracting)
2. Click the extension icon, from any tab
3. Click "Extract Basecamp data" and/or "Extract EasySpeak data"
4. The popup shows a summary (clubs + entry count) and the raw JSON data
   for each source, collapsible under "Raw data"

Extracting EasySpeak data briefly takes over a `tmclub.eu` tab (reusing one
if you already have one open, otherwise opening and focusing a new one) —
see "How it works" below for why. Bringing that tab into focus **closes the
popup immediately** (Chrome always closes the extension popup as soon as it
loses focus), so you won't see the button relabel or the result right away
— just reopen the popup once the EasySpeak tab has finished (or closed
itself) to see the results.

While either source is loading, its button is disabled and relabeled
("Basecamp data loading..." / "EasySpeak data loading...") — the other
source's button stays enabled and labeled normally, since the two can run
independently — and the toolbar icon spins. The status line and any
previously extracted data stay exactly as they were the whole time (e.g.
"Last extraction: ..." keeps showing), even while a new extraction is in
progress or if it fails — nothing gets cleared or overwritten by the
loading state itself; only a completed extraction or an error updates the
status line. Once a source finishes, the toolbar icon shows a green check
(success) or red cross (error) until you next open the popup, which
acknowledges it and reverts the icon to normal (a still-loading source is
left alone even if you open the popup).

Data is stored in `chrome.storage.local` under `basecampData` /
`basecampScrapedAt` and `easyspeakData` / `easyspeakScrapedAt` (each an
object indexed by club id, plus a timestamp of the last extraction). It
persists between popup openings but stays local to this browser. Both
scrapers write this themselves as soon as they finish, rather than relying
on the popup to still be open to save the result — necessary for EasySpeak
given the point above.

## Project structure

```
toastmasters-vpe-tracker/
├── manifest.json                  # Manifest V3, permissions + host_permissions + icons
├── background.js                  # Service worker: handles scrape requests from the popup
├── icons/                         # Toolbar icon PNGs: idle, loading (8 animation frames), success, error
├── lib/
│   ├── basecamp-api.js            # Basecamp scraping logic (JSON API), imported into background.js
│   ├── easyspeak-api.js           # EasySpeak orchestration: tab navigation + chrome.scripting
│   ├── easyspeak-parser.js        # Pure DOM parsing, injected into the EasySpeak tab
│   └── icon-state.js              # Toolbar icon state machine (background-only)
└── popup/
    ├── popup.html                 # MVP UI
    └── popup.js                   # Triggers scraping, displays the result
```

## How it works

### Basecamp

- The popup sends a `{type: "SCRAPE_BASECAMP"}` runtime message to the
  background service worker.
- The service worker (`background.js` + `lib/basecamp-api.js`) handles it:
  1. `GET /api/members/roles` → list of clubs, filtered on `is_bcm: true`
     roles.
  2. For each club, full pagination of
     `GET /api/bcm/progress/?club={uuid}&page=N` following the `next`
     field until `null`.

### EasySpeak

EasySpeak has no JSON API, and `tmclub.eu` is behind Cloudflare, which
blocks plain `fetch()`/`XHR` requests outright — Cloudflare tells a real
page navigation apart from a programmatic fetch via the
`Sec-Fetch-Mode`/`Sec-Fetch-Dest` request headers, regardless of which
extension context (background worker, content script, offscreen document)
issues the fetch. So unlike Basecamp, this can't be done tab-lessly: the
popup's `{type: "SCRAPE_EASYSPEAK"}` message triggers a flow in
`lib/easyspeak-api.js` that drives a real tab:
1. Reuse a `tmclub.eu` tab if one is already open (focusing it), otherwise
   open and focus a new one — visible, so that if Cloudflare ever escalates
   to an interactive puzzle, you can solve it.
2. Navigate that tab to `/profile.php?mode=editprofile`, wait for it to
   finish loading for real (past Cloudflare's "Just a moment..." challenge
   interstitial, if one appears), then inject `lib/easyspeak-parser.js`
   into the tab and run `parseProfileLinks()` against its live DOM to get
   the user's clubs from the "Links:" block
   (`view_meeting.php?c={clubId}&show=next` anchors).
3. For each club, navigate the same tab to
   `/memberchart.php?chart=10&c={clubId}` (`chart=10` is a fixed view id;
   the page isn't paginated), wait for it to load, and run
   `parseMemberchart()` to get the member×path roster: member id/name,
   path name, and a needed/done speech count for each Pathways level (1-5).
4. Per level, mandatory speech icons count 1:1 (done if ticked); only
   "Complete N elective speech(es)" option groups are counted beyond that
   (contributing N to "needed", capped ticks to "done") — roles and other
   elective groups (Successful/Better Speaker/Leadership series, optional
   roles) are ignored for now.
5. Close the tab automatically if the scraper opened it itself and
   everything succeeded; leave it open (and leave a pre-existing tab
   exactly where it ended up) otherwise, so you can see what happened.
6. Save the result straight to `chrome.storage.local` before returning —
   since step 1 steals tab/window focus, the popup that started the scrape
   is always closed by the time this finishes, so it can't be relied on to
   save the result itself.

### Authentication

Basecamp: purely cookie-based. Because `manifest.json` declares
`host_permissions` for the Basecamp hosts, `fetch()` calls made from the
background service worker are privileged — they carry the user's existing
session cookie automatically via `credentials: "include"`, without needing
any Basecamp tab open. No manual cookie extraction is needed.

EasySpeak: also cookie-based, but via a real tab navigation rather than a
privileged fetch (see above) — the browser handles the session cookie the
normal way a real page load would.

### Toolbar icon status

`background.js` + `lib/icon-state.js` track each source's status
(`idle`/`loading`/`success`/`error`) in `chrome.storage.session` (cleared on
browser restart, so a stuck status can't survive one) and keep the toolbar
icon in sync — combined across both sources with priority **loading >
error > success > idle**, since there's only one icon for two independent
scrapers. The loading icon is a genuine animation: 8 rotated frames cycled
via `chrome.action.setIcon()` on a `setInterval`, entirely inside the
background service worker (never the popup — see `lib/icon-state.js`'s
top-of-file comment for why running it there too would cause two
independent intervals to fight over the icon). Opening the popup sends a
`POPUP_OPENED` message that reverts any finished (`success`/`error`) source
back to `idle`, leaving a still-`loading` source untouched.

## Known MVP limitations

- No handling of the case where a member follows multiple paths in parallel
  beyond what each source already returns (member×path rows)
- No automatic / scheduled refresh (manual trigger via the buttons only)
- If the service worker is killed mid-scrape in a way that aborts the
  scrape itself, its status can stay stuck on `loading` (button
  permanently disabled) until the browser restarts — the scrape's own
  response would be lost the same way regardless of the icon feature
- The popup doesn't persist an error message across a close/reopen (e.g.
  EasySpeak failing while the popup is closed) — only the toolbar icon
  (red cross until next opened) surfaces that a failure happened
- EasySpeak "needed"/"done" counts only account for mandatory speeches and
  "Complete N elective speech(es)" groups — roles and named series
  (Successful/Better Speaker/Leadership Series, optional roles) aren't
  counted
- `host_permissions` for EasySpeak is scoped to `tmclub.eu`, this user's
  specific EasySpeak Europe instance
- If Cloudflare ever requires an interactive puzzle and it isn't solved
  within 30 seconds, the EasySpeak scrape fails with a message asking you
  to switch to the tab and solve it, rather than hanging indefinitely
- If multiple `tmclub.eu` tabs are open, the EasySpeak scraper reuses
  whichever one `chrome.tabs.query` returns first
- No matching of members between Basecamp and EasySpeak yet: delta
  computation isn't possible yet

## Next steps

1. Define the logic for matching members between the two systems (no shared
   ID a priori — likely matching by normalized name)
2. Build the delta computation and consolidated report in the popup or a
   dedicated page
