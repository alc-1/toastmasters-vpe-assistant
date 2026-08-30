// src/entrypoints/app/views/exporter.ts
//
// The standalone "Download Excel Spreadsheet" view, reached from the Home
// dashboard's feature card (#exporter). The same export previously only
// existed as a popover inside the Sync Data view — this view reuses the exact
// same pieces (shared/export/export-to-excel.ts's exportToExcel(), the
// ExportType label/description maps in shared/export/rows.ts).
//
// Gated: entrypoints/app/router.ts redirects #exporter → #dashboard until a
// profile is chosen and both sources are imported (areFeaturesUnlocked), and
// main.ts's storage.onChanged re-navigation re-applies that if data is
// cleared while this view is open — so this view can assume data is present.

import { exportToExcel } from "../../../shared/export/export-to-excel";
import { EXPORT_OPTION_DESC, EXPORT_TYPE_LABEL, type ExportType } from "../../../shared/export/rows";
import { getAnonymizeMode } from "../../../shared/settings-store";
import { escapeHtml } from "../../../shared/dom-utils";
import type { ViewModule } from "../../../shared/view";

const EXPORT_TYPES: ExportType[] = ["all", "basecamp", "easyspeak"];

const SHELL_HTML = `
  <div class="page-intro">
    <h1 class="page-title">Download Excel Spreadsheet</h1>
    <p class="page-intro__desc">Export member and path data to an Excel file.</p>
  </div>

  <div class="card">
    <div class="card-header"><span class="card-header__title">Choose what to export</span></div>
    <div class="card-body">
      <div id="exporterOptionsRoot" class="export-options"></div>
      <p id="exporterAnonymizeNotice" class="help-text" aria-live="polite"></p>
      <button id="exporterCreateBtn" class="btn btn-primary">Create Spreadsheet</button>
      <p id="exporterStatus" class="help-text" aria-live="polite"></p>
    </div>
  </div>
`;

export const exporterView: ViewModule = {
  async mount(root) {
    root.innerHTML = SHELL_HTML;

    // See syncData.ts's mount() for the disposed-guard rationale.
    let disposed = false;

    let selected: ExportType = "all";

    const optionsRoot = root.querySelector("#exporterOptionsRoot")!;
    const notice = root.querySelector("#exporterAnonymizeNotice")!;
    const createBtn = root.querySelector("#exporterCreateBtn") as HTMLButtonElement;
    const status = root.querySelector("#exporterStatus")!;
    const idleLabel = createBtn.textContent ?? "Create Spreadsheet";

    function renderOptions() {
      optionsRoot.innerHTML = EXPORT_TYPES.map((type) => {
        const isSelected = selected === type;
        return `
          <label class="option-card${isSelected ? " selected" : ""}">
            <input type="radio" name="exporterType" value="${type}"${isSelected ? " checked" : ""}>
            <span class="option-card__body">
              <span class="option-card__title">${escapeHtml(EXPORT_TYPE_LABEL[type])}</span>
              <span class="option-card__desc">${escapeHtml(EXPORT_OPTION_DESC[type])}</span>
            </span>
          </label>
        `;
      }).join("");

      optionsRoot.querySelectorAll<HTMLInputElement>('input[name="exporterType"]').forEach((input) => {
        input.addEventListener("change", () => {
          selected = input.value as ExportType;
          renderOptions();
        });
      });
    }

    async function refreshNotice() {
      const anonymize = await getAnonymizeMode();
      if (disposed) return;
      notice.textContent = anonymize ? "Privacy Mode is on — this spreadsheet will use anonymized names." : "";
    }

    createBtn.addEventListener("click", async () => {
      createBtn.disabled = true;
      createBtn.textContent = "Generating…";
      status.textContent = "";
      try {
        const summary = await exportToExcel(selected);
        status.innerHTML = `✓ Downloaded <ins>${escapeHtml(summary.filename)}</ins>`;
      } catch (err) {
        status.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        createBtn.disabled = false;
        createBtn.textContent = idleLabel;
      }
    });

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") refreshNotice();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    renderOptions();
    await refreshNotice();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
