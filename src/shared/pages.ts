// src/shared/pages.ts
//
// Every extension-page path in one place, so browser.runtime.getURL()
// call sites never hardcode a path string directly. These are WXT's stable,
// flat output filenames for each unlisted-page entrypoint (see
// src/entrypoints/) — e.g. entrypoints/app/index.html builds to app.html at
// the extension root, regardless of build mode/browser.
//
// popup/index.html is deliberately not listed here — it's never opened via
// browser.runtime.getURL()/browser.tabs.create(), only via manifest.json's
// action.default_popup, which the browser resolves itself.

export const PAGES = {
  app: "app.html",
  basecampAuth: "basecamp-auth.html",
  easyspeakDone: "easyspeak-done.html",
  welcome: "welcome.html",
  whatsNew: "whats-new.html",
} as const;

export type PagePath = (typeof PAGES)[keyof typeof PAGES];

export function pageUrl(page: PagePath): string {
  return browser.runtime.getURL(`/${page}`);
}

// entrypoints/background.ts's onInstalled("update") handler opens this with
// the browser's own previousVersion event data — a plain string concat after
// pageUrl(), never re-passed through getURL(), so PublicPath's stricter
// exact-match typing (vs. the looser `${HtmlPublicPath}${string}` overload
// used only inside getURL itself) never comes into play here.
export function whatsNewUrl(previousVersion?: string): string {
  return pageUrl(PAGES.whatsNew) + (previousVersion ? `?from=${encodeURIComponent(previousVersion)}` : "");
}

// The 6 in-app views formerly served as separate pages (report.html,
// members.html, settings.html, sync-data.html, club-review.html,
// global-settings.html) — now client-side routes inside entrypoints/app/,
// addressed by hash fragment (see entrypoints/app/router.ts).
export type AppRoute = "report" | "members" | "setup" | "syncData" | "clubReview" | "globalSettings";

export function appRouteUrl(route: AppRoute): string {
  return `${pageUrl(PAGES.app)}#${route}`;
}
