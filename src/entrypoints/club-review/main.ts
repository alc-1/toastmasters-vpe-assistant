// src/entrypoints/club-review/main.ts
//
// DOM glue for the club/path name lookup editors. Club/path lookups are
// small, low-cardinality tables edited rarely (near-once per club, or when
// a new Pathways path/localization spelling shows up) — unlike
// entrypoints/members/main.ts there's no live-recompute-and-rerender loop
// tied to matching; each section just re-reads its own storage after a
// write.

import { escapeAttr, escapeHtml } from "../../shared/dom-utils";
import { local } from "../../shared/storage";
import {
  getClubLookup,
  getClubRejectedPairs,
  getPathLookup,
  pinClub,
  rejectClubPair,
  removeClubPin,
  setPathAliases,
  deletePathCanonical,
} from "../../shared/resolution-store";
import { matchClubs, type ClubGroup, type ClubMatchPair } from "../../shared/sync/conflicts";
import { renderAppShell, renderStepFooter } from "../../shared/app-shell";
import { computeStepperInfo, markStepVisited } from "../../shared/stepper-info";
import type { BasecampScrape, EasySpeakScrape, PathLookup } from "../../shared/types";

let basecampData: BasecampScrape | null = null;
let easyspeakData: EasySpeakScrape | null = null;

init();

// Keeps this tab in sync if data is re-extracted, or a club/path decision is
// edited from another tab (e.g. Member Review) while this one stays open —
// must call init(), not the individual refreshers: basecampData/
// easyspeakData (needed by the club-pin add-form) are only cached into
// module state inside init().
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  await markStepVisited("clubReview");
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "clubReview", info: stepperInfo });
  document.getElementById("stepFooter")!.innerHTML = renderStepFooter("clubReview", stepperInfo);

  const cached = await local.get(["basecampData", "easyspeakData"]);
  basecampData = cached.basecampData ?? null;
  easyspeakData = cached.easyspeakData ?? null;

  await refreshClubLookup();
  await refreshPathLookup();
}

// ---------------------------------------------------------------------------
// Club name lookup — a review table (every club from both sources, not just
// already-pinned ones), same shape/vocabulary as entrypoints/members/main.ts's
// member-matching table: a status badge per club pair (Exact/Suggested/
// Linked manually/Unmatched) and Confirm/"Not this one"/Unlink actions.
// ---------------------------------------------------------------------------

type ClubPair = ClubMatchPair<ClubGroup<unknown>, ClubGroup<unknown>>;

async function refreshClubLookup() {
  const matches = await computeClubMatches();
  document.getElementById("clubLookupRoot")!.innerHTML = renderClubLookupSection(matches);
  attachClubLookupHandlers();
}

async function computeClubMatches(): Promise<ClubPair[]> {
  if (!basecampData || !easyspeakData) return [];
  const clubLookup = await getClubLookup();
  const clubRejectedPairs = await getClubRejectedPairs();
  const bcClubs: ClubGroup<unknown>[] = Object.entries(basecampData).map(([id, club]) => ({ id, name: club.name, people: [] }));
  const esClubs: ClubGroup<unknown>[] = Object.entries(easyspeakData).map(([id, club]) => ({ id, name: club.name, people: [] }));
  // allowFuzzy: true — unlike buildReport()'s own matchClubs() call (which
  // never surfaces an unconfirmed guess, so two clubs' rosters can't get
  // silently joined elsewhere), this is the one place a fuzzy suggestion is
  // meant to be reviewed.
  return matchClubs(bcClubs, esClubs, clubLookup, clubRejectedPairs, true);
}

function needsClubAction(pair: ClubPair): boolean {
  return pair.confidence === "fuzzy" || !pair.basecamp || !pair.easyspeak;
}

function clubSortName(pair: ClubPair): string {
  return String(pair.basecamp?.name ?? pair.easyspeak?.name ?? "");
}

function compareClubPairs(a: ClubPair, b: ClubPair): number {
  const aRank = needsClubAction(a) ? 0 : 1;
  const bRank = needsClubAction(b) ? 0 : 1;
  if (aRank !== bRank) return aRank - bRank;
  return clubSortName(a).localeCompare(clubSortName(b), undefined, { sensitivity: "base" });
}

