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
// Future home for: scheduling (chrome.alarms) periodic scraping,
// centralizing EasySpeak + Basecamp storage, computing the delta once both
// sources are wired up.

importScripts("lib/basecamp-api.js", "lib/easyspeak-api.js");

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

  if (message?.type === "SCRAPE_EASYSPEAK") {
    scrapeAllEasySpeakClubs()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
