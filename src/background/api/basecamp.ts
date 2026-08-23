// src/background/api/basecamp.ts
//
// Basecamp Toastmasters scraping logic. Runs in the extension's privileged
// background context: fetch() calls to hosts covered by manifest.json's
// host_permissions carry the user's existing session cookie automatically
// via credentials: "include", bypassing normal cross-site cookie
// restrictions. Data fetching itself never needs a tab. A tab is opened only
// as a fallback when fetchJson() finds the session isn't authenticated — see
// waitForBasecampLogin() below — and once login completes, that tab is
// redirected to a confirmation page (status/basecamp-auth.html) rather than
// closed outright, so the user gets explicit confirmation that auth
// succeeded and that the scrape is continuing in the background. That page
// itself auto-closes the tab a few seconds later (cancellable) — see
// shared/countdown.ts, shared with EasySpeak's equivalent confirmation page.
//
// The active profile (shared/settings-store.ts's resolveActiveProfile()) is
// captured first, before any of the above — see the top of scrapeAllClubs().
// A "demo" profile short-circuits into mock data; any other profile writes
// its result into that same profile's storage bucket (shared/storage.ts).

import { local } from "../../shared/storage";
import { pageUrl } from "../../shared/pages";
import { resolveActiveProfile } from "../../shared/settings-store";
import { MOCK_BASECAMP_DATA } from "../../shared/mock/mockData";
import { setScrapeProgress } from "../scrape-progress";
import type { BasecampMember, BasecampOverviewMember, BasecampOverviewScrape, BasecampScrape } from "../../shared/types";

const API_ROOT = "https://basecamp.toastmasters.org/api";
const DASHBOARD_ROOT = "https://apps.basecamp.toastmasters.org";
const APPROVALS_URL = `${DASHBOARD_ROOT}/dashboard/bcm-dashboard/approvals`;
// The Azure AD B2C login page an unauthenticated visit to APPROVALS_URL
// eventually client-side-redirects to (see waitForLoginRedirect() below) —
// matched by origin, not a fixed path, since the full URL carries a
// per-attempt client_id/state/nonce query string.
const BASECAMP_LOGIN_ORIGIN = "https://login.toastmasters.org";
const BASECAMP_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const BASECAMP_LOGIN_TIMEOUT_MESSAGE = "Basecamp Toastmasters requires you to log in. Switch to the Basecamp tab, log in, then try again.";
// How long to wait, after first seeing the tab "complete" at APPROVALS_URL,
// for Basecamp's own client-side auth check to possibly redirect it away to
// BASECAMP_LOGIN_ORIGIN, before trusting that arrival as genuine. Confirmed
// against a real (unauthenticated) account that this redirect is not
// instant — the approvals page's static shell reaches the browser's
// "complete" state well before its own JS has even made the auth-check call
// that decides whether to redirect, so a short/no delay here produces a
// false-positive "logged in" read with no real page ever shown.
const APPROVALS_SETTLE_MS = 3000;

interface BasecampRole {
  is_bcm?: boolean;
  [key: string]: unknown;
}

interface BasecampClubRoleEntry {
  uuid: string;
  name: string;
  roles?: BasecampRole[];
  [key: string]: unknown;
}

interface BasecampProgressPage {
  count: number;
  results: unknown[];
  next: string | null;
}

interface BasecampOverviewPage {
  count: number;
  results: unknown[];
  next: string | null;
}

/**
 * Entry point: lists the user's "BCM" clubs, then fetches the full progress
 * for each club.
 */
