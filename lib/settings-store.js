// lib/settings-store.js
//
// Storage I/O for general extension settings — currently just which
// EasySpeak server (regional deployment) to scrape. Unlike
// lib/resolution-store.js (scoped specifically to member/club/path matching
// decisions), this is a different, unrelated concern, so it gets its own
// file rather than a 7th key bolted onto that one.
//
// Loaded in TWO places, unlike resolution-store.js: via <script> in
// settings.html (for the dropdown UI) AND importScripts'd into
// background.js, because the actual URL construction/scraping that needs
// the chosen server happens in lib/easyspeak-api.js, which only runs in the
// service worker.

const EASYSPEAK_SERVERS = [
  { id: "tmclub.eu", label: "Continental Europe (tmclub.eu)" },
  { id: "toastmasterclub.org", label: "UK & Ireland (toastmasterclub.org)" },
  { id: "easy-speak.org", label: "Rest of the World (easy-speak.org)" },
];

const DEFAULT_EASYSPEAK_SERVER = "tmclub.eu";

/**
 * @returns {Promise<string>} one of EASYSPEAK_SERVERS' ids — falls back to
 *   the default if unset or if the stored value isn't a known server
 *   (defensive against a future removed/renamed entry).
 */
async function getEasySpeakServer() {
  const { easyspeakServer } = await chrome.storage.local.get(["easyspeakServer"]);
  const isKnown = EASYSPEAK_SERVERS.some((s) => s.id === easyspeakServer);
  return isKnown ? easyspeakServer : DEFAULT_EASYSPEAK_SERVER;
}

/** @param {string} serverId must be one of EASYSPEAK_SERVERS' ids */
async function setEasySpeakServer(serverId) {
  if (!EASYSPEAK_SERVERS.some((s) => s.id === serverId)) {
    throw new Error(`Unknown EasySpeak server: ${serverId}`);
  }
  await chrome.storage.local.set({ easyspeakServer: serverId });
}
