// background.js
//
// Service worker. Handles scraping requests from the popup by calling the
// Basecamp API directly (see lib/basecamp-api.js) — no content script or
// open Basecamp tab is needed, since host_permissions authorizes fetch()
// from this privileged context to carry the user's session cookie.
//
// Future home for: scheduling (chrome.alarms) periodic scraping,
// centralizing EasySpeak + Basecamp storage, computing the delta once both
// sources are wired up.

importScripts("lib/basecamp-api.js");

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Toastmasters VPE Tracker] Extension installed.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCRAPE_BASECAMP") {
    scrapeAllClubs()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    // Tells Chrome we'll respond asynchronously.
    return true;
  }
});