export async function scrapeAllClubs(): Promise<BasecampScrape> {
  // Captured once, up front: writes below use this exact profile via
  // local.setForProfile() rather than re-resolving the ambient active one,
  // so a profile switch in another tab mid-scrape can't redirect this
  // scrape's result into the wrong profile's bucket.
  const profileId = await resolveActiveProfile();

  if (profileId === "demo") {
    // Mirrors the real path's storage write below, so popup/index.ts and
    // every options page behave identically regardless of data origin. No
    // demo member-overview data exists yet, so this is an empty map — every
    // demo path falls back to the manual "Mark as completed" flag instead.
    await local.setForProfile(profileId, { basecampData: MOCK_BASECAMP_DATA, basecampScrapedAt: Date.now(), basecampCompletedPaths: {} });
    return MOCK_BASECAMP_DATA;
  }

  const roles = (await fetchJson(`${API_ROOT}/members/roles`)) as unknown;

  if (!Array.isArray(roles)) {
    throw new Error("Unexpected response from /api/members/roles (not an array).");
  }

  const bcmClubs = (roles as BasecampClubRoleEntry[]).filter((club) => (club.roles || []).some((role) => role.is_bcm));

  if (bcmClubs.length === 0) {
    throw new Error("No club with a BCM role found for this account. Are you logged in with the right account?");
  }

  const result: BasecampScrape = {};
  const overviewResult: BasecampOverviewScrape = {};
  let clubIndex = 0;
  for (const club of bcmClubs) {
    clubIndex += 1;
    await setScrapeProgress("basecamp", {
      currentClubIndex: clubIndex,
      clubsTotal: bcmClubs.length,
      currentClubName: club.name,
      currentClubMembersFetched: 0,
      currentClubMembersTotal: null,
    });
    result[club.uuid] = {
      name: club.name,
      members: await fetchClubProgressPaginated(club.uuid, async (fetchedCount, total) => {
        await setScrapeProgress("basecamp", {
          currentClubIndex: clubIndex,
          clubsTotal: bcmClubs.length,
          currentClubName: club.name,
          currentClubMembersFetched: fetchedCount,
          currentClubMembersTotal: total,
        });
      }),
    };
    overviewResult[club.uuid] = { members: await fetchClubMemberOverviewPaginated(club.uuid) };
  }

  // Persist directly rather than leaving it to the popup: if the popup
  // closes before the response comes back (e.g. the user clicks away
  // mid-scrape), the result would otherwise be lost even though the scrape
  // itself succeeded. popup/index.ts's init() reads from storage on open, so
  // this is picked up regardless of whether the popup survives.
  await local.setForProfile(profileId, { basecampData: result, basecampScrapedAt: Date.now(), basecampCompletedPaths: overviewResult });

  return result;
}

/**
 * Always opens a brand-new blank tab for the login flow, rather than
 * reusing any already-open apps.basecamp.toastmasters.org tab — so the
 * user's own open tabs are never hijacked mid-navigation. Navigation is
 * left to waitForLoginRedirect().
 * @returns the new tab's id
 */
async function ensureBasecampDashboardTab(): Promise<number> {
  const tab = await browser.tabs.create({ active: true });
  return tab.id!;
}

/**
 * Navigates tabId to APPROVALS_URL and resolves once the tab has genuinely
 * landed there authenticated.
 *
 * Basecamp's approvals page is a client-rendered SPA, not a plain
 * server-redirected one: an unauthenticated visit's static shell reaches the
 * browser's "complete" state almost immediately — well before its own JS has
 * even made the auth-check call that decides whether to redirect — and only
 * afterward (confirmed against a real account: this can take over a second)
 * does it client-side-redirect (via window.location, not an HTTP redirect)
 * to an Azure AD B2C login page under BASECAMP_LOGIN_ORIGIN. So a "complete"
 * event at APPROVALS_URL is not by itself trustworthy; this explicitly
 * watches for that redirect instead, the same way
 * background/api/easyspeak.ts's navigateAndWaitForRealPage() explicitly
 * watches for EasySpeak's login.php redirect rather than guessing a delay:
 * once seen, switch into "awaiting login" mode with a long timeout, and
 * require every "complete" at APPROVALS_URL — including the final,
 * post-login one — to survive a settle window with no redirect to the login
 * domain before trusting it. The settle window's own expiry re-reads the
 * tab's live state directly (rather than trusting only the onUpdated-driven
 * flag) as a backstop: onUpdated firing for that redirect is not guaranteed
 * to be processed before the settle timer is, so relying on the flag alone
 * let a real redirect lose that race once already — a candidate that
 * "survived" the window only because its own redirect's event hadn't been
 * handled yet, not because no redirect happened.
 *
 * Listeners are registered before browser.tabs.update() is called, not
 * after — same race avoidance as navigateAndWaitForRealPage(): update()'s
 * resolved promise only confirms the navigation was requested, not that it
 * started.
 */
