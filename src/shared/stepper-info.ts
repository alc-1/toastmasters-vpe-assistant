// src/shared/stepper-info.ts
//
// Computes the five per-step info lines (e.g. "12 clubs followed") shown
// under each step's label — used by both the popup's vertical stepper and
// every options page's horizontal one (shared/app-shell.ts), so neither has
// to duplicate the storage reads + buildReport() call this requires.

import { loadResolutionData } from "./resolution-store";
import { EASYSPEAK_SERVERS, getActiveProfile, getEasySpeakServer, getMockMode } from "./settings-store";
import { local } from "./storage";
import { buildReport, computeMatchSummary, countMembersReadyForNextLevel } from "./sync/delta";
import { formatDate } from "./sync-status-panel";
import type { StepperInfo } from "./app-shell";
import type { ReportResult } from "./types";

export async function computeStepperInfo(): Promise<StepperInfo> {
  const [activeProfile, cached] = await Promise.all([
    getActiveProfile(),
    local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]),
  ]);

  const setupInfo = activeProfile === null ? "Select your profile" : await formatSetupInfo();
  const basecampData = cached.basecampData ?? null;
  const easyspeakData = cached.easyspeakData ?? null;
  const noProfile = activeProfile === null;
  const hasBothData = !!basecampData && !!easyspeakData;

  const syncDisabled = noProfile;
  const clubReviewDisabled = noProfile || !hasBothData;

  let clubReviewPending = false;
  let reportInfo: ReportStepInfo | null = null;
  if (hasBothData) {
    const resolution = await loadResolutionData();
    const report = buildReport(basecampData!, easyspeakData!, {}, resolution);
    // A fuzzy-confidence club-name guess is dropped from buildReport()'s own
    // matchClubs(..., allowFuzzy: false) call, so an unconfirmed suggestion
    // already surfaces here as two one-sided pairs — this check doubles as
    // "any club still needs review in Club Review" without a second matchClubs() call.
    clubReviewPending = report.clubPairs.some((pair) => pair.basecampClubId === null || pair.easyspeakClubId === null);
    reportInfo = computeReportInfo(report);
  }

  const membersDisabled = noProfile || !hasBothData || clubReviewPending;
  const reportDisabled = membersDisabled;

  const clubReviewDone = hasBothData && !clubReviewPending;
  const membersPending = (reportInfo?.toReview ?? 0) > 0;
  const membersDone = clubReviewDone && !membersPending;

  return {
    settings: { info: setupInfo, done: !noProfile },
    syncData: {
      info: syncDisabled ? undefined : formatOldestSync(cached.basecampScrapedAt, cached.easyspeakScrapedAt),
      disabled: syncDisabled,
      done: hasBothData,
    },
    clubReview: { info: clubReviewDisabled ? undefined : reportInfo?.clubs, disabled: clubReviewDisabled, done: clubReviewDone },
    members: { info: membersDisabled ? undefined : reportInfo?.members, disabled: membersDisabled, done: membersDone, warning: membersPending },
    report: { info: reportDisabled ? undefined : reportInfo?.nextLevel, disabled: reportDisabled, done: membersDone },
  };
}

async function formatSetupInfo(): Promise<string> {
  if (await getMockMode()) return "Profile: Demo";
  const serverId = await getEasySpeakServer();
  const region = EASYSPEAK_SERVERS.find((s) => s.id === serverId)?.region ?? serverId;
  return `Profile: ${region}`;
}

function formatOldestSync(basecampScrapedAt?: number, easyspeakScrapedAt?: number): string {
  if (typeof basecampScrapedAt !== "number" || typeof easyspeakScrapedAt !== "number") return "Start the data retrieval";
  return `Oldest: ${formatDate(Math.min(basecampScrapedAt, easyspeakScrapedAt))}`;
}

interface ReportStepInfo {
  clubs: string;
  members: string;
  nextLevel: string;
  toReview: number;
}

// Only called once both sources are extracted (see computeStepperInfo above)
// and clubReviewPending has already been derived from this same report.
function computeReportInfo(report: ReportResult): ReportStepInfo {
  const clubCount = report.clubPairs.length;
  const { matched, total } = computeMatchSummary(report);
  const toReview = total - matched;
  const readyForNextLevel = countMembersReadyForNextLevel(report);

  return {
    clubs: `${clubCount} club${clubCount === 1 ? "" : "s"} followed`,
    members: `${total} member${total === 1 ? "" : "s"} · ${toReview} to review`,
    nextLevel: toReview > 0 ? "Review members first" : `${readyForNextLevel} member${readyForNextLevel === 1 ? "" : "s"} ready for next level`,
    toReview,
  };
}
