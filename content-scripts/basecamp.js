// content-scripts/basecamp.js
//
// Injected on https://apps.basecamp.toastmasters.org/*
// Fetches, for every club where the logged-in user is a "BCM" officer
// (Basecamp Club Management), the Pathways progress of all members.
//
// Authentication happens via session cookie: since this script runs in the
// page's own context (isolated world), fetch() automatically inherits the
// cookies already set by the browser for this domain.

const API_ROOT = "https://basecamp.toastmasters.org/api";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCRAPE_BASECAMP") {
    scrapeAllClubs()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    // Tells Chrome we'll respond asynchronously.
    return true;
  }
});

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
  return result;
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
    members.push(...data.results);
    url = data.next;
  }

  return members;
}

/**
 * fetch() + JSON parsing with explicit error handling (HTTP status, etc.)
 * @param {string} url
 */
async function fetchJson(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Not authenticated (${res.status}) on ${url}. Log back into Basecamp Toastmasters and try again.`
      );
    }
    throw new Error(`${res.status} ${res.statusText} on ${url}`);
  }
  return res.json();
}