function waitForLoginRedirect(tabId: number, timeoutMs = BASECAMP_LOGIN_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let awaitingLogin = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    // Bumped on every fresh "complete at APPROVALS_URL" candidate (and on
    // every login-domain sighting) so an in-flight settle check for a
    // superseded candidate can never resolve.
    let candidateToken = 0;

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
        return; // tab gone; onRemoved will handle settling
      }
      if (tab.status !== "complete") return;
      const tabUrl = tab.url ?? "";

      if (tabUrl.startsWith(BASECAMP_LOGIN_ORIGIN)) {
        candidateToken++; // invalidate any settle check in flight for an earlier, now-superseded APPROVALS_URL candidate
        if (!awaitingLogin) {
          awaitingLogin = true;
          armTimeout(BASECAMP_LOGIN_TIMEOUT_MS, BASECAMP_LOGIN_TIMEOUT_MESSAGE);
        }
        return; // still waiting for the user to submit the login form
      }

      if (tabUrl !== APPROVALS_URL) return; // some other intermediate hop (auth callback, etc.) — keep waiting

      if (awaitingLogin) {
        awaitingLogin = false;
        armTimeout(BASECAMP_LOGIN_TIMEOUT_MS, BASECAMP_LOGIN_TIMEOUT_MESSAGE); // in case this candidate turns out stale too
      }

      const myToken = ++candidateToken;
      await new Promise((r) => setTimeout(r, APPROVALS_SETTLE_MS));
      if (settled || myToken !== candidateToken) return; // a login-domain redirect's onUpdated event was processed during the wait

      // Backstop: independently re-read the tab's actual live state rather
      // than trusting the token check alone. onUpdated firing (and us
      // processing it) is not guaranteed to happen before this timer does —
      // that race is exactly what let a real login-domain redirect lose to
      // this settle check once already: the tab had genuinely already
      // navigated to BASECAMP_LOGIN_ORIGIN, but our listener hadn't gotten
      // to it yet, so candidateToken was still unchanged when this timer
      // fired. tabs.get() always reflects the tab's current reality
      // regardless of event delivery timing.
      let recheck: Browser.tabs.Tab;
      try {
        recheck = await browser.tabs.get(tabId);
      } catch {
        return;
      }
      const recheckUrl = recheck.url ?? "";
      if (recheckUrl.startsWith(BASECAMP_LOGIN_ORIGIN)) {
        candidateToken++;
        if (!awaitingLogin) {
          awaitingLogin = true;
          armTimeout(BASECAMP_LOGIN_TIMEOUT_MS, BASECAMP_LOGIN_TIMEOUT_MESSAGE);
        }
        return;
      }
      if (recheck.status !== "complete" || recheckUrl !== APPROVALS_URL) return; // changed to something else — keep waiting for onUpdated to fire again
      finish(resolve);
    }

    function onUpdated(updatedTabId: number, changeInfo: Browser.tabs.OnUpdatedInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") checkTab();
    }

    function onRemoved(removedTabId: number) {
      if (removedTabId === tabId) {
        finish(() => reject(new Error("The Basecamp tab was closed before logging in.")));
      }
    }

    timeoutId = setTimeout(() => finish(() => reject(new Error(BASECAMP_LOGIN_TIMEOUT_MESSAGE))), timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs.update(tabId, { url: APPROVALS_URL }).catch((err) => finish(() => reject(err)));
  });
}

/**
 * Opens a brand-new Basecamp dashboard tab, waits for the user to land on
 * the approvals page (logging in first if needed), then redirects that tab
 * to the confirmation page instead of closing it, so the user sees explicit
 * confirmation that auth succeeded. On failure/timeout, the tab is left
 * open as-is (on whatever page it was on) so the user can see what went
 * wrong.
 */
async function waitForBasecampLogin(): Promise<void> {
  const tabId = await ensureBasecampDashboardTab();
  await waitForLoginRedirect(tabId);
  await browser.tabs.update(tabId, { url: pageUrl("basecamp-auth.html") });
}

/**
 * Fetches every page of progress data for a given club. onPage, if given, is
 * invoked after each page is fetched with the running fetched-so-far count
 * and the club's total row count (the API's "count" field, present on every
 * page), so a caller can report real "N out of M" progress for this club.
 */
