// src/background/api/clubcentral.ts
//
// Toastmasters.org "Club Central" roster scraping. Like EasySpeak (and
// unlike Basecamp) Club Central has no JSON API and sits behind auth
// (Azure AD B2C at login.toastmasters.org), so it can't be scraped
// tab-lessly — this module navigates a real, brand-new tab through the
// Club Central flow and injects entrypoints/clubcentral-parser.content.ts
// via browser.scripting to read each club's membership roster from the live
// DOM. Once every club is scraped, the tab is redirected to a confirmation
// page (clubcentral-done.html) that auto-closes a few seconds later.
//
// NAVIGATION IS DRIVEN BY CLICKING THE PAGE'S OWN LINKS, NOT by setting
// tab.url. The only direct navigations are the initial tab open to the Club
// Central landing URL and re-requesting that same landing URL (after a login
// round-trip, or to get back to the club picker between clubs when no link
// is available). Deep links like .../club-central/club-membership return a
// server-side "Page Not Found" when requested directly (they need the
// same-origin referer / session state a real in-page click carries), so the
// per-club steps each locate a real element on the current page, dispatch a
// click / form submit, then wait for the resulting navigation to finish.
//
// The built manifest has no `tabs` permission and no login.toastmasters.org
// host permission (both deliberate — don't add them). While the tab sits on
// the login origin, browser.tabs.get(tabId).url is undefined and
// executeScript throws — waitForPage() treats "reached complete but the URL
// is unreadable / the page is un-injectable" as "probably mid-login", keeps
// a long timeout armed, and only resolves once it can inject into a
// www.toastmasters.org page whose DOM matches the expected content.
//
// As with EasySpeak: the active profile is captured up front (a "demo"
// profile short-circuits to mock data with no tab), and the result is
// written to that profile's storage bucket directly — ensureClubCentralTab()
// steals focus and tears down the popup, so the popup can't persist the
// response itself.

import { local } from "../../shared/storage";
import { PAGES, pageUrl } from "../../shared/pages";
import { resolveActiveProfile } from "../../shared/settings-store";
import { MOCK_CLUBCENTRAL_DATA } from "../../shared/mock/mockData";
import type { ClubCentralScrape, ClubListParseResult, ClubRosterParseResult } from "../../shared/types";

// WXT bundles entrypoints/clubcentral-parser.content.ts as a plain IIFE at
// this stable, hash-free path — safe to hardcode. See that file's doc
// comment and easyspeak.ts's PARSER_FILE for the rationale.
const PARSER_FILE = "/content-scripts/clubcentral-parser.js" as const;

const ORIGIN = "https://www.toastmasters.org";
const LANDING_PATH = "/my-toastmasters/profile/club-central";
const LANDING_URL = `${ORIGIN}${LANDING_PATH}`;
// Best-effort only — see the file header. Detection can't depend on seeing this.
const LOGIN_ORIGIN = "https://login.toastmasters.org";

const PAGE_LOAD_TIMEOUT_MS = 45_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

const LOGIN_TIMEOUT_MESSAGE =
  "Club Central requires you to log in. Switch to the toastmasters.org tab, log in, then try again.";
const PAGE_TIMEOUT_MESSAGE =
  "Club Central didn't finish loading. Switch to the toastmasters.org tab, check for any prompt, then try again.";
const NOT_FOUND_MESSAGE =
  "Club Central returned a 'Page Not Found'. The site's navigation may have changed — please report this.";
const LOGGED_OUT_MESSAGE =
  "Club Central logged you out mid-import. Log back in on the toastmasters.org tab and try again.";

type ParseFnName = "parseClubList" | "parseRoster";
type PageExpectation = "landing" | "dashboard" | "roster";

/**
 * Entry point: discovers every club the user can manage from the Club
 * Central landing page, then walks each one's membership roster — every step
 * after the initial tab open is performed by clicking a link on the page.
 */
