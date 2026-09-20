// src/background/api/easyspeak.ts
//
// EasySpeak scraping logic, against whichever regional server is configured
// via the active profile (shared/settings-store.ts's resolveActiveProfile();
// tmclub.eu by default — see EASYSPEAK_SERVERS there for the other two).
// Unlike Basecamp,
// EasySpeak has no JSON API AND sits behind Cloudflare, which blocks
// programmatic fetch()/XHR requests outright (Cloudflare distinguishes a
// real page navigation from a fetch() via the Sec-Fetch-Mode/Sec-Fetch-Dest
// request headers, regardless of which extension context issues the fetch)
// — so unlike Basecamp, this cannot be done tab-lessly. Instead, this module
// navigates a real, brand-new tab on the configured EasySpeak server
// (always opened fresh rather than reusing any already-open tab, so the
// user's own open tabs are never hijacked mid-navigation; visible, not
// hidden, so the user can solve an interactive Cloudflare challenge if one
// ever appears) and injects entrypoints/easyspeak-parser.content.ts into it
// via browser.scripting to extract data from its live DOM. Once every club
// has been scraped, that same tab is redirected to a confirmation page
// (easyspeak-done.html) that auto-closes a few seconds later.
//
// Because ensureEasySpeakTab() below deliberately steals tab/window focus
// (browser.tabs.update/browser.windows.update), the extension popup — which
// Chrome/Firefox both close as soon as it loses focus — will not survive
// long enough to receive the response and persist it itself the way
// popup/index.ts normally would. So this module writes the result to
// browser.storage.local directly, making it the source of truth regardless
// of whether the popup is still around when scraping finishes;
// popup/index.ts's init() already reads from storage on open and will pick
// it up next time it's opened.
//
// The active profile (shared/settings-store.ts's resolveActiveProfile()) is
// captured first, before ensureEasySpeakTab() — see the top of
// scrapeAllEasySpeakClubs(). A "demo" profile short-circuits into mock data
// and no tab is ever created/focused; any other profile *is* the EasySpeak
// server id to scrape, and the result is written into that same profile's
// storage bucket (shared/storage.ts) regardless of whether the user switches
// the active profile elsewhere while this (multi-minute) scrape is running.

import { local } from "../../shared/storage";
import { pageUrl } from "../../shared/pages";
import { resolveActiveProfile } from "../../shared/settings-store";
import { MOCK_EASYSPEAK_DATA } from "../../shared/mock/mockData";
import type { EasySpeakScrape, MemberchartParseResult, ProfileParseResult } from "../../shared/types";

// entrypoints/easyspeak-parser.content.ts is a runtime-registered content
// script (registration: "runtime" — never auto-injected by manifest match
// rules), which WXT bundles as a plain IIFE at this stable, predictable
// output path — no content hash, so it's safe to hardcode here rather than
// resolve via an import. See that file's doc comment for why the parser
// globals are guaranteed to exist synchronously by the time the first
// executeScript() call below resolves.
const PARSER_FILE = "/content-scripts/easyspeak-parser.js" as const;

// CHALLENGE_TITLE/RESTRICTED_ACCESS_TEXT are NOT this extension's own UI copy
// — they're literal English text matched against EasySpeak's/Cloudflare's own
// page content (see navigateAndWaitForRealPage() below), so they must stay
// exactly as-is regardless of this extension's own locale.
const CHALLENGE_TITLE = "Just a moment...";
const PAGE_LOAD_TIMEOUT_MS = 30000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const RESTRICTED_ACCESS_TEXT = "restricted to full members";
const CHALLENGE_TIMEOUT_MESSAGE = i18n.t("background.easyspeak.error.challengeTimeout.error");
const LOGIN_TIMEOUT_MESSAGE = i18n.t("background.easyspeak.error.loginTimeout.error");

/**
 * Entry point: discovers the clubs where the user is a club officer from
 * their profile page's "Connected to these Toastmaster clubs" section, then
 * navigates through and parses each such club's Pathways member chart.
 */