function renderClubLookupSection(matches: ClubPair[]): string {
  if (!basecampData || !easyspeakData) {
    return '<p class="empty-state">Extract both Basecamp and EasySpeak data first to review club matches.</p>';
  }
  if (matches.length === 0) {
    return '<p class="empty-state">No clubs found in either data source.</p>';
  }

  const sorted = [...matches].sort(compareClubPairs);
  const rows = sorted.map(renderClubMatchRow).join("");
  const table = `<table class="table lookup"><thead><tr><th>Basecamp club</th><th>EasySpeak club</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;

  return `${table}${renderClubAddForm(matches)}`;
}

function renderClubMatchRow(pair: ClubPair): string {
  return `
    <tr>
      <td>${pair.basecamp ? escapeHtml(pair.basecamp.name) : '<span class="muted-text">—</span>'}</td>
      <td>${pair.easyspeak ? escapeHtml(pair.easyspeak.name) : '<span class="muted-text">—</span>'}</td>
      <td>${renderClubStatusCell(pair)}</td>
      <td class="actions">${renderClubActionsCell(pair)}</td>
    </tr>
  `;
}

function renderClubStatusCell(pair: ClubPair): string {
  if (!pair.basecamp || !pair.easyspeak) return '<span class="badge badge-unmatched">Unmatched</span>';
  if (pair.confidence === "confirmed") {
    const sourceLabel = pair.source === "manual-search" ? "linked via manual search" : "confirmed from a suggested match";
    return `<span class="badge badge-confirmed" title="${escapeAttr(sourceLabel)}">Linked manually</span>`;
  }
  if (pair.confidence === "fuzzy") {
    const score = pair.score != null ? pair.score.toFixed(2) : "—";
    return `<span class="badge badge-fuzzy" title="match score: ${score}">Suggested</span>`;
  }
  return '<span class="badge badge-exact">Exact</span>';
}

function renderClubActionsCell(pair: ClubPair): string {
  if (!pair.basecamp || !pair.easyspeak) return '<span class="muted-text">Use the form below to pin manually</span>';

  const bcId = escapeAttr(pair.basecamp.id as string);
  const esId = escapeAttr(pair.easyspeak.id as string);

  if (pair.confidence === "fuzzy") {
    const bcName = escapeAttr(pair.basecamp.name as string);
    const esName = escapeAttr(pair.easyspeak.name as string);
    return (
      `<button class="btn btn-primary" data-action="confirm-club" data-bc-id="${bcId}" data-es-id="${esId}" data-bc-name="${bcName}" data-es-name="${esName}">Confirm</button>` +
      `<button class="btn btn-secondary" data-action="reject-club" data-bc-id="${bcId}" data-es-id="${esId}">Not this one</button>`
    );
  }

  const title =
    pair.confidence === "exact"
      ? "Excludes this pairing so it won't auto-match again, marking both clubs unmatched so you can pin the correct one manually."
      : "Removes this pin so the pairing can be re-matched or re-pinned.";
  return `<button class="btn btn-secondary" data-action="unlink-club" data-confidence="${escapeAttr(pair.confidence ?? "")}" data-bc-id="${bcId}" data-es-id="${esId}" title="${title}">Unlink</button>`;
}

function renderClubAddForm(matches: ClubPair[]): string {
  if (!basecampData || !easyspeakData) {
    return '<p class="empty-state">Extract both Basecamp and EasySpeak data first to add a club pin.</p>';
  }

  const matchedBcIds = new Set(matches.filter((m) => m.basecamp && m.easyspeak).map((m) => m.basecamp!.id));
  const matchedEsIds = new Set(matches.filter((m) => m.basecamp && m.easyspeak).map((m) => m.easyspeak!.id));

  const bcOptions = Object.entries(basecampData)
    .filter(([id]) => !matchedBcIds.has(id))
    .map(([id, club]) => `<option value="${escapeAttr(id)}">${escapeHtml(club.name)}</option>`)
    .join("");
  const esOptions = Object.entries(easyspeakData)
    .filter(([id]) => !matchedEsIds.has(id))
    .map(([id, club]) => `<option value="${escapeAttr(id)}">${escapeHtml(club.name)}</option>`)
    .join("");

  if (!bcOptions || !esOptions) {
    return '<p class="empty-state">All clubs are already matched or pinned.</p>';
  }

  return `
    <div class="add-form">
      <select id="newClubPinBc" aria-label="Basecamp club">${bcOptions}</select>
      <span>&harr;</span>
      <select id="newClubPinEs" aria-label="EasySpeak club">${esOptions}</select>
      <button class="btn btn-primary" data-action="add-club-pin">Add mapping</button>
    </div>
  `;
}

function attachClubLookupHandlers() {
  const root = document.getElementById("clubLookupRoot")!;
  root.querySelectorAll<HTMLButtonElement>('[data-action="confirm-club"]').forEach((btn) => {
    btn.addEventListener("click", () => onConfirmClubPair(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="reject-club"]').forEach((btn) => {
    btn.addEventListener("click", () => onRejectClubPair(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="unlink-club"]').forEach((btn) => {
    btn.addEventListener("click", () => onUnlinkClubPair(btn));
  });
  const addBtn = root.querySelector<HTMLButtonElement>('[data-action="add-club-pin"]');
  if (addBtn) addBtn.addEventListener("click", onAddClubPin);
}

async function onConfirmClubPair(btn: HTMLButtonElement) {
  const { bcId, esId, bcName, esName } = btn.dataset;
  await pinClub(bcId!, esId!, bcName!, esName!, "fuzzy-confirmed");
  await refreshClubLookup();
}

async function onRejectClubPair(btn: HTMLButtonElement) {
  await rejectClubPair(btn.dataset.bcId!, btn.dataset.esId!);
  await refreshClubLookup();
}

async function onUnlinkClubPair(btn: HTMLButtonElement) {
  // An "exact" match is recomputed fresh every time (nothing stored to
  // delete), so unlinking it means rejecting the pair instead — otherwise it
  // would just reappear as "Exact" again on the next refresh.
  if (btn.dataset.confidence === "exact") {
    await rejectClubPair(btn.dataset.bcId!, btn.dataset.esId!);
  } else {
    await removeClubPin(btn.dataset.bcId!);
  }
  await refreshClubLookup();
}

async function onAddClubPin() {
  const bcId = (document.getElementById("newClubPinBc") as HTMLSelectElement).value;
  const esId = (document.getElementById("newClubPinEs") as HTMLSelectElement).value;
  const bcName = basecampData?.[bcId]?.name ?? bcId;
  const esName = easyspeakData?.[esId]?.name ?? esId;
  await pinClub(bcId, esId, bcName, esName, "manual-search");
  await refreshClubLookup();
}

// ---------------------------------------------------------------------------
// Path name lookup
// ---------------------------------------------------------------------------

async function refreshPathLookup() {
  const pathLookup = await getPathLookup();
  document.getElementById("pathLookupRoot")!.innerHTML = renderPathLookupSection(pathLookup);
  attachPathLookupHandlers();
}

function renderPathLookupSection(pathLookup: PathLookup): string {
  const rows = Object.entries(pathLookup)
    .map(
      ([canonical, aliases]) => `
      <tr data-canonical="${escapeAttr(canonical)}">
        <td>${escapeHtml(canonical)}</td>
        <td><input type="text" data-role="alias-input" value="${escapeAttr(aliases.join(", "))}" aria-label="Alternate spellings for ${escapeAttr(canonical)}"></td>
        <td>
          <button class="btn btn-secondary" data-action="save-aliases">Save</button>
          <button class="btn btn-secondary" data-action="delete-canonical">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");

  const table = rows
    ? `<table class="table lookup"><thead><tr><th>Canonical path name</th><th>Alternate spellings (comma-separated)</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty-state">No path aliases configured.</p>';

  return `
    ${table}
    <div class="add-form">
      <input type="text" id="newPathCanonical" placeholder="New canonical path name (lowercase)" aria-label="New canonical path name">
      <button class="btn btn-primary" data-action="add-canonical">Add path</button>
    </div>
  `;
}

function attachPathLookupHandlers() {
  const root = document.getElementById("pathLookupRoot")!;

  root.querySelectorAll<HTMLButtonElement>('[data-action="save-aliases"]').forEach((btn) => {
    btn.addEventListener("click", () => onSaveAliases(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="delete-canonical"]').forEach((btn) => {
    btn.addEventListener("click", () => onDeleteCanonical(btn));
  });
  const addBtn = root.querySelector<HTMLButtonElement>('[data-action="add-canonical"]');
  if (addBtn) addBtn.addEventListener("click", onAddCanonical);
}

async function onSaveAliases(btn: HTMLButtonElement) {
  const row = btn.closest("tr") as HTMLTableRowElement;
  const canonical = row.dataset.canonical!;
  const input = row.querySelector<HTMLInputElement>('[data-role="alias-input"]')!;
  const aliases = input.value
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  await setPathAliases(canonical, aliases);
  await refreshPathLookup();
}

async function onDeleteCanonical(btn: HTMLButtonElement) {
  const row = btn.closest("tr") as HTMLTableRowElement;
  await deletePathCanonical(row.dataset.canonical!);
  await refreshPathLookup();
}

async function onAddCanonical() {
  const input = document.getElementById("newPathCanonical") as HTMLInputElement;
  // canonicalizePathName() lowercases the raw path before this table is
  // consulted, so a mixed-case canonical key here would just never match.
  const name = input.value.trim().toLowerCase();
  if (!name) return;
  await setPathAliases(name, []);
  await refreshPathLookup();
}