export async function scrapeAllClubCentralClubs(): Promise<ClubCentralScrape> {
  // Captured once, up front — writes below use this exact profile via
  // local.setForProfile(), not the ambient active one (which the user could
  // switch mid-scrape). For a non-demo profile this is an EasySpeak region
  // id; Club Central itself is region-agnostic, so this only picks the
  // storage bucket.
  const profileId = await resolveActiveProfile();

  if (profileId === "demo") {
    await local.setForProfile(profileId, { clubCentralData: MOCK_CLUBCENTRAL_DATA, clubCentralScrapedAt: Date.now() });
    return MOCK_CLUBCENTRAL_DATA;
  }

  const tabId = await ensureClubCentralTab();
  await waitForPage(tabId, "landing", { firstLoad: true });

  const { clubs } = (await loadAndParse(tabId, "parseClubList")) as ClubListParseResult;

  const result: ClubCentralScrape = {};

  if (clubs.length === 0) {
    // A single-club officer may land straight on the club dashboard with no
    // picker. If Membership Management is right there, scrape that one club;
    // otherwise it's a real "no clubs" situation.
    if (!(await probeMatches(tabId, "dashboard"))) {
      throw new Error(
        "No clubs found in Club Central. Are you logged in with the right account, and are you an officer of at least one club?"
      );
    }
    await clickMembershipManagement(tabId);
    const { clubName, members } = (await loadAndParse(tabId, "parseRoster")) as ClubRosterParseResult;
    result["club"] = { name: clubName ?? "My club", members };
  } else {
    for (let i = 0; i < clubs.length; i++) {
      const club = clubs[i];
      if (i > 0) await returnToClubPicker(tabId);
      await selectClub(tabId, club.id);
      await clickMembershipManagement(tabId);
      const { clubName, members } = (await loadAndParse(tabId, "parseRoster")) as ClubRosterParseResult;
      result[club.id] = { name: clubName ?? club.name, members };
    }
  }

  // Persist directly — see the file header for why the popup can't. Written
  // before the confirmation-page redirect so the data is saved even if that
  // navigation fails. On any throw above, this line is never reached and the
  // tab is left open as-is so the user can see/solve what went wrong.
  await local.setForProfile(profileId, { clubCentralData: result, clubCentralScrapedAt: Date.now() });

  await browser.tabs.update(tabId, { url: pageUrl(PAGES.clubcentralDone) });

  return result;
}

/** Opens a brand-new tab straight on the Club Central landing page. */
async function ensureClubCentralTab(): Promise<number> {
  const tab = await browser.tabs.create({ active: true, url: LANDING_URL });
  return tab.id!;
}

/**
 * Injects the parser bundle into the tab and invokes the named parser
 * function against the tab's live DOM. Mirrors easyspeak.ts's loadAndParse.
 */
async function loadAndParse(tabId: number, parseFnName: ParseFnName): Promise<ClubListParseResult | ClubRosterParseResult> {
  await browser.scripting.executeScript({ target: { tabId }, files: [PARSER_FILE] });

  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: (fnName: string) => {
      const fn = (globalThis as unknown as Record<string, () => unknown>)[fnName];
      if (typeof fn !== "function") {
        throw new Error(`Parser ${fnName} was not injected into the page.`);
      }
      return fn();
    },
    args: [parseFnName],
  });

  return result as ClubListParseResult | ClubRosterParseResult;
}

// ---------------------------------------------------------------------------
// DOM probe — which Club Central page is the tab currently on?
// ---------------------------------------------------------------------------

type PageKind = "notfound" | "roster" | "dashboard" | "landing" | "other";

interface PageProbe {
  kind: PageKind;
  /** A "Club Central" link (href → the landing path) exists on this page. */
  hasClubCentralLink: boolean;
}