export async function scrapeAllEasySpeakClubs(): Promise<EasySpeakScrape> {
  // Captured once, up front: writes below use this exact profile via
  // local.setForProfile() rather than re-resolving the ambient active one —
  // see the file header comment for why.
  const profileId = await resolveActiveProfile();

  if (profileId === "demo") {
    // Mirrors the real path's storage write below, so popup/index.ts and
    // every options page behave identically regardless of data origin.
    await local.setForProfile(profileId, { easyspeakData: MOCK_EASYSPEAK_DATA, easyspeakScrapedAt: Date.now() });
    return MOCK_EASYSPEAK_DATA;
  }

  // Not "demo", so the profile id *is* the EasySpeak server id.
  const root = `https://${profileId}`;
  const tabId = await ensureEasySpeakTab();

  const { clubs } = (await loadAndParse(tabId, `${root}/profile.php?mode=editprofile#tab_ti`, "parseProfileLinks")) as ProfileParseResult;

  if (clubs.length === 0) {
    throw new Error(i18n.t("background.easyspeak.error.noOfficerClub.error"));
  }

  const result: EasySpeakScrape = {};
  for (const club of clubs) {
    const { members } = (await loadAndParse(tabId, `${root}/memberchart.php?chart=10&c=${club.id}`, "parseMemberchart")) as MemberchartParseResult;
    result[club.id] = { name: club.name, members };
  }

  // Persist directly — see the note at the top of this file for why this
  // can't be left to the popup to do. Written before the confirmation-page
  // redirect below so the data is saved even if that navigation fails.
  await local.setForProfile(profileId, { easyspeakData: result, easyspeakScrapedAt: Date.now() });

  // On any error above (Cloudflare stuck, login timeout, parse failure),
  // this line is never reached, and the tab is left open as-is so the user
  // can see/solve whatever went wrong.
  await browser.tabs.update(tabId, { url: pageUrl("easyspeak-done.html") });

  return result;
}

/**
 * Always opens a brand-new blank tab, rather than reusing any already-open
 * tab on the configured EasySpeak server.
 * @returns the new tab's id
 */
async function ensureEasySpeakTab(): Promise<number> {
  const tab = await browser.tabs.create({ active: true });
  return tab.id!;
}

type ParseFnName = "parseProfileLinks" | "parseMemberchart";

/**
 * Navigates the given tab to url, waits for that exact real (non-
 * Cloudflare-challenge) page to finish loading, then injects and runs the
 * named parser function from entrypoints/easyspeak-parser.content.ts against
 * that page's DOM.
 */
async function loadAndParse(tabId: number, url: string, parseFnName: ParseFnName): Promise<ProfileParseResult | MemberchartParseResult> {
  await navigateAndWaitForRealPage(tabId, url);

  await browser.scripting.executeScript({
    target: { tabId },
    files: [PARSER_FILE],
  });

  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: (fnName: string) => {
      const fn = (globalThis as unknown as Record<string, () => unknown>)[fnName];
      if (typeof fn !== "function") {
        // Runs inside the target tab's own isolated JS realm (executeScript's
        // func: callback), not the background context — no #i18n auto-import
        // reaches here, so this stays a plain literal rather than i18n.t().
        // A near-impossible-to-hit internal assertion, not a user-actionable
        // message, so that's an acceptable scope limitation.
        throw new Error(`Parser ${fnName} was not injected into the page.`);
      }
      return fn();
    },
    args: [parseFnName],
  });

  return result as ProfileParseResult | MemberchartParseResult;
}

/**
 * Navigates the tab to url and resolves once THAT exact page has finished
 * loading for real (not Cloudflare's "Just a moment..." challenge
 * interstitial, and not EasySpeak's login page). Rejects if the tab is
 * closed or nothing resolves within the timeout.
 *
 * Listeners are registered before browser.tabs.update() is called, and
 * resolution only happens on an actual browser.tabs.onUpdated "complete"
 * event whose tab.url matches the target url — browser.tabs.update()'s
 * returned promise only confirms the navigation was requested, not that it
 * started or finished, so checking the tab's current state immediately
 * after calling it would race against the still-loaded *previous* page
 * (this previously caused every club after the first to silently re-parse
 * whatever page loaded before it).
 *
 * If the session isn't authenticated, EasySpeak signals it in one of two
 * different ways depending on the page, and this function handles both the
 * same way — wait (with a much longer timeout, since a human has to type
 * credentials) for the user to log in, then retry the original url:
 * - Some pages (e.g. profile.php) redirect the request to login.php instead
 *   of serving it. Once detected, this function stops comparing tab.url
 *   against the original target (it'll never match) and waits for the tab
 *   to navigate away from login.php. EasySpeak's own post-login redirect
 *   then lands on a URL that's close to but not exactly the one we asked
 *   for (e.g. missing our #tab_ti fragment, carrying a new &sid= param), so
 *   it still won't match the exact-url check either — this function
 *   re-requests the original url itself once login is detected.
 * - Other pages (e.g. memberchart.php) serve a "restricted to full members"
 *   message inline, at the same url, without redirecting anywhere. Since
 *   there's no URL change to wait out in that case, this function instead
 *   navigates the tab to login.php itself, then waits for the user to log
 *   in and navigate away from it exactly as in the redirect case above.
 */
