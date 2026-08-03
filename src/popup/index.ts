// src/popup/index.ts
//
// The popup is now just the branded header + the vertical stepper — actual
// data extraction (buttons, per-source status, raw data) and the sync/match
// indicators live on the Sync Data page only (options/sync-data.html +
// shared/sync-status-panel.ts). This file's only two jobs are rendering the
// header subtitle (read straight from storage) and the stepper (its five
// info lines come from shared/stepper-info.ts, shared with the options
// pages' horizontal stepper), plus telling background the popup was opened
// (see init() below).

import { renderVerticalStepper } from "../shared/app-shell";
import { local } from "../shared/storage";
import { PAGES, pageUrl } from "../shared/pages";
import { sendMessage } from "../shared/send-message";
import { computeStepperInfo } from "../shared/stepper-info";
import type { BasecampScrape, EasySpeakScrape } from "../shared/types";

const stepperRoot = document.getElementById("popupStepperRoot")!;

// Delegated once — renderPopup() replaces stepperRoot's innerHTML on every
// call, but the root element itself never changes, so a single delegated
// listener covers every re-render without needing to be re-attached.
stepperRoot.addEventListener("click", (e) => {
  const step = (e.target as HTMLElement).closest<HTMLElement>("[data-page-key]");
  if (!step) return;
  e.preventDefault();
  const key = step.dataset.pageKey as keyof typeof PAGES;
  chrome.tabs.create({ url: pageUrl(PAGES[key]) });
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
}

async function renderPopup() {
  const [info, cached] = await Promise.all([
    computeStepperInfo(),
    local.get(["basecampData", "easyspeakData"]),
  ]);

  updatePopupSubtitle(cached.basecampData ?? null, cached.easyspeakData ?? null);

  stepperRoot.innerHTML = renderVerticalStepper(info);
}

// ---------------------------------------------------------------------------
// Branded-header subtitle — popup-only (options/sync-data.ts has no
// equivalent element), so it stays here rather than in
// shared/sync-status-panel.ts.
// ---------------------------------------------------------------------------

function updatePopupSubtitle(basecampData: BasecampScrape | null, easyspeakData: EasySpeakScrape | null) {
  const el = document.getElementById("popupSubtitle")!;
  const data = basecampData ?? easyspeakData;
  const count = data ? Object.keys(data).length : 0;
  el.textContent = count > 0 ? `${count} club${count === 1 ? "" : "s"} followed` : "";
}
