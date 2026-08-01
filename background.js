// background.js
//
// MVP: no business logic here yet. The popup communicates directly with
// the content script of the active tab.
// This file is a placeholder for future work:
//   - scheduling (chrome.alarms) periodic scraping
//   - centralizing EasySpeak + Basecamp storage
//   - computing the delta once both sources are wired up

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Toastmasters VPE Tracker] Extension installed.");
});
