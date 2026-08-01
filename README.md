# Toastmasters VPE Tracker — MVP (Basecamp only)

Chrome extension (Manifest V3) that extracts, for the clubs where the logged-in
user is a "BCM" officer, the Pathways progress of all members via the internal
API of **Basecamp Toastmasters** (`basecamp.toastmasters.org`).

Scope of this MVP: **extraction and local storage only**. No comparison with
EasySpeak yet, no delta report yet — these are the next steps.

## Installation (developer mode)

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `toastmasters-vpe-tracker/` folder

## Usage

1. Log in normally at `https://apps.basecamp.toastmasters.org/`
2. Stay on that tab, click the extension icon
3. Click "Extract Basecamp data"
4. The popup shows a summary (clubs + entry count) and the raw JSON data,
   collapsible under "Raw data"

Data is stored in `chrome.storage.local` under the keys `basecampData`
(object indexed by club UUID) and `basecampScrapedAt` (timestamp of the last
extraction). It persists between popup openings but stays local to this
browser.

## Project structure

```
toastmasters-vpe-tracker/
├── manifest.json                  # Manifest V3, host_permissions + content script
├── background.js                  # Service worker (empty for now, ready for what's next)
├── content-scripts/
│   └── basecamp.js                # All the Basecamp scraping logic
└── popup/
    ├── popup.html                 # MVP UI
    └── popup.js                   # Triggers scraping, displays the result
```

## How it works

- The content script is automatically injected on every
  `apps.basecamp.toastmasters.org` page.
- It listens for `{type: "SCRAPE_BASECAMP"}` messages sent by the popup.
- On trigger:
  1. `GET /api/members/roles` → list of clubs, filtered on `is_bcm: true`
     roles.
  2. For each club, full pagination of
     `GET /api/bcm/progress/?club={uuid}&page=N` following the `next`
     field until `null`.
- Authentication is purely cookie-based: since the fetch runs from the page's
  own context (same origin), the session cookie is sent automatically with
  `credentials: "include"`. No manual cookie extraction is needed.

## Known MVP limitations

- No handling of the case where a member follows multiple paths in parallel
  beyond what the API already returns (to verify with real multi-path data)
- No automatic / scheduled refresh (manual trigger via the button only)
- No icons defined in the manifest (Chrome will show a default icon —
  cosmetic, to add later)
- No EasySpeak data yet: delta computation isn't possible yet

## Next steps

1. Reproduce the same approach (DevTools → endpoints → content script) for
   EasySpeak
2. Define the logic for matching members between the two systems (no shared
   ID a priori — likely matching by normalized name)
3. Build the delta computation and consolidated report in the popup or a
   dedicated page
