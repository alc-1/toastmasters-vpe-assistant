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
const LOGIN_PATH = `${EASYSPEAK_ROOT}/login.php`;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const RESTRICTED_ACCESS_TEXT = "restricted to full members";
const CHALLENGE_TIMEOUT_MESSAGE =
  "EasySpeak showed a security check (Cloudflare) that didn't resolve automatically. " +
  "Switch to the EasySpeak tab, solve the check if one is shown, then try again.";
const LOGIN_TIMEOUT_MESSAGE = "EasySpeak requires you to log in. Switch to the EasySpeak tab, log in, then try again.";

/**
 * Entry point: discovers the clubs where the user is a club officer from
 * their profile page's "Connected to these Toastmaster clubs" section, then
 * navigates through and parses each such club's Pathways member chart.
 * @returns {Promise<Record<string, {name: string, members: object[]}>>}
 */
async function scrapeAllEasySpeakClubs() {
  const { tabId, createdByUs } = await ensureEasySpeakTab();

  const { clubs } = await loadAndParse(
    tabId,
    `${EASYSPEAK_ROOT}/profile.php?mode=editprofile#tab_ti`,
    "parseProfileLinks"
  );

  if (clubs.length === 0) {
    throw new Error(
      "No officer club found in the EasySpeak profile page's \"Connected to these Toastmaster clubs\" " +
        "section. Are you logged in with the right account, and are you a club officer somewhere?"
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
 * interstitial, and not EasySpeak's login page). Rejects if the tab is
 * closed or nothing resolves within the timeout.
 *
 * Listeners are registered before chrome.tabs.update() is called, and
 * resolution only happens on an actual chrome.tabs.onUpdated "complete"
 * event whose tab.url matches the target url — chrome.tabs.update()'s
 * returned promise only confirms the navigation was requested, not that it
 * started or finished, so checking the tab's current state immediately
 * after calling it would race against the still-loaded *previous* page
 * (this previously caused every club after the first to silently re-parse
 * whatever page loaded before it).
 *
 * If the session isn't authenticated, EasySpeak signals it in one of two
 * different ways depending on the page, and this function handles both the
 * same way — wait (with a much longer timeout, since a human has to type
 * credentials) for the user to log in, then retry the original url:
 * - Some pages (e.g. profile.php) redirect the request to login.php instead
 *   of serving it. Once detected, this function stops comparing tab.url
 *   against the original target (it'll never match) and waits for the tab
 *   to navigate away from login.php. EasySpeak's own post-login redirect
 *   then lands on a URL that's close to but not exactly the one we asked
 *   for (e.g. missing our #tab_ti fragment, carrying a new &sid= param), so
 *   it still won't match the exact-url check either — this function
 *   re-requests the original url itself once login is detected.
 * - Other pages (e.g. memberchart.php) serve a "restricted to full members"
 *   message inline, at the same url, without redirecting anywhere. Since
 *   there's no URL change to wait out in that case, this function instead
 *   navigates the tab to login.php itself, then waits for the user to log
 *   in and navigate away from it exactly as in the redirect case above.
 * @param {number} tabId
 * @param {string} url
 */
function navigateAndWaitForRealPage(tabId, url, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let awaitingLogin = false;
    let timeoutId;

    function armTimeout(ms, message) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => finish(() => reject(new Error(message))), ms);
    }

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
      if (tab.status !== "complete") return;

      if (tab.url.startsWith(LOGIN_PATH)) {
        if (!awaitingLogin) {
          awaitingLogin = true;
          armTimeout(LOGIN_TIMEOUT_MS, LOGIN_TIMEOUT_MESSAGE);
        }
        // Still waiting for the user to submit the login form.
        return;
      }

      if (awaitingLogin) {
        // Just navigated away from login.php: login succeeded. Re-request
        // the originally-requested url now that the session is
        // authenticated — the post-login redirect landed somewhere close
        // but not identical to it (see function doc comment).
        awaitingLogin = false;
        armTimeout(PAGE_LOAD_TIMEOUT_MS, CHALLENGE_TIMEOUT_MESSAGE);
        chrome.tabs.update(tabId, { url }).catch((err) => finish(() => reject(err)));
        return;
      }

      // Only accept a "complete" state for the page we actually navigated
      // to — ignore stray updates for the previous page.
      if (tab.url !== url) return;

      let title, bodyText;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({ title: document.title, bodyText: document.body.innerText || "" }),
        });
        ({ title, bodyText } = result);
      } catch {
        return;
      }
      if (title === CHALLENGE_TITLE) return;

      if (bodyText.toLowerCase().includes(RESTRICTED_ACCESS_TEXT)) {
        // Some EasySpeak pages (e.g. memberchart.php) don't redirect to
        // login.php when unauthenticated the way profile.php does — they
        // render this restricted-access message inline, at the same url,
        // instead. Treat it the same as a login redirect: send the tab to
        // the login page ourselves (there's no URL change to wait out here,
        // unlike the login.php-redirect case) and wait for the user to log
        // in, then retry the original url once they navigate away from it.
        awaitingLogin = true;
        armTimeout(LOGIN_TIMEOUT_MS, LOGIN_TIMEOUT_MESSAGE);
        chrome.tabs.update(tabId, { url: LOGIN_PATH }).catch((err) => finish(() => reject(err)));
        return;
      }

      finish(resolve);
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

    armTimeout(timeoutMs, CHALLENGE_TIMEOUT_MESSAGE);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.update(tabId, { url }).catch((err) => finish(() => reject(err)));
  });
}
