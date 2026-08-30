// src/entrypoints/popup/main.ts
//
// The popup is now just the branded header + the vertical stepper — actual
// data extraction (buttons, per-source status, raw data) and the sync/match
// indicators live on the Sync Data page only (entrypoints/sync-data +
// shared/sync-status-panel.ts). The header subtitle is static markup in
// index.html now (no longer data-dependent); this file's job is rendering
// the stepper as a read-only progress indicator (its five info lines come
// from shared/stepper-info.ts, shared with the options pages' horizontal
// stepper) — the only navigation the popup offers is the "Open Home" button
// and the "What's New" footer link — plus telling background the popup was
// opened (see init() below).

import { renderVerticalStepper } from "../../shared/app-shell";
import { escapeHtml } from "../../shared/dom-utils";
import { appRouteUrl, whatsNewUrl } from "../../shared/pages";
import { sendMessage } from "../../shared/send-message";
import { applyPendingSelfUpdate, getPendingSelfUpdate, maybeNudgeUpdateCheck } from "../../shared/self-update-store";
import { computeStepperInfo } from "../../shared/stepper-info";
import { dismissUpdate, getDismissedUpdateVersion, getUpdateCheck, openUpdateRelease } from "../../shared/update-store";

const stepperRoot = document.getElementById("popupStepperRoot")!;
const updateBannerRoot = document.getElementById("updateBannerRoot")!;
const selfUpdateBannerRoot = document.getElementById("selfUpdateBannerRoot")!;

// The vertical stepper is read-only — it just shows where the user is in
// setup. The only navigation the popup offers is "Open Home" and the
// "What's New" footer link below.
document
  .getElementById("popupHomeBtn")!
  .addEventListener("click", () => browser.tabs.create({ url: appRouteUrl("dashboard") }));

const whatsNewLink = document.getElementById("popupWhatsNewLink")!;
whatsNewLink.addEventListener("click", (e) => {
  e.preventDefault();
  browser.tabs.create({ url: whatsNewUrl() });
});

init();

async function init() {
  // Tells background this counts as "having seen" any finished (success/
  // error) result, reverting the toolbar icon to idle — a still-loading
  // source is left alone. The popup itself no longer shows per-source
  // status (that moved to Sync Data), but opening it still counts as
  // acknowledging the toolbar icon. Fire-and-forget: its result isn't used
  // here, and it must never block the stepper below from rendering — a
  // dropped response (e.g. Firefox's message-port teardown quirk) would
  // otherwise leave the popup blank.
  sendMessage({ type: "POPUP_OPENED" }).catch(() => {});

  // The three data fetches below are fully independent (disjoint storage
  // keys, disjoint DOM containers), so they're run concurrently and their
  // DOM writes applied back-to-back with no await between them. Extension
  // popups auto-size to content and re-run that sizing on every mutation —
  // awaiting each render in sequence used to produce three visibly separate
  // resize "jumps" right after opening; batching the writes collapses that
  // into one.
  const [stepperInfo, updateBannerData, selfUpdatePending] = await Promise.all([
    computeStepperInfo(),
    loadUpdateBannerData(),
    getPendingSelfUpdate(),
  ]);

  stepperRoot.innerHTML = renderVerticalStepper(stepperInfo);
  applyUpdateBanner(updateBannerData);
  applySelfUpdateBanner(selfUpdatePending);

  void maybeNudgeUpdateCheck();
}

// No-op on the store build — updateCheck is only ever written by the preview
// build's background/api/update-checker.ts, so this always finds nothing.
async function loadUpdateBannerData() {
  const [update, dismissedVersion] = await Promise.all([getUpdateCheck(), getDismissedUpdateVersion()]);
  return !update || update.latestVersion === dismissedVersion ? null : update;
}

function applyUpdateBanner(update: Awaited<ReturnType<typeof loadUpdateBannerData>>) {
  if (!update) {
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

// pendingSelfUpdate is only ever set by background/self-update.ts's
// onUpdateAvailable listener, which the browser fires rarely — only once it
// has already downloaded a genuinely newer version of this extension. No
// Dismiss button here (unlike renderUpdateBanner() above): there's nothing
// meaningful to dismiss into, the browser will apply the update on its own
// eventually regardless.
function applySelfUpdateBanner(pending: Awaited<ReturnType<typeof getPendingSelfUpdate>>) {
  if (!pending) {
    selfUpdateBannerRoot.innerHTML = "";
    return;
  }

  selfUpdateBannerRoot.innerHTML = `
    <div class="update-banner">
      <span>Update ready: v${escapeHtml(pending.version)}</span>
      <span class="update-banner__actions">
        <button id="selfUpdateApplyBtn" class="btn btn-primary">Update now</button>
      </span>
    </div>
  `;

  document.getElementById("selfUpdateApplyBtn")!.addEventListener("click", () => {
    void applyPendingSelfUpdate(); // reload() tears down this popup's own context almost immediately
  });
}
