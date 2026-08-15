// src/entrypoints/global-settings/main.ts
//
// DOM glue for the Global Settings page — reached via the header gear icon
// (shared/app-shell.ts's renderAppShell()), not one of the five wizard steps
// (see shared/app-shell.ts's NAV_ITEMS): no markStepVisited()/
// renderStepFooter() call, and renderAppShell() is called with `active:
// null` so none of the wizard's step circles render as "current" here.
// Hosts cross-cutting preferences that aren't tied to a specific wizard
// step: the Anonymize Mode toggle (shared/settings-store.ts's
// getAnonymizeMode()/setAnonymizeMode()), and the path-name lookup table
// (moved here from Club Review — unlike club/member matching, it's a
// global alias table, not a per-scrape reconciliation concern, and isn't
// name-based so it stays usable regardless of Anonymize Mode).

import { getAnonymizeMode, setAnonymizeMode } from "../../shared/settings-store";
import { getPathLookup, setPathAliases, deletePathCanonical } from "../../shared/resolution-store";
import { escapeAttr, escapeHtml } from "../../shared/dom-utils";
import { renderAppShell } from "../../shared/app-shell";
import { computeStepperInfo } from "../../shared/stepper-info";
import type { PathLookup } from "../../shared/types";

init();

// Keeps this tab in sync if the setting is changed from another tab.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  // Still needed even though this page isn't a wizard step itself: the
  // shared header renders the full 5-step nav regardless of which page
  // called it, and that nav's disabled/done/locked state comes from here.
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: null, info: stepperInfo, settingsActive: true });

  const anonymize = await getAnonymizeMode();
  render(anonymize);
  await refreshPathLookup();
}

function render(anonymize: boolean) {
  document.getElementById("anonymizeSectionRoot")!.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-header__title">Anonymize Mode</span></div>
      <div class="card-body">
        <label class="toggle-row">
          <input type="checkbox" id="anonymizeModeToggle"${anonymize ? " checked" : ""}>
          Replace member and club names with generic labels
        </label>
        <p class="help-text">Useful to generate statistics with AI while protecting personal data.</p>
        <p class="help-text">
          While on, Club Progress, the Excel export, and the Sync Data raw-data preview all show
          only generic labels ("Member 1", "Club 1"...) instead of real names.
        </p>
        <p class="help-text">
          Member Review and Club Review become unavailable during that time, since matching
          people/clubs by name doesn't work on anonymized data. Finish reviewing matches first,
          then turn this on before sharing.
        </p>
      </div>
    </div>
  `;

  document.getElementById("anonymizeModeToggle")!.addEventListener("change", async (e) => {
    await setAnonymizeMode((e.target as HTMLInputElement).checked);
  });
}

// ---------------------------------------------------------------------------
// Path name lookup — maps alternate spellings (e.g. French/German Pathways
// titles) to a canonical path name. Member-level path binds (set from the
// Member Review view) take priority over this table and are not shown here.
// ---------------------------------------------------------------------------

async function refreshPathLookup() {
  const pathLookup = await getPathLookup();
  document.getElementById("pathLookupSectionRoot")!.innerHTML = renderPathLookupCard(pathLookup);
  attachPathLookupHandlers();
}

function renderPathLookupCard(pathLookup: PathLookup): string {
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
    ? `<table class="data-table lookup"><thead><tr><th>Canonical path name</th><th>Alternate spellings (comma-separated)</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty-state">No path aliases configured.</p>';

  return `
    <div class="card">
      <div class="card-header"><span class="card-header__title">Path name lookup</span></div>
      <div class="card-body">
        <p class="help-text">
          Maps alternate spellings (e.g. French/German Pathways titles) to a canonical path name.
          Member-level path binds (set from the Member Review view) take priority over this table and are not shown here.
        </p>
        ${table}
        <div class="add-form">
          <input type="text" id="newPathCanonical" placeholder="New canonical path name (lowercase)" aria-label="New canonical path name">
          <button class="btn btn-primary" data-action="add-canonical">Add path</button>
        </div>
      </div>
    </div>
  `;
}

function attachPathLookupHandlers() {
  const root = document.getElementById("pathLookupSectionRoot")!;

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
