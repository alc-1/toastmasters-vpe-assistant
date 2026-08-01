// background.js
//
// Service worker. Handles scraping requests from the popup by calling the
// Basecamp and EasySpeak APIs (see lib/basecamp-api.js and
// lib/easyspeak-api.js). Basecamp needs no open tab at all: host_permissions
// authorizes fetch() from this privileged context to carry the user's
// session cookie. EasySpeak (tmclub.eu) sits behind Cloudflare, which
// blocks programmatic fetch()/XHR outright, so lib/easyspeak-api.js
// instead navigates a real tab and extracts data from its live DOM via
// chrome.scripting (see lib/easyspeak-parser.js).
//
// Also owns the toolbar icon's loading/success/error state (see
// lib/icon-state.js) — kept here rather than in the popup because a scrape
// (especially EasySpeak, which closes the popup as soon as it starts) must
// keep updating the icon whether or not the popup that triggered it is
// still open.
//
// Future home for: scheduling (chrome.alarms) periodic scraping,
// centralizing EasySpeak + Basecamp storage, computing the delta once both
// sources are wired up.

importScripts("lib/basecamp-api.js", "lib/easyspeak-api.js", "lib/icon-state.js");

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Toastmasters VPE Tracker] Extension installed.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCRAPE_BASECAMP") {
    runScrape("basecamp", scrapeAllClubs, sendResponse);
    // Tells Chrome we'll respond asynchronously.
    return true;
  }

  if (message?.type === "SCRAPE_EASYSPEAK") {
    runScrape("easyspeak", scrapeAllEasySpeakClubs, sendResponse);
    return true;
  }

  if (message?.type === "POPUP_OPENED") {
    acknowledgeIconStatuses().then(sendResponse);
    return true;
  }
});

/**
 * Runs a scrape function, tracking its loading/success/error status (and
 * therefore the toolbar icon) throughout, regardless of whether the popup
 * that sent the triggering message is still around to receive sendResponse.
 * @param {"basecamp"|"easyspeak"} source
 * @param {() => Promise<object>} scrapeFn
 * @param {(response: {ok: boolean, data?: object, error?: string}) => void} sendResponse
 */
async function runScrape(source, scrapeFn, sendResponse) {
  await setSourceStatus(source, "loading");
  try {
    const data = await scrapeFn();
    await setSourceStatus(source, "success");
    sendResponse({ ok: true, data });
  } catch (err) {
    await setSourceStatus(source, "error");
    sendResponse({ ok: false, error: err.message });
  }
}