// Serialized and run in the page context — no closure over module scope.
const PROBE_FN = (): PageProbe => {
  const isNotFound = /pagenotfound/i.test(location.pathname) || location.search.includes("aspxerrorpath");

  const heads = Array.from(document.querySelectorAll("table thead")).map((t) => (t.textContent || "").toLowerCase());
  const hasRosterTable =
    !!document.getElementById("HtmlListViewData") ||
    heads.some((h) => h.includes("payment status") && h.includes("paid until"));

  const hasMembershipLink = !!document.getElementById("Membership_Management");

  // getClientRects().length is 0 for display:none — distinguishes the
  // multi-club landing (tiles / select shown) from the club dashboard
  // (same nodes present but hidden).
  const isVisible = (el: Element | null) => !!el && el.getClientRects().length > 0;
  const visiblePicker =
    Array.from(document.querySelectorAll(".clubTile")).some(isVisible) || isVisible(document.getElementById("SelectedClub"));

  const landingPath = "/my-toastmasters/profile/club-central";
  const hasClubCentralLink = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).some((a) => {
    try {
      return new URL(a.href, location.origin).pathname.replace(/\/$/, "") === landingPath;
    } catch {
      return false;
    }
  });

  let kind: PageKind = "other";
  if (isNotFound) kind = "notfound";
  else if (hasRosterTable) kind = "roster";
  else if (hasMembershipLink) kind = "dashboard";
  else if (visiblePicker) kind = "landing";

  return { kind, hasClubCentralLink };
};

async function probe(tabId: number): Promise<PageProbe | null> {
  try {
    const [{ result }] = await browser.scripting.executeScript({ target: { tabId }, func: PROBE_FN });
    return result as PageProbe;
  } catch {
    return null; // page not injectable (login origin, mid-navigation, …)
  }
}

function probeSatisfies(p: PageProbe, expect: PageExpectation): boolean {
  if (expect === "roster") return p.kind === "roster";
  if (expect === "dashboard") return p.kind === "dashboard";
  // "landing": the club picker, or (single-club accounts) straight to the dashboard.
  return p.kind === "landing" || p.kind === "dashboard";
}

async function probeMatches(tabId: number, expect: PageExpectation): Promise<boolean> {
  const p = await probe(tabId);
  return !!p && probeSatisfies(p, expect);
}

// ---------------------------------------------------------------------------
// Waiting for the tab to reach an expected page — by polling, not by
// listening for tabs.onUpdated. Club Central mixes full navigations, ASP.NET
// postbacks and client-side content swaps; polling the live DOM copes with
// all three, where a "complete" event does not always fire.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getTab(tabId: number): Promise<Browser.tabs.Tab | null> {
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return null;
  }
}

function isLoginOrUnknown(tab: Browser.tabs.Tab): boolean {
  const url = tab.url ?? "";
  return url === "" || url.startsWith(LOGIN_ORIGIN) || !url.startsWith(ORIGIN);
}

interface WaitOptions {
  /** First load after the tab open: absorb a login round-trip, and re-request
   *  LANDING_URL once if the post-login redirect overshoots or 404s. */
  firstLoad?: boolean;
  description?: string;
}

/**
 * Polls until the tab is showing a page satisfying `expect`. The only
 * browser.tabs.update it issues is re-requesting LANDING_URL once, on the
 * first load, if login drops the tab somewhere other than the landing —
 * never a deep link.
 */
