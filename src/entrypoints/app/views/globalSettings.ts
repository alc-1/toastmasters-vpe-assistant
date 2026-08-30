// src/entrypoints/app/views/globalSettings.ts
//
// The Global Settings view — not one of the five wizard steps (see
// shared/app-shell.ts's AppShellPage), so this view renders no step-footer
// content itself (the shell already renders an empty #stepFooter for the
// "globalSettings" route — see entrypoints/app/main.ts). Hosts cross-cutting
// preferences: the Anonymize Mode toggle (shared/settings-store.ts's
// getAnonymizeMode()/setAnonymizeMode()), and the path-name lookup table
// (moved here from Club Review — a global alias table, not a per-scrape
// reconciliation concern, and isn't name-based so it stays usable
// regardless of Anonymize Mode).

import { getAnonymizeMode, setAnonymizeMode } from "../../../shared/settings-store";
import { getPathLookup, setPathAliases, deletePathCanonical } from "../../../shared/resolution-store";
import { escapeAttr, escapeHtml } from "../../../shared/dom-utils";
import type { PathLookup } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

const SHELL_HTML = `
  <div class="page-intro">
    <h1 class="page-title">Global Settings</h1>
    <p class="page-intro__desc">Preferences that apply across the whole extension, not just one step of the wizard.</p>
  </div>

  <div id="anonymizeSectionRoot"></div>

  <div id="pathLookupSectionRoot"></div>
`;

export const globalSettingsView: ViewModule = {
  async mount(root) {
    root.innerHTML = SHELL_HTML;

    // Set true by the disposer — see syncData.ts's mount() for the full
    // writeup of why an in-flight async refresh needs this guard.
    let disposed = false;

    function renderAnonymizeCard(anonymize: boolean) {
      const sectionRoot = root.querySelector("#anonymizeSectionRoot")!;
      sectionRoot.innerHTML = `
        <div class="card">
          <div class="card-header"><span class="card-header__title"><span class="settings-lock-icon" aria-hidden="true">${anonymize ? "🔒" : "🔓"}</span>Privacy Mode</span></div>
          <div class="card-body">
            <label class="flex items-center gap-3 mb-2 font-semibold cursor-pointer">
              <input type="checkbox" class="toggle toggle-primary" id="anonymizeModeToggle"${anonymize ? " checked" : ""}>
              <span>Replace member and club names with generic labels</span>
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

      root.querySelector("#anonymizeModeToggle")!.addEventListener("change", async (e) => {
        await setAnonymizeMode((e.target as HTMLInputElement).checked);
      });
    }

    async function refreshPathLookup() {
      const pathLookup = await getPathLookup();
      if (disposed) return;
      root.querySelector("#pathLookupSectionRoot")!.innerHTML = renderPathLookupCard(pathLookup);
      attachPathLookupHandlers();
    }

    function renderPathLookupCard(pathLookup: PathLookup): string {
      const rows = Object.entries(pathLookup)
        .map(
          ([canonical, aliases]) => `
          <tr data-canonical="${escapeAttr(canonical)}">
            <td>${escapeHtml(canonical)}</td>
            <td><input type="text" class="input input-xs w-full" data-role="alias-input" value="${escapeAttr(aliases.join(", "))}" aria-label="Alternate spellings for ${escapeAttr(canonical)}"></td>
            <td>
              <button class="btn btn-secondary" data-action="save-aliases">Save</button>
              <button class="btn btn-secondary" data-action="delete-canonical">Delete</button>
            </td>
          </tr>
        `
        )
        .join("");

      const table = rows
        ? `<div class="table-scroll"><table class="data-table lookup"><thead><tr><th>Canonical path name</th><th>Alternate spellings (comma-separated)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
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
              <input type="text" id="newPathCanonical" class="input input-sm" placeholder="New canonical path name (lowercase)" aria-label="New canonical path name">
              <button class="btn btn-primary" data-action="add-canonical">Add path</button>
            </div>
          </div>
        </div>
      `;
    }

    function attachPathLookupHandlers() {
      const lookupRoot = root.querySelector("#pathLookupSectionRoot")!;

      lookupRoot.querySelectorAll<HTMLButtonElement>('[data-action="save-aliases"]').forEach((btn) => {
        btn.addEventListener("click", () => onSaveAliases(btn));
      });
      lookupRoot.querySelectorAll<HTMLButtonElement>('[data-action="delete-canonical"]').forEach((btn) => {
        btn.addEventListener("click", () => onDeleteCanonical(btn));
      });
      const addBtn = lookupRoot.querySelector<HTMLButtonElement>('[data-action="add-canonical"]');
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
      const input = root.querySelector("#newPathCanonical") as HTMLInputElement;
      // canonicalizePathName() lowercases the raw path before this table is
      // consulted, so a mixed-case canonical key here would just never match.
      const name = input.value.trim().toLowerCase();
      if (!name) return;
      await setPathAliases(name, []);
      await refreshPathLookup();
    }

    async function init() {
      const anonymize = await getAnonymizeMode();
      if (disposed) return;
      renderAnonymizeCard(anonymize);
      await refreshPathLookup();
    }

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") init();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await init();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
