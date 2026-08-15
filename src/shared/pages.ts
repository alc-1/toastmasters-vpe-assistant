// src/shared/pages.ts
//
// Every extension-page path in one place, so browser.runtime.getURL()
// call sites never hardcode a path string directly. These are WXT's stable,
// flat output filenames for each unlisted-page entrypoint (see
// src/entrypoints/) — e.g. entrypoints/report/index.html builds to
// report.html at the extension root, regardless of build mode/browser.
//
// popup/index.html is deliberately not listed here — it's never opened via
// browser.runtime.getURL()/browser.tabs.create(), only via manifest.json's
// action.default_popup, which the browser resolves itself.

export const PAGES = {
  report: "report.html",
  members: "members.html",
  settings: "settings.html",
  syncData: "sync-data.html",
  clubReview: "club-review.html",
  globalSettings: "global-settings.html",
  basecampAuth: "basecamp-auth.html",
  easyspeakDone: "easyspeak-done.html",
  welcome: "welcome.html",
} as const;

export type PagePath = (typeof PAGES)[keyof typeof PAGES];

export function pageUrl(page: PagePath): string {
  return browser.runtime.getURL(`/${page}`);
}
