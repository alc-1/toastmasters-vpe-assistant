import { detectBrowser, type BrowserId } from "../lib/detectBrowser";

export const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/toastmasters-vpe-assistan/gafpnibfjlomcifmlpnlkioijmbdnccc";
export const EDGE_ADDON_URL =
  "https://microsoftedge.microsoft.com/addons/detail/toastmasters-vpe-assistan/llehobcogfifdnlffmbbbmdocneceoed";
export const FIREFOX_ADDON_URL = "https://addons.mozilla.org/fr/firefox/addon/toastmasters-vpe-assistant/";

export interface StoreInfo {
  id: BrowserId;
  name: string;
  url: string;
}

export const STORES: StoreInfo[] = [
  { id: "chrome", name: "Chrome", url: CHROME_WEB_STORE_URL },
  { id: "edge", name: "Edge", url: EDGE_ADDON_URL },
  { id: "firefox", name: "Firefox", url: FIREFOX_ADDON_URL },
];

export function getStoreSelection(): { main: StoreInfo; others: StoreInfo[] } {
  const current = detectBrowser();
  const main = STORES.find((s) => s.id === current) ?? STORES[0];
  return { main, others: STORES.filter((s) => s.id !== main.id) };
}

// No dedicated signup form exists yet — this points at the in-page Preview
// Program section, which hosts the real mechanism (download the latest
// release + open an issue). Update this the day a real signup destination
// exists.
export const PREVIEW_SIGNUP_URL = "#preview-program";
