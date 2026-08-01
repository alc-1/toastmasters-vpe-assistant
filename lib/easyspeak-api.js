// lib/easyspeak-api.js
//
// EasySpeak (tmclub.eu) scraping logic. Loaded into the background service
// worker via importScripts(). Unlike Basecamp, EasySpeak has no JSON API
// AND sits behind Cloudflare, which blocks programmatic fetch()/XHR
// requests outright (Cloudflare distinguishes a real page navigation from
// a fetch() via the Sec-Fetch-Mode/Sec-Fetch-Dest request headers,
// regardless of which extension context issues the fetch) — so unlike
// Basecamp, this cannot be done tab-lessly. Instead, this module navigates
// a real tmclub.eu tab (reusing one if already open, otherwise opening and
// focusing a new one so the user can solve an interactive Cloudflare
// challenge if one ever appears) and injects lib/easyspeak-parser.js into
// it via chrome.scripting to extract data from its live DOM.
//
// Because ensureEasySpeakTab() below deliberately steals tab/window focus
// (chrome.tabs.update/chrome.windows.update), the extension popup — which
// Chrome always closes as soon as it loses focus — will not survive long
// enough to receive the response and persist it itself the way popup.js
// normally would. So this module writes the result to chrome.storage.local
// directly, making it the source of truth regardless of whether the popup
// is still around when scraping finishes; popup.js's init() already reads
// from storage on open and will pick it up next time it's opened.

const EASYSPEAK_ROOT = "https://tmclub.eu";
const EASYSPEAK_URL_PATTERN = "https://tmclub.eu/*";
const PARSER_FILE = "lib/easyspeak-parser.js";
const CHALLENGE_TITLE = "Just a moment...";
const PAGE_LOAD_TIMEOUT_MS = 30000;

/**
 * Entry point: discovers the user's clubs from their profile page, then
 * navigates through and parses each club's Pathways member chart.
 * @returns {Promise<Record<string, {name: string, members: object[]}>>}
 */
async function scrapeAllEasySpeakClubs() {
  const { tabId, createdByUs } = await ensureEasySpeakTab();

  const { clubs } = await loadAndParse(
    tabId,
    `${EASYSPEAK_ROOT}/profile.php?mode=editprofile`,
    "parseProfileLinks"
  );

  if (clubs.length === 0) {
    throw new Error(
      "No club found in the EasySpeak profile page's Links section. Are you logged in with the right account?"
    );
  }

  const result = {};
  for (const club of clubs) {
    const { members } = await loadAndParse(
      tabId,
      `${EASYSPEAK_ROOT}/memberchart.php?chart=10&c=${club.id}`,
      "parseMemberchart"
    );
    result[club.id] = { name: club.name, members };
  }

  // Only clean up a tab we created ourselves — leave a pre-existing tab
  // as-is (just navigated to the last scraped page), and leave a
  // self-created tab open on failure so the user can see/solve whatever
  // went wrong (a stuck Cloudflare challenge, most likely).
  if (createdByUs) {
    await chrome.tabs.remove(tabId);
  }

  // Persist directly — see the note at the top of this file for why this
  // can't be left to the popup to do.
  await chrome.storage.local.set({ easyspeakData: result, easyspeakScrapedAt: Date.now() });

  return result;
}

/**
 * Finds an existing tmclub.eu tab to reuse (focusing it), or creates and
 * focuses a new one if none is open.
 * @returns {Promise<{tabId: number, createdByUs: boolean}>}
 */
async function ensureEasySpeakTab() {
  const [existing] = await chrome.tabs.query({ url: EASYSPEAK_URL_PATTERN });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return { tabId: existing.id, createdByUs: false };
  }

  const tab = await chrome.tabs.create({ active: true });
  return { tabId: tab.id, createdByUs: true };
}

/**
 * Navigates the given tab to url, waits for that exact real (non-
 * Cloudflare-challenge) page to finish loading, then injects and runs the
 * named parser function from lib/easyspeak-parser.js against that page's
 * DOM.
 * @param {number} tabId
 * @param {string} url
 * @param {"parseProfileLinks"|"parseMemberchart"} parseFnName
 */
async function loadAndParse(tabId, url, parseFnName) {
  await navigateAndWaitForRealPage(tabId, url);

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [PARSER_FILE],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (fnName) => window[fnName](),
    args: [parseFnName],
  });

  return result;
}

/**
 * Navigates the tab to url and resolves once THAT exact page has finished
 * loading for real (not Cloudflare's "Just a moment..." challenge
 * interstitial). Rejects if the tab is closed or nothing resolves within
 * the timeout.
 *
 * Listeners are registered before chrome.tabs.update() is called, and
 * resolution only happens on an actual chrome.tabs.onUpdated "complete"
 * event whose tab.url matches the target url — chrome.tabs.update()'s
 * returned promise only confirms the navigation was requested, not that it
 * started or finished, so checking the tab's current state immediately
 * after calling it would race against the still-loaded *previous* page
 * (this previously caused every club after the first to silently re-parse
 * whatever page loaded before it).
 * @param {number} tabId
 * @param {string} url
 */
function navigateAndWaitForRealPage(tabId, url, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "EasySpeak showed a security check (Cloudflare) that didn't resolve automatically. " +
              "Switch to the EasySpeak tab, solve the check if one is shown, then try again."
          )
        )
      );
    }, timeoutMs);

    function finish(action) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      action();
    }

    async function checkTab() {
      if (settled) return;
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return;
      }
      // Only accept a "complete" state for the page we actually navigated
      // to — ignore stray updates for the previous page.
      if (tab.status !== "complete" || tab.url !== url) return;

      let title;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.title,
        });
        title = result;
      } catch {
        return;
      }
      if (title !== CHALLENGE_TITLE) {
        finish(resolve);
      }
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        checkTab();
      }
    }

    function onRemoved(removedTabId) {
      if (removedTabId === tabId) {
        finish(() => reject(new Error("The EasySpeak tab was closed before the page finished loading.")));
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.update(tabId, { url }).catch((err) => finish(() => reject(err)));
  });
}