async function fetchClubProgressPaginated(uuid: string, onPage?: (fetchedCount: number, total: number) => Promise<void>): Promise<BasecampMember[]> {
  let url: string | null = `${API_ROOT}/bcm/progress/?club=${uuid}&page=1`;
  const members: BasecampMember[] = [];
  let safety = 0;

  while (url) {
    // Safety guard: avoids an infinite loop if the API returns a "next"
    // that loops back on itself (shouldn't happen, but costs little).
    safety += 1;
    if (safety > 200) {
      throw new Error(`Too many pages for club ${uuid} (>200) — stopping as a safety measure.`);
    }

    const data = (await fetchJson(url)) as BasecampProgressPage;
    if (!Array.isArray(data.results)) {
      throw new Error(`Unexpected response for ${url} (no "results" field).`);
    }
    members.push(...(data.results as BasecampMember[]).map(stripUnneededUserFields));
    if (onPage) await onPage(members.length, data.count);
    url = data.next;
  }

  return members;
}

/**
 * Basecamp's progress records embed a "user" object carrying a photo/email
 * we have no use for and don't want sitting in browser.storage.local. Drops
 * them from a shallow copy rather than mutating the API response in place.
 */
function stripUnneededUserFields(member: BasecampMember): BasecampMember {
  if (!member.user) return member;
  const user = { ...member.user } as Record<string, unknown>;
  delete user.profile_image;
  delete user.member_photo_url;
  delete user.email;
  return { ...member, user: user as BasecampMember["user"] };
}

/**
 * Fetches every page of GET /api/bcm/member/overview/ for a given club — a
 * separate Basecamp endpoint from /api/bcm/progress/, listing every member's
 * already-COMPLETED Pathways paths by name (see BasecampOverviewMember).
 * Same pagination/auth handling as fetchClubProgressPaginated() (reuses
 * fetchJson(), follows the response's own "next" field).
 */
async function fetchClubMemberOverviewPaginated(uuid: string): Promise<BasecampOverviewMember[]> {
  let url: string | null = `${API_ROOT}/bcm/member/overview/?club=${uuid}&page_size=500&page=1`;
  const members: BasecampOverviewMember[] = [];
  let safety = 0;

  while (url) {
    safety += 1;
    if (safety > 200) {
      throw new Error(`Too many pages for club ${uuid} member overview (>200) — stopping as a safety measure.`);
    }

    const data = (await fetchJson(url)) as BasecampOverviewPage;
    if (!Array.isArray(data.results)) {
      throw new Error(`Unexpected response for ${url} (no "results" field).`);
    }
    members.push(...(data.results as BasecampOverviewMember[]).map(stripOverviewUserFields));
    url = data.next;
  }

  return members;
}

/**
 * Same privacy stripping as stripUnneededUserFields(), for the member-overview
 * endpoint's own "user" object shape.
 */
function stripOverviewUserFields(member: BasecampOverviewMember): BasecampOverviewMember {
  if (!member.user) return member;
  const user = { ...member.user } as Record<string, unknown>;
  delete user.profile_image;
  delete user.member_photo_url;
  delete user.email;
  return { ...member, user: user as BasecampOverviewMember["user"] };
}

/**
 * fetch() + JSON parsing with explicit error handling (HTTP status, etc.).
 * On a 401/403, opens a Basecamp login tab, waits for the user to log back
 * in, and retries the request exactly once. If the retried request is also
 * 401/403 (e.g. logged in with the wrong account), gives up rather than
 * looping.
 * @param retried internal; true once this call is itself the post-login
 *   retry. Callers should never pass this explicitly.
 */
async function fetchJson(url: string, retried = false): Promise<unknown> {
  const res = await fetch(url, { credentials: "include" });
  if (res.ok) {
    return res.json();
  }

  if (res.status === 401 || res.status === 403) {
    if (retried) {
      throw new Error(
        `Still not authenticated (${res.status}) on ${url} after logging in. ` +
          "Make sure you're logging into Basecamp Toastmasters with the right account."
      );
    }
    await waitForBasecampLogin();
    return fetchJson(url, true);
  }

  throw new Error(`${res.status} ${res.statusText} on ${url}`);
}