async function waitForPage(tabId: number, expect: PageExpectation, opts: WaitOptions = {}): Promise<void> {
  const what = opts.description ?? "loading Club Central";
  const timeoutMs = opts.firstLoad ? LOGIN_TIMEOUT_MS : PAGE_LOAD_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let reRequested = false;
  let everSawLogin = false;

  while (Date.now() < deadline) {
    const tab = await getTab(tabId);
    if (!tab) throw new Error(`The Club Central tab was closed while ${what}.`);

    if (tab.status !== "complete" || isLoginOrUnknown(tab)) {
      if (isLoginOrUnknown(tab)) everSawLogin = true;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const p = await probe(tabId);
    if (!p) {
      // On a www.toastmasters.org page but executeScript failed transiently
      // (mid-navigation). Retry.
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (p.kind === "notfound") {
      if (opts.firstLoad && !reRequested) {
        reRequested = true;
        await browser.tabs.update(tabId, { url: LANDING_URL }).catch(() => {});
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      throw new Error(`Club Central returned a 'Page Not Found' while ${what}. ${NOT_FOUND_MESSAGE}`);
    }

    if (probeSatisfies(p, expect)) return;

    // A real page that isn't the one we want. On the first load this is
    // usually the post-login redirect landing on My Home — re-request the
    // landing URL once.
    if (opts.firstLoad && !reRequested && p.kind !== "landing") {
      reRequested = true;
      await browser.tabs.update(tabId, { url: LANDING_URL }).catch(() => {});
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (everSawLogin) throw new Error(opts.firstLoad ? LOGIN_TIMEOUT_MESSAGE : LOGGED_OUT_MESSAGE);
  throw new Error(`Club Central timed out while ${what}. ${PAGE_TIMEOUT_MESSAGE}`);
}

// ---------------------------------------------------------------------------
// Perform a DOM action, then wait for the page it leads to
// ---------------------------------------------------------------------------

/**
 * Runs `action` in the page (it must dispatch a real click / `change` and
 * return "clicked", or "none" if the target isn't present), then polls until
 * the tab shows a page satisfying `expect`.
 */
async function clickAndWait<A extends unknown[]>(
  tabId: number,
  description: string,
  expect: PageExpectation,
  action: (...args: A) => "clicked" | "none",
  args: A
): Promise<void> {
  let results;
  try {
    results = await browser.scripting.executeScript({ target: { tabId }, func: action, args });
  } catch (err) {
    // The page navigated away as the script was injecting — treat as "the
    // click already happened" and let waitForPage sort out where we landed.
    results = undefined;
    void err;
  }
  if (results && (results[0]?.result as "clicked" | "none" | undefined) === "none") {
    throw new Error(`Couldn't find the control to ${description} on the Club Central page.`);
  }
  await waitForPage(tabId, expect, { description });
}

/**
 * Selects a club on the Club Central landing page. On the multi-club landing
 * the club *tiles* are the visible control a human clicks (the `#SelectedClub`
 * <select> is `display:none` there — it's only for switching clubs once
 * you're already managing one). So: click the tile; only fall back to the
 * <select> (value + `change`, letting the site's own AutoPostBack fire) when
 * no tile is present. **Never** call `form.submit()`/`requestSubmit()` — a
 * raw POST to the landing URL, without the site's postback fields, is what
 * the server answers with "Page Not Found".
 */
function selectClub(tabId: number, clubId: string): Promise<void> {
  return clickAndWait(
    tabId,
    "selecting a club",
    "dashboard",
    (id: string) => {
      const tile = document.querySelector(`.clubTile[data-club-id="${id}"]`) as HTMLElement | null;
      if (tile) {
        tile.click();
        return "clicked";
      }
      const select = document.getElementById("SelectedClub") as HTMLSelectElement | null;
      if (select && select.querySelector(`option[value="${id}"]`)) {
        select.value = id;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return "clicked";
      }
      return "none";
    },
    [clubId]
  );
}

/** Clicks the "Membership Management" tile on the club dashboard. */
function clickMembershipManagement(tabId: number): Promise<void> {
  return clickAndWait(
    tabId,
    "opening Membership Management",
    "roster",
    () => {
      const link =
        (document.getElementById("Membership_Management") as HTMLElement | null) ??
        Array.from(document.querySelectorAll<HTMLElement>("a")).find((a) =>
          (a.textContent || "").trim().toLowerCase().startsWith("membership management")
        ) ??
        null;
      if (!link) return "none";
      link.click();
      return "clicked";
    },
    []
  );
}

/**
 * Returns to the club picker between clubs. Prefers clicking a "Club Central"
 * link on the current page; falls back to re-requesting the landing URL (the
 * same entry navigation the tab open performs).
 */
async function returnToClubPicker(tabId: number): Promise<void> {
  const p = await probe(tabId);
  if (p?.kind === "landing") return; // the club picker is already on screen

  if (p?.hasClubCentralLink) {
    await clickAndWait(
      tabId,
      "returning to the club list",
      "landing",
      () => {
        const landingPath = "/my-toastmasters/profile/club-central";
        const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).find((a) => {
          try {
            return new URL(a.href, location.origin).pathname.replace(/\/$/, "") === landingPath;
          } catch {
            return false;
          }
        });
        if (!link) return "none";
        link.click();
        return "clicked";
      },
      []
    );
    return;
  }

  await browser.tabs.update(tabId, { url: LANDING_URL });
  await waitForPage(tabId, "landing");
}
