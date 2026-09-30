// src/entrypoints/app/views/globalSettings.ts
//
// The Global Settings view — not one of the five wizard steps (see
// shared/app-shell.ts's AppShellPage), so this view renders no step-footer
// content itself (the shell already renders an empty #stepFooter for the
// "globalSettings" route — see entrypoints/app/main.ts). Hosts cross-cutting
// preferences: the Interface Language card (shared/settings-store.ts's
// getPreferredLocale()/setPreferredLocale(), shared/i18n-override.ts — see
// that file for how "en"/"fr" actually override native WebExtension i18n at
// runtime), the Anonymize Mode toggle (shared/settings-store.ts's
// getAnonymizeMode()/setAnonymizeMode()), the path-name lookup table
// (moved here from Club Review — a global alias table, not a per-scrape
// reconciliation concern, and isn't name-based so it stays usable
// regardless of Anonymize Mode), and Save/Restore Club Settings (moved here
// from the Home dashboard's feature-tile grid, which now holds only its four
// remaining tiles).

import { getAnonymizeMode, getPreferredLocale, setAnonymizeMode, setPreferredLocale } from "../../../shared/settings-store";
import { getPathLookup, setPathAliases, deletePathCanonical } from "../../../shared/resolution-store";
import { downloadBackup, parseBackup, restoreBackup } from "../../../shared/backup";
import { confirmModal } from "../../../shared/modal";
import { escapeAttr, escapeHtml } from "../../../shared/dom-utils";
import type { LocalePreference, PathLookup } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

const LOCALE_OPTIONS: LocalePreference[] = ["system", "en", "fr"];

function localeOptionLabel(locale: LocalePreference): string {
  return i18n.t(`globalSettings.locale.option.${locale}.label`);
}

function shellHtml(): string {
  return `
  <div class="page-intro">
    <h1 class="page-title">${escapeHtml(i18n.t("globalSettings.page.title.title"))}</h1>
    <p class="page-intro__desc">${escapeHtml(i18n.t("globalSettings.page.intro.body"))}</p>
  </div>

  <div id="localeSectionRoot"></div>

  <div id="anonymizeSectionRoot"></div>

  <div id="pathLookupSectionRoot"></div>

  <div id="backupSectionRoot"></div>
`;
}

type RestoreStatus = { kind: "ok" | "error"; text: string } | null;

