// src/popup/index.ts

import { local } from "../shared/storage";
import { pageUrl } from "../shared/pages";
import { sendMessage } from "../shared/send-message";
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

const reportEls = {
  btn: document.getElementById("openReportBtn") as HTMLButtonElement,
  reviewMatchesBtn: document.getElementById("reviewMatchesBtn") as HTMLButtonElement,
  status: document.getElementById("statusReport")!,
};

init();

async function init() {
  // Tells background this counts as "having seen" any finished (success/
  // error) result, reverting the toolbar icon to idle — a still-loading
  // source is left alone. Also gives us the current per-source status so
  // we know whether to disable a button below.
  const statuses = (await sendMessage({ type: "POPUP_OPENED" })) || { basecamp: "idle", easyspeak: "idle" };

  // If we already have cached extractions, show them when the popup opens
  // — including while a scrape might currently be running, so there's
  // always something to look at rather than a blank panel.
  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);

  if (cached.basecampData) {
    setStatus(basecampEls, `Last extraction: ${formatDate(cached.basecampScrapedAt)}`);
    renderScrapeResult(basecampEls, cached.basecampData);
  }

  if (cached.easyspeakData) {
    setStatus(easyspeakEls, `Last extraction: ${formatDate(cached.easyspeakScrapedAt)}`);
    renderScrapeResult(easyspeakEls, cached.easyspeakData);
  }

  updateReportButton(!!cached.basecampData, !!cached.easyspeakData);
  const { basecampData, easyspeakData } = await renderStatusSummary({ basecamp: statuses.basecamp === "loading", easyspeak: statuses.easyspeak === "loading" });
  updatePopupSubtitle(basecampData, easyspeakData);

  // Reopening the popup while a scrape is still running elsewhere (e.g. an
  // EasySpeak tab that survived the popup's own teardown) would otherwise
  // show this stale "Last extraction: ..." line right next to a
  // disabled/relabeled button — set it explicitly so the two agree.
  if (statuses.basecamp === "loading") setStatus(basecampEls, "Still extracting… this can take a minute or two.");
  if (statuses.easyspeak === "loading") setStatus(easyspeakEls, "Still extracting… this can take a minute or two.");

  setButtonLoading(basecampEls, statuses.basecamp === "loading", "Basecamp data loading...");
  setButtonLoading(easyspeakEls, statuses.easyspeak === "loading", "EasySpeak data loading...");

  basecampEls.btn.addEventListener("click", () =>
    onScrapeClick<BasecampScrape>({
      els: basecampEls,
      message: { type: "SCRAPE_BASECAMP" },
      dataKey: "basecampData",
      scrapedAtKey: "basecampScrapedAt",
      loadingLabel: "Basecamp data loading...",
      render: renderScrapeResult,
      onDone: onScrapeDone,
    })
  );

  easyspeakEls.btn.addEventListener("click", () => {
    // Set synchronously, before onScrapeClick's internal sendMessage() is
    // awaited — ensureEasySpeakTab() steals focus almost immediately, and
    // Chrome tears down this popup the instant it loses focus, so anything
    // set after the await may never actually render.
    setStatus(easyspeakEls, "Opening an EasySpeak tab now — this will close the popup (that's expected). Reopen it once the tab finishes or closes itself to see the result.");
    onScrapeClick<EasySpeakScrape>({
      els: easyspeakEls,
      message: { type: "SCRAPE_EASYSPEAK" },
      dataKey: "easyspeakData",
      scrapedAtKey: "easyspeakScrapedAt",
      loadingLabel: "EasySpeak data loading...",
      render: renderScrapeResult,
      onDone: onScrapeDone,
    });
  });

  reportEls.btn.addEventListener("click", () => chrome.tabs.create({ url: pageUrl("options/report.html") }));

  reportEls.reviewMatchesBtn.addEventListener("click", () => chrome.tabs.create({ url: pageUrl("options/members.html") }));

  // Never disabled — Setup (mock mode, EasySpeak server) is meaningful to
  // change before any extraction exists, unlike the report/review buttons.
  document.getElementById("openSettingsLink")!.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: pageUrl("options/settings.html") });
  });
}

async function onScrapeDone() {
  const { basecampData, easyspeakData } = await renderStatusSummary();
  updateReportButton(!!basecampData, !!easyspeakData);
  updatePopupSubtitle(basecampData, easyspeakData);
}

// Enables the report/review-matches buttons only once both sources have
// data cached — called on popup open and again after each successful
// scrape, so they go live the moment the second source finishes without
// needing a reopen.
function updateReportButton(hasBasecamp: boolean, hasEasyspeak: boolean) {
  const disabled = !(hasBasecamp && hasEasyspeak);
  reportEls.btn.disabled = disabled;
  reportEls.reviewMatchesBtn.disabled = disabled;
  reportEls.status.textContent = disabled ? "Extract both Basecamp and EasySpeak data first." : "";
}

// ---------------------------------------------------------------------------
// Branded-header subtitle — popup-only (options/sync-data.ts has no
// equivalent element), so it stays here rather than in
// shared/sync-status-panel.ts.
// ---------------------------------------------------------------------------

function updatePopupSubtitle(basecampData: BasecampScrape | null | undefined, easyspeakData: EasySpeakScrape | null | undefined) {
  const el = document.getElementById("popupSubtitle")!;
  const data = basecampData ?? easyspeakData;
  const count = data ? Object.keys(data).length : 0;
  el.textContent = count > 0 ? `${count} club${count === 1 ? "" : "s"} tracked` : "";
}
