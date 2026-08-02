// src/shared/pages.ts
//
// Every extension-page relative path in one place, so chrome.runtime.getURL()
// call sites never hardcode a path string directly. These are relative to
// Vite's build root (src/ — see vite.config.ts's `root` option), which is
// also how they land under dist/: dist/options/report.html, etc. If that
// root decision is ever reversed, this is the one file to change.
//
// popup/index.html is deliberately not listed here — it's never opened via
// chrome.runtime.getURL()/chrome.tabs.create(), only via manifest.json's
// action.default_popup, which Chrome resolves itself.

export const PAGES = {
  report: "options/report.html",
  members: "options/members.html",
  settings: "options/settings.html",
  basecampAuth: "status/basecamp-auth.html",
  easyspeakDone: "status/easyspeak-done.html",
} as const;

export type PagePath = (typeof PAGES)[keyof typeof PAGES];

export function pageUrl(page: PagePath): string {
  return chrome.runtime.getURL(page);
}