export const globalSettingsView: ViewModule = {
  async mount(root) {
    root.innerHTML = shellHtml();

    // Set true by the disposer — see syncData.ts's mount() for the full
    // writeup of why an in-flight async refresh needs this guard.
    let disposed = false;
    // Tears down a still-open restore confirm modal if the user navigates
    // away mid-decision.
    const restoreAbort = new AbortController();

    // Persisted across renderBackupCard() calls so a "Restored" / error
    // message survives the storage.onChanged-triggered re-render that a
    // successful restore itself causes.
    let restoreStatus: RestoreStatus = null;

    // One hidden file input, reused for every "Load File" click.
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.hidden = true;
    root.appendChild(fileInput);
    fileInput.addEventListener("change", onBackupFileChosen);

    function renderBackupCard() {
      const sectionRoot = root.querySelector("#backupSectionRoot")!;
      const statusClass = restoreStatus?.kind === "error" ? " is-error" : "";
      sectionRoot.innerHTML = `
        <div class="card">
          <div class="card-header"><span class="card-header__title">${escapeHtml(i18n.t("globalSettings.backup.card.title"))}</span></div>
          <div class="card-body">
            <p class="help-text">${escapeHtml(i18n.t("globalSettings.backup.help.body"))}</p>
            <div class="dashboard-tile__actions">
              <button type="button" class="btn btn-secondary" id="settingsSaveBackupBtn" title="${escapeAttr(i18n.t("globalSettings.backup.action.saveFile.tooltip"))}">${escapeHtml(i18n.t("globalSettings.backup.action.saveFile.button"))}</button>
              <button type="button" class="btn btn-secondary" id="settingsLoadBackupBtn" title="${escapeAttr(i18n.t("globalSettings.backup.action.loadFile.tooltip"))}">${escapeHtml(i18n.t("globalSettings.backup.action.loadFile.button"))}</button>
            </div>
            <p class="help-text dashboard-tile__status${statusClass}" aria-live="polite">${restoreStatus ? escapeHtml(restoreStatus.text) : ""}</p>
          </div>
        </div>
      `;

      sectionRoot.querySelector("#settingsSaveBackupBtn")!.addEventListener("click", onSaveBackup);
      sectionRoot.querySelector("#settingsLoadBackupBtn")!.addEventListener("click", () => fileInput.click());
    }

    async function onSaveBackup() {
      restoreStatus = null;
      try {
        await downloadBackup();
        if (disposed) return;
        restoreStatus = { kind: "ok", text: i18n.t("globalSettings.backup.saved.body") };
      } catch (err) {
        restoreStatus = {
          kind: "error",
          text: i18n.t("globalSettings.backup.saveFailed.error", [err instanceof Error ? err.message : String(err)]),
        };
      }
      renderBackupCard();
    }

    async function onBackupFileChosen() {
      const file = fileInput.files?.[0];
      fileInput.value = ""; // allow re-picking the same file later
      if (!file) return;

      restoreStatus = null;
      let backup;
      try {
        backup = parseBackup(await file.text());
      } catch (err) {
        restoreStatus = { kind: "error", text: err instanceof Error ? err.message : String(err) };
        renderBackupCard();
        return;
      }
      if (disposed) return;

      const confirmed = await confirmModal({
        title: i18n.t("globalSettings.backup.confirmModal.title"),
        body: i18n.t("globalSettings.backup.confirmModal.body"),
        confirmLabel: i18n.t("globalSettings.backup.confirmModal.confirmLabel"),
        danger: true,
        signal: restoreAbort.signal,
      });
      if (!confirmed || disposed) return;

      try {
        await restoreBackup(backup);
        if (disposed) return;
        restoreStatus = { kind: "ok", text: i18n.t("globalSettings.backup.restored.body") };
      } catch (err) {
        restoreStatus = {
          kind: "error",
          text: i18n.t("globalSettings.backup.restoreFailed.error", [err instanceof Error ? err.message : String(err)]),
        };
      }
      if (disposed) return;
      renderBackupCard();
    }

    function renderLocaleCard(preferredLocale: LocalePreference) {
      const sectionRoot = root.querySelector("#localeSectionRoot")!;
      const options = LOCALE_OPTIONS.map(
        (locale) =>
          `<option value="${escapeAttr(locale)}"${locale === preferredLocale ? " selected" : ""}>${escapeHtml(localeOptionLabel(locale))}</option>`,
      ).join("");
      sectionRoot.innerHTML = `
        <div class="card">
          <div class="card-header"><span class="card-header__title">${escapeHtml(i18n.t("globalSettings.locale.card.title"))}</span></div>
          <div class="card-body">
            <p class="help-text">${escapeHtml(i18n.t("globalSettings.locale.help.body"))}</p>
            <select id="localeSelect" class="select select-sm appearance-none" aria-label="${escapeAttr(i18n.t("globalSettings.locale.select.ariaLabel"))}">${options}</select>
          </div>
        </div>
      `;

      root.querySelector("#localeSelect")!.addEventListener("change", async (e) => {
        await setPreferredLocale((e.target as HTMLSelectElement).value as LocalePreference);
      });
    }

    function renderAnonymizeCard(anonymize: boolean) {
      const sectionRoot = root.querySelector("#anonymizeSectionRoot")!;
      sectionRoot.innerHTML = `
        <div class="card">
          <div class="card-header"><span class="card-header__title"><span class="settings-lock-icon" aria-hidden="true">${anonymize ? "🔒" : "🔓"}</span>${escapeHtml(i18n.t("globalSettings.anonymize.card.title"))}</span></div>
          <div class="card-body">
            <label class="flex items-center gap-3 mb-2 font-semibold cursor-pointer">
              <input type="checkbox" class="toggle toggle-primary" id="anonymizeModeToggle"${anonymize ? " checked" : ""}>
              <span>${escapeHtml(i18n.t("globalSettings.anonymize.toggle.label"))}</span>
            </label>
            <p class="help-text">${escapeHtml(i18n.t("globalSettings.anonymize.help.aiStats.body"))}</p>
            <p class="help-text">
              ${escapeHtml(i18n.t("globalSettings.anonymize.help.genericLabels.body"))}
            </p>
            <p class="help-text">
              ${escapeHtml(i18n.t("globalSettings.anonymize.help.reviewFirst.body"))}
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
            <td><input type="text" class="input input-xs w-full" data-role="alias-input" value="${escapeAttr(aliases.join(", "))}" aria-label="${escapeAttr(i18n.t("globalSettings.pathLookup.table.aliasInput.ariaLabel", [canonical]))}"></td>
            <td>
              <button class="btn btn-secondary" data-action="save-aliases">${escapeHtml(i18n.t("globalSettings.pathLookup.action.save.button"))}</button>
              <button class="btn btn-secondary" data-action="delete-canonical">${escapeHtml(i18n.t("globalSettings.pathLookup.action.delete.button"))}</button>
            </td>
          </tr>
        `
        )
        .join("");

      const table = rows
        ? `<div class="table-scroll"><table class="data-table lookup"><thead><tr><th>${escapeHtml(i18n.t("globalSettings.pathLookup.table.canonicalName.label"))}</th><th>${escapeHtml(i18n.t("globalSettings.pathLookup.table.alternateSpellings.label"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="empty-state">${escapeHtml(i18n.t("globalSettings.pathLookup.emptyState.noAliases.body"))}</p>`;

      return `
        <div class="card">
          <div class="card-header"><span class="card-header__title">${escapeHtml(i18n.t("globalSettings.pathLookup.card.title"))}</span></div>
          <div class="card-body">
            <p class="help-text">
              ${escapeHtml(i18n.t("globalSettings.pathLookup.help.body"))}
            </p>
            ${table}
            <div class="add-form">
              <input type="text" id="newPathCanonical" class="input input-sm" placeholder="${escapeAttr(i18n.t("globalSettings.pathLookup.newCanonical.placeholder"))}" aria-label="${escapeAttr(i18n.t("globalSettings.pathLookup.newCanonical.ariaLabel"))}">
              <button class="btn btn-primary" data-action="add-canonical">${escapeHtml(i18n.t("globalSettings.pathLookup.action.addPath.button"))}</button>
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
      const [preferredLocale, anonymize] = await Promise.all([getPreferredLocale(), getAnonymizeMode()]);
      if (disposed) return;
      renderLocaleCard(preferredLocale);
      renderAnonymizeCard(anonymize);
      renderBackupCard();
      await refreshPathLookup();
    }

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") init();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await init();

    return () => {
      disposed = true;
      restoreAbort.abort();
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
