// src/options/sync-data.ts
//
// Thin page wired up against shared/sync-status-panel.ts: same markup/ids as
// the popup's Data Extraction card + sync-status summary, same underlying
// rendering/formatting/scrape-click logic — see that module for why it's
// shared rather than duplicated.

import { local } from "../shared/storage";
import { sendMessage } from "../shared/send-message";
import { renderAppShell } from "../shared/app-shell";
import { computeStepperInfo } from "../shared/stepper-info";
import {
  bindSourceEls,
  formatDate,
  onScrapeClick,
  renderScrapeResult,
  renderStatusSummary,
  setButtonLoading,
  setStatus,
  type SourceEls,
} from "../shared/sync-status-panel";
import type { BasecampScrape, EasySpeakScrape } from "../shared/types";

const basecampEls: SourceEls = bindSourceEls({ btn: "scrapeBasecampBtn", status: "statusBasecamp", summary: "summaryBasecamp", rawData: "rawDataBasecamp" });
const easyspeakEls: SourceEls = bindSourceEls({ btn: "scrapeEasySpeakBtn", status: "statusEasySpeak", summary: "summaryEasySpeak", rawData: "rawDataEasySpeak" });

// Attached once, at module load, rather than inside init() — init() can run
// more than once per page load (see the chrome.storage.onChanged listener
// below), and re-attaching these listeners on every call would stack a new
// one each time instead of replacing it, since basecampEls.btn/
// easyspeakEls.btn are module-level elements whose innerHTML is never
// replaced by rendering. A single click previously fired the handler once
// per accumulated listener, each sending its own SCRAPE_EASYSPEAK/
// SCRAPE_BASECAMP message and opening its own EasySpeak tab.
basecampEls.btn.addEventListener("click", () =>
  onScrapeClick<BasecampScrape>({
    els: basecampEls,
    message: { type: "SCRAPE_BASECAMP" },
    loadingLabel: "Basecamp data loading...",
    render: renderScrapeResult,
    onDone: async () => {
      await renderStatusSummary();
    },
  })
);

easyspeakEls.btn.addEventListener("click", () =>
  onScrapeClick<EasySpeakScrape>({
    els: easyspeakEls,
    message: { type: "SCRAPE_EASYSPEAK" },
    loadingLabel: "EasySpeak data loading...",
    render: renderScrapeResult,
    onDone: async () => {
      await renderStatusSummary();
    },
  })
);

init();

// Keeps this tab in sync if a scrape started elsewhere (e.g. the popup)
// finishes while this one stays open — the popup doesn't need this since
// it's re-created fresh on each open, but this is a regular tab that can
// stay open indefinitely.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "syncData", info: stepperInfo });

  // Tells background this counts as "having seen" any finished (success/
  // error) result, reverting the toolbar icon to idle — a still-loading
  // source is left alone. Also gives us the current per-source status so
  // we know whether to disable a button below.
  const statuses = (await sendMessage({ type: "POPUP_OPENED" })) || { basecamp: "idle", easyspeak: "idle" };

  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);

  if (cached.basecampData) {
    setStatus(basecampEls, `Last extraction: ${formatDate(cached.basecampScrapedAt)}`);
    renderScrapeResult(basecampEls, cached.basecampData);
  }

  if (cached.easyspeakData) {
    setStatus(easyspeakEls, `Last extraction: ${formatDate(cached.easyspeakScrapedAt)}`);
    renderScrapeResult(easyspeakEls, cached.easyspeakData);
  }

  await renderStatusSummary({ basecamp: statuses.basecamp === "loading", easyspeak: statuses.easyspeak === "loading" });

  if (statuses.basecamp === "loading") setStatus(basecampEls, "Still extracting… this can take a minute or two.");
  if (statuses.easyspeak === "loading") setStatus(easyspeakEls, "Still extracting… this can take a minute or two.");

  setButtonLoading(basecampEls, statuses.basecamp === "loading", "Basecamp data loading...");
  setButtonLoading(easyspeakEls, statuses.easyspeak === "loading", "EasySpeak data loading...");
}
