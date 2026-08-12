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
import type { BasecampMember, BasecampScrape } from "../../shared/types";

const API_ROOT = "https://basecamp.toastmasters.org/api";
const DASHBOARD_ROOT = "https://apps.basecamp.toastmasters.org";
const APPROVALS_URL = `${DASHBOARD_ROOT}/dashboard/bcm-dashboard/approvals`;
const BASECAMP_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const BASECAMP_LOGIN_TIMEOUT_MESSAGE = "Basecamp Toastmasters requires you to log in. Switch to the Basecamp tab, log in, then try again.";

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
    // every options page behave identically regardless of data origin.
    await local.setForProfile(profileId, { basecampData: MOCK_BASECAMP_DATA, basecampScrapedAt: Date.now() });
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
  }

  // Persist directly rather than leaving it to the popup: if the popup
  // closes before the response comes back (e.g. the user clicks away
  // mid-scrape), the result would otherwise be lost even though the scrape
  // itself succeeded. popup/index.ts's init() reads from storage on open, so
  // this is picked up regardless of whether the popup survives.
  await local.setForProfile(profileId, { basecampData: result, basecampScrapedAt: Date.now() });

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
 * Navigates tabId to APPROVALS_URL and resolves once that exact page has
 * finished loading. An unauthenticated visit gets redirected by Basecamp
 * itself to its own auth page, then redirected back to APPROVALS_URL once
 * login succeeds — so every intermediate "complete" event whose url isn't
 * APPROVALS_URL (the auth page, any SSO hop) is simply ignored under one
 * flat timeout, and an already-authenticated visit resolves immediately.
 *
 * Listeners are registered before browser.tabs.update() is called, not
 * after — same race avoidance as navigateAndWaitForRealPage() in
 * background/api/easyspeak.ts: update()'s resolved promise only confirms
 * the navigation was requested, not that it started.
 */
function waitForLoginRedirect(tabId: number, timeoutMs = BASECAMP_LOGIN_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

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
      if (tab.url !== APPROVALS_URL) return; // auth page, SSO hop, etc. — keep waiting
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
