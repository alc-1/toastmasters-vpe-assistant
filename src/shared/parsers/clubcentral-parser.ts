// src/shared/parsers/clubcentral-parser.ts
//
// Pure DOM-parsing logic for toastmasters.org "Club Central" pages. No
// chrome.* dependency at all — takes a Document, returns plain data. This is
// what src/entrypoints/clubcentral-parser.content.ts imports and exposes as
// globals for injection into a live, navigated toastmasters.org tab (see
// background/api/clubcentral.ts) — Club Central sits behind Azure AD B2C
// auth and is not reachable with a tab-less fetch, so parsing has to happen
// against the tab's own live document. Also directly imported by
// tests/clubcentral-parser.test.ts.

import type {
  ClubCentralMemberRow,
  ClubCentralPaymentStatus,
  ClubListParseResult,
  ClubRosterParseResult,
} from "../types";

/**
 * Extracts the clubs the logged-in user can manage from the Club Central
 * landing page's <form id="landingPageForm">. Both the visible ".clubTile"
 * cards (proper-case names) and the "#SelectedClub" <select> (all-caps
 * option text) are present in every state of that page (pre-selection and
 * post-selection, just toggled via display); the tiles are preferred for
 * their nicer casing, with the <select> filling any gap.
 */
export function parseClubList(doc: Document = document): ClubListParseResult {
  const form = doc.getElementById("landingPageForm");
  if (!form) return { clubs: [] };

  const byId = new Map<string, string>();

  for (const tile of Array.from(form.querySelectorAll(".clubTile"))) {
    const id = (tile.getAttribute("data-club-id") || "").trim();
    const name = (tile.querySelector(".clubSelectTileTitle")?.textContent || "").replace(/\s+/g, " ").trim();
    if (id && name) byId.set(id, name);
  }

  for (const opt of Array.from(form.querySelectorAll<HTMLOptionElement>("#SelectedClub option"))) {
    const id = (opt.value || "").trim();
    if (!id) continue;
    if (byId.has(id)) continue;
    // Option text looks like "CB-28675805 - INSIGHTS ADVANCED TOASTMASTERS CLUB".
    const raw = (opt.textContent || "").replace(/\s+/g, " ").trim();
    const name = raw.replace(/^\S+\s*-\s*/, "").trim() || raw;
    byId.set(id, name);
  }

  return { clubs: Array.from(byId, ([id, name]) => ({ id, name })) };
}

/**
 * Extracts the member roster from the club-membership page. The page renders
 * the same roster twice (a grid "page view" and a hidden "list view"); this
 * parses the list view's <table>, which has clean single-value cells for
 * payment status. The table carries no id/class of its own, so it's
 * disambiguated by its column headers (Name / Position / Payment Status /
 * Paid Until) — the same content-based approach easyspeak-parser.ts uses.
 */
export function parseRoster(doc: Document = document): ClubRosterParseResult {
  const desc = doc.querySelector(".printDescription")?.textContent || "";
  const managingMatch = desc.match(/Currently Managing:\s*(.+?)\s*$/);
  const clubName = managingMatch ? managingMatch[1].trim() : null;

  const table =
    doc.querySelector<HTMLTableElement>("#HtmlListViewData table") ??
    Array.from(doc.querySelectorAll<HTMLTableElement>("table")).find((t) => {
      const heads = Array.from(t.querySelectorAll("thead th")).map((th) => (th.textContent || "").trim().toLowerCase());
      return heads.some((h) => h.includes("payment status")) && heads.some((h) => h.includes("paid until"));
    });

  if (!table) {
    throw new Error("Could not find the roster table on the Club Central membership page. Did the page finish loading?");
  }

  const members: ClubCentralMemberRow[] = [];
  for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
    if (!tr.querySelector("td")) continue;
    const row = parseRosterRow(tr);
    if (row) members.push(row);
  }

  return { clubName, members };
}

function parseRosterRow(tr: Element): ClubCentralMemberRow | null {
  const profile = tr.querySelector(".member-menu-profile") ?? tr.querySelector("td");

  // Name: the first <p> in the profile cell, minus any trailing path-code
  // <span> (e.g. "<span>, DL1</span>").
  let name = "";
  const nameP = profile?.querySelector("p");
  if (nameP) {
    const clone = nameP.cloneNode(true) as Element;
    clone.querySelectorAll("span").forEach((s) => s.remove());
    name = (clone.textContent || "").replace(/\s+/g, " ").trim();
  }
  if (!name) return null;

  const pathwaysEnrolled = Array.from(profile?.querySelectorAll("p") ?? []).some(
    (p) => (p.textContent || "").replace(/\s+/g, " ").trim() === "Pathways Enrolled"
  );

  const editLink = profile?.querySelector('a[onclick*="showListModal"], a[onclick*="showModal"]');
  const modalMatch = (editLink?.getAttribute("onclick") || "").match(/show(?:List)?Modal\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
  const crmId = modalMatch ? modalMatch[1] : null;
  const memberNumber = modalMatch ? modalMatch[2] : null;

  const position = (tr.querySelector(".member-position p")?.textContent || "").replace(/\s+/g, " ").trim();

  const paymentStatus = normalizePaymentStatus(tr.querySelector(".payment-status p")?.textContent);

  // NB: the real markup misspells the class as "paid-untill".
  const paidUntilRaw = (
    tr.querySelector(".paid-untill p")?.textContent ??
    tr.querySelector(".paid-until p")?.textContent ??
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const paidUntil = paidUntilRaw || null;

  return { name, memberNumber, crmId, pathwaysEnrolled, paymentStatus, paidUntil, position };
}

export function normalizePaymentStatus(raw: string | null | undefined): ClubCentralPaymentStatus {
  const s = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (s === "paid") return "Paid";
  if (s === "unpaid") return "Unpaid";
  if (s === "membership pending") return "Membership Pending";
  return "Unknown";
}
