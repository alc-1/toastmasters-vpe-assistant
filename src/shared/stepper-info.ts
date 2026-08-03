// src/shared/stepper-info.ts
//
// Computes the five per-step info lines (e.g. "12 clubs followed") shown
// under each step's label — used by both the popup's vertical stepper and
// every options page's horizontal one (shared/app-shell.ts), so neither has
// to duplicate the storage reads + buildReport() call this requires.

import { loadResolutionData } from "./resolution-store";
import { EASYSPEAK_SERVERS, getEasySpeakServer, getMockMode } from "./settings-store";
import { local } from "./storage";
import { buildReport, computeMatchSummary, countMembersReadyForNextLevel } from "./sync/delta";
import { formatDate } from "./sync-status-panel";
import type { StepperInfo } from "./app-shell";
import type { BasecampScrape, EasySpeakScrape } from "./types";

export async function computeStepperInfo(): Promise<StepperInfo> {
  const [setupInfo, cached] = await Promise.all([
    formatSetupInfo(),
    local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]),
  ]);

  const reportInfo = await computeReportInfo(cached.basecampData ?? null, cached.easyspeakData ?? null);

  return {
    settings: setupInfo,
    syncData: formatOldestSync(cached.basecampScrapedAt, cached.easyspeakScrapedAt),
    clubReview: reportInfo.clubs,
    members: reportInfo.members,
    report: reportInfo.nextLevel,
  };
}

async function formatSetupInfo(): Promise<string> {
  if (await getMockMode()) return "Demo mode";
  const serverId = await getEasySpeakServer();
  const region = EASYSPEAK_SERVERS.find((s) => s.id === serverId)?.region ?? serverId;
  return region;
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
