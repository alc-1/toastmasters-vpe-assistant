// src/background/index.ts
//
// Service worker entry point. Handles scraping requests from the popup by
// calling the Basecamp and EasySpeak APIs (see background/api/basecamp.ts
// and background/api/easyspeak.ts). Basecamp needs no open tab at all:
// host_permissions authorizes fetch() from this privileged context to carry
// the user's session cookie. EasySpeak (whichever regional server is
// configured — see shared/settings-store.ts) sits behind Cloudflare, which
// blocks programmatic fetch()/XHR outright, so background/api/easyspeak.ts
// instead navigates a real tab and extracts data from its live DOM via
// chrome.scripting (see src/content/easyspeak-parser.iife.ts).
//
// Also owns the toolbar icon's loading/success/error state (see
// icon-state.ts) — kept here rather than in the popup because a scrape
// (especially EasySpeak, which closes the popup as soon as it starts) must
// keep updating the icon whether or not the popup that triggered it is
// still open.
//
// Future home for: scheduling (chrome.alarms) periodic scraping,
// centralizing EasySpeak + Basecamp storage, computing the delta once both
// sources are wired up.

import { registerMessageHandlers } from "./messaging";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Toastmasters VPE Assistant] Extension installed.");
});

registerMessageHandlers();
