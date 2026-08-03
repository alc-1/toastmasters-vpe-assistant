// src/popup/index.ts
//
// The popup is now just the branded header + the vertical stepper — actual
// data extraction (buttons, per-source status, raw data) and the sync/match
// indicators live on the Sync Data page only (options/sync-data.html +
// shared/sync-status-panel.ts). This file's only two jobs are rendering the
// header subtitle and the stepper's five info lines, both read straight from
// storage, plus telling background the popup was opened (see init() below).

import { renderVerticalStepper } from "../shared/app-shell";
import { local } from "../shared/storage";
import { PAGES, pageUrl } from "../shared/pages";
import { loadResolutionData } from "../shared/resolution-store";
import { sendMessage } from "../shared/send-message";
import { getEasySpeakServer, getMockMode } from "../shared/settings-store";
import { buildReport, computeMatchSummary, countMembersReadyForNextLevel } from "../shared/sync/delta";
import { formatDate } from "../shared/sync-status-panel";
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
  const [setupInfo, cached] = await Promise.all([
    formatSetupInfo(),
    local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]),
  ]);

  updatePopupSubtitle(cached.basecampData ?? null, cached.easyspeakData ?? null);

  const reportInfo = await computeReportInfo(cached.basecampData ?? null, cached.easyspeakData ?? null);

  stepperRoot.innerHTML = renderVerticalStepper({
    settings: setupInfo,
    syncData: formatOldestSync(cached.basecampScrapedAt, cached.easyspeakScrapedAt),
    clubReview: reportInfo.clubs,
    members: reportInfo.members,
    report: reportInfo.nextLevel,
  });
}

async function formatSetupInfo(): Promise<string> {
  if (await getMockMode()) return "Mock mode";
  const serverId = await getEasySpeakServer();
  return `EasySpeak: ${serverId}`;
}

function formatOldestSync(basecampScrapedAt?: number, easyspeakScrapedAt?: number): string {
  const timestamps = [basecampScrapedAt, easyspeakScrapedAt].filter((t): t is number => typeof t === "number");
  if (timestamps.length === 0) return "Not synced yet";
  return `Oldest: ${formatDate(Math.min(...timestamps))}`;
}

interface ReportStepInfo {
  clubs: string;
  members: string;
  nextLevel: string;
}

// Both sources are needed to build any meaningful ReportResult (same
// requirement report.ts/members.ts already enforce) — with only one or
// neither extracted yet, these three steps just point back at Sync Data.
async function computeReportInfo(basecampData: BasecampScrape | null, easyspeakData: EasySpeakScrape | null): Promise<ReportStepInfo> {
  if (!basecampData || !easyspeakData) {
    const notReady = "Extract both sources first";
    return { clubs: notReady, members: notReady, nextLevel: notReady };
  }

  const resolution = await loadResolutionData();
  const report = buildReport(basecampData, easyspeakData, {}, resolution);
  const clubCount = report.clubPairs.length;
  const { matched, total } = computeMatchSummary(report);
  const toReview = total - matched;
  const readyForNextLevel = countMembersReadyForNextLevel(report);

  return {
    clubs: `${clubCount} club${clubCount === 1 ? "" : "s"} followed`,
    members: `${total} member${total === 1 ? "" : "s"} · ${toReview} to review`,
    nextLevel: `${readyForNextLevel} member${readyForNextLevel === 1 ? "" : "s"} ready for next level`,
  };
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
