// src/entrypoints/popup/main.ts
//
// The popup is now just the branded header + the vertical stepper — actual
// data extraction (buttons, per-source status, raw data) and the sync/match
// indicators live on the Sync Data page only (entrypoints/sync-data +
// shared/sync-status-panel.ts). The header subtitle is static markup in
// index.html now (no longer data-dependent); this file's job is rendering
// the stepper (its five info lines come from shared/stepper-info.ts, shared
// with the options pages' horizontal stepper), plus telling background the
// popup was opened (see init() below).

import { renderVerticalStepper, type AppShellPage } from "../../shared/app-shell";
import { escapeHtml, settingsIconHtml } from "../../shared/dom-utils";
import { focusOrOpenAppTab } from "../../shared/app-tab";
import { sendMessage } from "../../shared/send-message";
import { computeStepperInfo } from "../../shared/stepper-info";
import { dismissUpdate, getDismissedUpdateVersion, getUpdateCheck, openUpdateRelease } from "../../shared/update-store";

const stepperRoot = document.getElementById("popupStepperRoot")!;
const updateBannerRoot = document.getElementById("updateBannerRoot")!;
const settingsBtn = document.getElementById("popupSettingsBtn")!;
settingsBtn.innerHTML = settingsIconHtml();
settingsBtn.addEventListener("click", () => focusOrOpenAppTab("globalSettings"));

// Delegated once — renderPopup() replaces stepperRoot's innerHTML on every
// call, but the root element itself never changes, so a single delegated
// listener covers every re-render without needing to be re-attached.
stepperRoot.addEventListener("click", (e) => {
  const step = (e.target as HTMLElement).closest<HTMLElement>("[data-page-key]");
  if (!step) return;
  e.preventDefault();
  const key = step.dataset.pageKey as AppShellPage;
  focusOrOpenAppTab(key);
});

init();

async function init() {
  // Tells background this counts as "having seen" any finished (success/
  // error) result, reverting the toolbar icon to idle — a still-loading
  // source is left alone. The popup itself no longer shows per-source
  // status (that moved to Sync Data), but opening it still counts as
  // acknowledging the toolbar icon.
  await sendMessage({ type: "POPUP_OPENED" });
  await renderPopup();
  await renderUpdateBanner();
}

async function renderPopup() {
  const info = await computeStepperInfo();
  stepperRoot.innerHTML = renderVerticalStepper(info);
}

// No-op on the store build — updateCheck is only ever written by the preview
// build's background/api/update-checker.ts, so this always finds nothing.
async function renderUpdateBanner() {
  const [update, dismissedVersion] = await Promise.all([getUpdateCheck(), getDismissedUpdateVersion()]);
  if (!update || update.latestVersion === dismissedVersion) {
    updateBannerRoot.innerHTML = "";
    return;
  }

  updateBannerRoot.innerHTML = `
    <div class="update-banner">
      <span>Update available: v${escapeHtml(update.latestVersion)}</span>
      <span class="update-banner__actions">
        <button id="updateDownloadBtn" class="btn btn-primary">Download</button>
        <button id="updateDismissBtn" class="btn btn-secondary">Dismiss</button>
      </span>
    </div>
  `;

  document.getElementById("updateDownloadBtn")!.addEventListener("click", async () => {
    await openUpdateRelease(update);
    updateBannerRoot.innerHTML = "";
  });
  document.getElementById("updateDismissBtn")!.addEventListener("click", async () => {
    await dismissUpdate(update.latestVersion);
    updateBannerRoot.innerHTML = "";
  });
}
