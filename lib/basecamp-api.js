// lib/basecamp-api.js
//
// Basecamp Toastmasters scraping logic. Loaded into the background service
// worker via importScripts(). Runs in the extension's privileged context:
// fetch() calls to hosts covered by manifest.json's host_permissions carry
// the user's existing session cookie automatically via
// credentials: "include", bypassing normal cross-site cookie restrictions.
// Data fetching itself never needs a tab. A tab is opened only as a
// fallback when fetchJson() finds the session isn't authenticated — see
// waitForBasecampLogin() below — and once login completes, that tab is
// redirected to a confirmation page (status/basecamp-auth.html) rather than
// closed outright, so the user gets explicit confirmation that auth
// succeeded and that the scrape is continuing in the background. That page
// itself auto-closes the tab a few seconds later (cancellable) — see
// status/countdown.js, shared with EasySpeak's equivalent confirmation page.

const API_ROOT = "https://basecamp.toastmasters.org/api";
const DASHBOARD_ROOT = "https://apps.basecamp.toastmasters.org";
const APPROVALS_URL = `${DASHBOARD_ROOT}/dashboard/bcm-dashboard/approvals`;
const BASECAMP_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const BASECAMP_LOGIN_TIMEOUT_MESSAGE =
  "Basecamp Toastmasters requires you to log in. Switch to the Basecamp tab, log in, then try again.";

/**
 * Entry point: lists the user's "BCM" clubs, then fetches the full
 * progress for each club.
 * @returns {Promise<Record<string, {name: string, members: object[]}>>}
 */
async function scrapeAllClubs() {
  const roles = await fetchJson(`${API_ROOT}/members/roles`);

  if (!Array.isArray(roles)) {
    throw new Error("Unexpected response from /api/members/roles (not an array).");
  }

  const bcmClubs = roles.filter((club) =>
    (club.roles || []).some((role) => role.is_bcm)
  );

  if (bcmClubs.length === 0) {
    throw new Error(
      "No club with a BCM role found for this account. Are you logged in with the right account?"
    );
  }

  const result = {};
  for (const club of bcmClubs) {
    result[club.uuid] = {
      name: club.name,
      members: await fetchClubProgressPaginated(club.uuid),
    };
  }

  // Persist directly rather than leaving it to the popup: if the popup
  // closes before the response comes back (e.g. the user clicks away
  // mid-scrape), the result would otherwise be lost even though the scrape
  // itself succeeded. popup.js's init() reads from storage on open, so this
  // is picked up regardless of whether the popup survives.
  await chrome.storage.local.set({ basecampData: result, basecampScrapedAt: Date.now() });

  return result;
}

/**
 * Always opens a brand-new blank tab for the login flow, rather than
 * reusing any already-open apps.basecamp.toastmasters.org tab — so the
 * user's own open tabs are never hijacked mid-navigation. Navigation is
 * left to waitForLoginRedirect().
 * @returns {Promise<number>} the new tab's id
 */
async function ensureBasecampDashboardTab() {
  const tab = await chrome.tabs.create({ active: true });
  return tab.id;
}

/**
 * Navigates tabId to APPROVALS_URL and resolves once that exact page has
 * finished loading. An unauthenticated visit gets redirected by Basecamp
 * itself to its own auth page, then redirected back to APPROVALS_URL once
 * login succeeds — so every intermediate "complete" event whose url isn't
 * APPROVALS_URL (the auth page, any SSO hop) is simply ignored under one
 * flat timeout, and an already-authenticated visit resolves immediately.
 *
 * Listeners are registered before chrome.tabs.update() is called, not
 * after — same race avoidance as navigateAndWaitForRealPage() in
 * lib/easyspeak-api.js: update()'s resolved promise only confirms the
 * navigation was requested, not that it started.
 * @param {number} tabId
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
function waitForLoginRedirect(tabId, timeoutMs = BASECAMP_LOGIN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;

    function finish(action) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      action();
    }

    async function checkTab() {
      if (settled) return;
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return; // tab gone; onRemoved will handle settling
      }
      if (tab.status !== "complete") return;
      if (tab.url !== APPROVALS_URL) return; // auth page, SSO hop, etc. — keep waiting
      finish(resolve);
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") checkTab();
    }

    function onRemoved(removedTabId) {
      if (removedTabId === tabId) {
        finish(() => reject(new Error("The Basecamp tab was closed before logging in.")));
      }
    }

    timeoutId = setTimeout(() => finish(() => reject(new Error(BASECAMP_LOGIN_TIMEOUT_MESSAGE))), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.update(tabId, { url: APPROVALS_URL }).catch((err) => finish(() => reject(err)));
  });
}

/**
 * Opens a brand-new Basecamp dashboard tab, waits for the user to land on
 * the approvals page (logging in first if needed), then redirects that tab
 * to the confirmation page instead of closing it, so the user sees explicit
 * confirmation that auth succeeded. On failure/timeout, the tab is left
 * open as-is (on whatever page it was on) so the user can see what went
 * wrong.
 * @returns {Promise<void>}
 */
async function waitForBasecampLogin() {
  const tabId = await ensureBasecampDashboardTab();
  await waitForLoginRedirect(tabId);
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL("status/basecamp-auth.html") });
}

/**
 * Fetches every page of progress data for a given club.
 * @param {string} uuid
 * @returns {Promise<object[]>}
 */
async function fetchClubProgressPaginated(uuid) {
  let url = `${API_ROOT}/bcm/progress/?club=${uuid}&page=1`;
  const members = [];
  let safety = 0;

  while (url) {
    // Safety guard: avoids an infinite loop if the API returns a "next"
    // that loops back on itself (shouldn't happen, but costs little).
    safety += 1;
    if (safety > 200) {
      throw new Error(`Too many pages for club ${uuid} (>200) — stopping as a safety measure.`);
    }

    const data = await fetchJson(url);
    if (!Array.isArray(data.results)) {
      throw new Error(`Unexpected response for ${url} (no "results" field).`);
    }
    members.push(...data.results.map(stripUnneededUserFields));
    url = data.next;
  }

  return members;
}

/**
 * Basecamp's progress records embed a "user" object carrying a photo/email
 * we have no use for and don't want sitting in chrome.storage.local. Drops
 * them from a shallow copy rather than mutating the API response in place.
 * @param {object} member
 * @returns {object}
 */
function stripUnneededUserFields(member) {
  if (!member.user) return member;
  const { profile_image, member_photo_url, email, ...user } = member.user;
  return { ...member, user };
}

/**
 * fetch() + JSON parsing with explicit error handling (HTTP status, etc.).
 * On a 401/403, opens a Basecamp login tab, waits for the user to log back
 * in, and retries the request exactly once. If the retried request is also
 * 401/403 (e.g. logged in with the wrong account), gives up rather than
 * looping.
 * @param {string} url
 * @param {boolean} [retried] - internal; true once this call is itself the
 *   post-login retry. Callers should never pass this explicitly.
 */
async function fetchJson(url, retried = false) {
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
