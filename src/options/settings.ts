// src/options/settings.ts
//
// DOM glue for the club/path name lookup editors. Club/path lookups are
// small, low-cardinality tables edited rarely (near-once per club, or when
// a new Pathways path/localization spelling shows up) — unlike
// options/members.ts there's no live-recompute-and-rerender loop tied to
// matching; each section just re-reads its own storage after a write.

import { escapeAttr, escapeHtml } from "../shared/dom-utils";
import { local } from "../shared/storage";
import { getClubLookup, getPathLookup, pinClub, removeClubPin, setPathAliases, deletePathCanonical } from "../shared/resolution-store";
import { EASYSPEAK_SERVERS, getEasySpeakServer, getMockMode, setEasySpeakServer, setMockMode } from "../shared/settings-store";
import { renderAppShell } from "../shared/app-shell";
import type { BasecampScrape, ClubLookupEntry, EasySpeakScrape, EasySpeakServerId, PathLookup } from "../shared/types";

let basecampData: BasecampScrape | null = null;
let easyspeakData: EasySpeakScrape | null = null;

init();

// Keeps this tab in sync if data is re-extracted, or a club/path/mock
// decision is edited from another tab (e.g. Members) while this one stays
// open — must call init(), not the individual refreshers: basecampData/
// easyspeakData (needed by the club-pin add-form) are only cached into
// module state inside init().
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "settings" });

  const cached = await local.get(["basecampData", "easyspeakData"]);
  basecampData = cached.basecampData ?? null;
  easyspeakData = cached.easyspeakData ?? null;

  await refreshMockMode();
  await refreshEasySpeakServer();
  await refreshClubLookup();
  await refreshPathLookup();
}

// ---------------------------------------------------------------------------
// Demo / mock mode
// ---------------------------------------------------------------------------

async function refreshMockMode() {
  const current = await getMockMode();
  document.getElementById("mockModeRoot")!.innerHTML = renderMockModeSection(current);
  attachMockModeHandlers();
}

function renderMockModeSection(current: boolean): string {
  return `
    <div class="add-form">
      <label><input type="checkbox" id="mockModeCheckbox"${current ? " checked" : ""}> Enable demo/mock mode</label>
      <button class="btn btn-primary" data-action="save-mock-mode">Save</button>
      <span class="save-status" id="mockModeStatus" aria-live="polite">Saved.</span>
    </div>
  `;
}

function attachMockModeHandlers() {
  const root = document.getElementById("mockModeRoot")!;
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-action="save-mock-mode"]');
  if (saveBtn) saveBtn.addEventListener("click", onSaveMockMode);

  // Hide the "Saved." confirmation again as soon as the checkbox changes,
  // so it can't misleadingly linger next to an unsaved new choice.
  const checkbox = document.getElementById("mockModeCheckbox");
  if (checkbox) {
    checkbox.addEventListener("change", () => {
      document.getElementById("mockModeStatus")!.classList.remove("visible");
    });
  }
}

async function onSaveMockMode() {
  const checkbox = document.getElementById("mockModeCheckbox") as HTMLInputElement;
  await setMockMode(checkbox.checked);
  document.getElementById("mockModeStatus")!.classList.add("visible");
}

// ---------------------------------------------------------------------------
// EasySpeak server
// ---------------------------------------------------------------------------

async function refreshEasySpeakServer() {
  const current = await getEasySpeakServer();
  document.getElementById("easyspeakServerRoot")!.innerHTML = renderEasySpeakServerSection(current);
  attachEasySpeakServerHandlers();
}

function renderEasySpeakServerSection(current: EasySpeakServerId): string {
  const options = EASYSPEAK_SERVERS.map((s) => `<option value="${escapeAttr(s.id)}"${s.id === current ? " selected" : ""}>${escapeHtml(s.label)}</option>`).join("");

  return `
    <div class="add-form">
      <label>EasySpeak server: <select id="easyspeakServerSelect">${options}</select></label>
      <button class="btn btn-primary" data-action="save-easyspeak-server">Save</button>
      <span class="save-status" id="easyspeakServerStatus" aria-live="polite">Saved.</span>
    </div>
  `;
}