function navigateAndWaitForRealPage(tabId: number, url: string, timeoutMs = PAGE_LOAD_TIMEOUT_MS): Promise<void> {
  // Derived from url rather than a fixed constant, so this works against
  // whichever EasySpeak server url itself points at.
  const loginPath = `${new URL(url).origin}/login.php`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let awaitingLogin = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function armTimeout(ms: number, message: string) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => finish(() => reject(new Error(message))), ms);
    }

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      action();
    }

    async function checkTab() {
      if (settled) return;
      let tab: Browser.tabs.Tab;
      try {
        tab = await browser.tabs.get(tabId);
      } catch {
        return;
      }
      if (tab.status !== "complete") return;
      const tabUrl = tab.url ?? "";

      if (tabUrl.startsWith(loginPath)) {
        if (!awaitingLogin) {
          awaitingLogin = true;
          armTimeout(LOGIN_TIMEOUT_MS, LOGIN_TIMEOUT_MESSAGE);
        }
        // Still waiting for the user to submit the login form.
        return;
      }

      if (awaitingLogin) {
        // Just navigated away from login.php: login succeeded. Re-request
        // the originally-requested url now that the session is
        // authenticated — the post-login redirect landed somewhere close
        // but not identical to it (see function doc comment).
        awaitingLogin = false;
        armTimeout(PAGE_LOAD_TIMEOUT_MS, CHALLENGE_TIMEOUT_MESSAGE);
        browser.tabs.update(tabId, { url }).catch((err) => finish(() => reject(err)));
        return;
      }

      // Only accept a "complete" state for the page we actually navigated
      // to — ignore stray updates for the previous page.
      if (tabUrl !== url) return;

      let title: string, bodyText: string;
      try {
        const [{ result }] = await browser.scripting.executeScript({
          target: { tabId },
          func: () => ({ title: document.title, bodyText: document.body.innerText || "" }),
        });
        ({ title, bodyText } = result as { title: string; bodyText: string });
      } catch {
        return;
      }
      if (title === CHALLENGE_TITLE) return;

      if (bodyText.toLowerCase().includes(RESTRICTED_ACCESS_TEXT)) {
        // Some EasySpeak pages (e.g. memberchart.php) don't redirect to
        // login.php when unauthenticated the way profile.php does — they
        // render this restricted-access message inline, at the same url,
        // instead. Treat it the same as a login redirect: send the tab to
        // the login page ourselves (there's no URL change to wait out here,
        // unlike the login.php-redirect case) and wait for the user to log
        // in, then retry the original url once they navigate away from it.
        awaitingLogin = true;
        armTimeout(LOGIN_TIMEOUT_MS, LOGIN_TIMEOUT_MESSAGE);
        browser.tabs.update(tabId, { url: loginPath }).catch((err) => finish(() => reject(err)));
        return;
      }

      finish(resolve);
    }

    function onUpdated(updatedTabId: number, changeInfo: Browser.tabs.OnUpdatedInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        checkTab();
      }
    }

    function onRemoved(removedTabId: number) {
      if (removedTabId === tabId) {
        finish(() => reject(new Error(i18n.t("background.easyspeak.error.tabClosed.error"))));
      }
    }

    armTimeout(timeoutMs, CHALLENGE_TIMEOUT_MESSAGE);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs.update(tabId, { url }).catch((err) => finish(() => reject(err)));
  });
}
