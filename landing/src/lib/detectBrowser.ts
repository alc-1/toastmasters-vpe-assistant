export type BrowserId = "chrome" | "edge" | "firefox";

export function detectBrowser(): BrowserId {
  if (typeof navigator === "undefined") return "chrome";
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Edg\//.test(ua)) return "edge"; // Edge's UA also contains "Chrome/", so this must be checked first
  return "chrome"; // Chrome, and any other/unrecognized browser, default to Chrome per spec
}