function attachEasySpeakServerHandlers() {
  const root = document.getElementById("easyspeakServerRoot")!;
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-action="save-easyspeak-server"]');
  if (saveBtn) saveBtn.addEventListener("click", onSaveEasySpeakServer);

  // Hide the "Saved." confirmation again as soon as the selection changes,
  // so it can't misleadingly linger next to an unsaved new choice.
  const select = document.getElementById("easyspeakServerSelect");
  if (select) {
    select.addEventListener("change", () => {
      document.getElementById("easyspeakServerStatus")!.classList.remove("visible");
    });
  }
}

async function onSaveEasySpeakServer() {
  const select = document.getElementById("easyspeakServerSelect") as HTMLSelectElement;
  await setEasySpeakServer(select.value as EasySpeakServerId);
  document.getElementById("easyspeakServerStatus")!.classList.add("visible");
}

// ---------------------------------------------------------------------------
// Club name lookup
// ---------------------------------------------------------------------------

async function refreshClubLookup() {
  const clubLookup = await getClubLookup();
  document.getElementById("clubLookupRoot")!.innerHTML = renderClubLookupSection(clubLookup);
  attachClubLookupHandlers();
}

function renderClubLookupSection(clubLookup: ClubLookupEntry[]): string {
  const rows = clubLookup
    .map(
      (pin) => `
      <tr>
        <td>${escapeHtml(pin.basecampClubName)}</td>
        <td>${escapeHtml(pin.easyspeakClubName)}</td>
        <td><button class="btn btn-secondary" data-action="remove-club-pin" data-basecamp-club-id="${escapeAttr(pin.basecampClubId)}">Remove</button></td>
      </tr>
    `
    )
    .join("");

  const table = clubLookup.length
    ? `<table class="table lookup"><thead><tr><th>Basecamp club</th><th>EasySpeak club</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty-state">No club pins yet — clubs are only matched automatically on an exact name match.</p>';

  return `${table}${renderClubAddForm(clubLookup)}`;
}

function renderClubAddForm(clubLookup: ClubLookupEntry[]): string {
  if (!basecampData || !easyspeakData) {
    return '<p class="empty-state">Extract both Basecamp and EasySpeak data first to add a club pin.</p>';
  }

  const pinnedBcIds = new Set(clubLookup.map((p) => p.basecampClubId));
  const pinnedEsIds = new Set(clubLookup.map((p) => p.easyspeakClubId));

  const bcOptions = Object.entries(basecampData)
    .filter(([id]) => !pinnedBcIds.has(id))
    .map(([id, club]) => `<option value="${escapeAttr(id)}">${escapeHtml(club.name)}</option>`)
    .join("");
  const esOptions = Object.entries(easyspeakData)
    .filter(([id]) => !pinnedEsIds.has(id))
    .map(([id, club]) => `<option value="${escapeAttr(id)}">${escapeHtml(club.name)}</option>`)
    .join("");

  if (!bcOptions || !esOptions) {
    return '<p class="empty-state">All clubs are already pinned.</p>';
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
  root.querySelectorAll<HTMLButtonElement>('[data-action="remove-club-pin"]').forEach((btn) => {
    btn.addEventListener("click", () => onRemoveClubPin(btn.dataset.basecampClubId!));
  });
  const addBtn = root.querySelector<HTMLButtonElement>('[data-action="add-club-pin"]');
  if (addBtn) addBtn.addEventListener("click", onAddClubPin);
}

async function onRemoveClubPin(basecampClubId: string) {
  await removeClubPin(basecampClubId);
  await refreshClubLookup();
}

async function onAddClubPin() {
  const bcId = (document.getElementById("newClubPinBc") as HTMLSelectElement).value;
  const esId = (document.getElementById("newClubPinEs") as HTMLSelectElement).value;
  const bcName = basecampData?.[bcId]?.name ?? bcId;
  const esName = easyspeakData?.[esId]?.name ?? esId;
  await pinClub(bcId, esId, bcName, esName);
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
