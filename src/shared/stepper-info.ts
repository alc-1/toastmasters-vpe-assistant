// src/shared/stepper-info.ts
//
// Computes the five per-step info lines (e.g. "12 clubs followed") shown
// under each step's label — used by both the popup's vertical stepper and
// every options page's horizontal one (shared/app-shell.ts), so neither has
// to duplicate the storage reads + buildReport() call this requires.

import { loadResolutionData } from "./resolution-store";
import { EASYSPEAK_SERVERS, getActiveProfile, getAnonymizeMode, getEasySpeakServer, getMockMode } from "./settings-store";
import { local } from "./storage";
import { buildReport, computeMatchSummary, countMembersReadyForNextLevel, isMemberResolved } from "./sync/delta";
import { NAV_ITEMS, type AppShellPage, type StepperInfo } from "./app-shell";
import type { ReportResult } from "./types";

/** Which steps the current profile has reached at least once — see
 *  markStepVisited() below. Profile-scoped (shared/storage.ts), so switching
 *  profiles (or re-entering the always-wiped Demo profile) naturally resets
 *  this alongside that profile's own data. */
export async function getVisitedSteps(): Promise<AppShellPage[]> {
  return (await local.value("visitedSteps")) ?? [];
}

/** Called by every options page on load, marking the page itself visited —
 *  this is what unlocks a step for free direct stepper navigation from then
 *  on (see computeStepperInfo()'s `locked` computation below). Guarded
 *  against a redundant write: every page re-runs its init() on
 *  browser.storage.onChanged, so writing unconditionally would re-trigger
 *  itself every time. */
export async function markStepVisited(step: AppShellPage): Promise<void> {
  const visited = await getVisitedSteps();
  if (visited.includes(step)) return;
  await local.set({ visitedSteps: [...visited, step] });
}

export async function computeStepperInfo(): Promise<StepperInfo> {
  const [activeProfile, cached, visited, anonymize] = await Promise.all([
    getActiveProfile(),
    local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]),
    getVisitedSteps(),
    getAnonymizeMode(),
  ]);

  // Index 0 (setup/Setup) is never locked — it's the entry point, reached
  // without a prior Next click.
  const isLocked = (key: AppShellPage): boolean =>
    NAV_ITEMS.findIndex((item) => item.key === key) > 0 && !visited.includes(key);

  const setupInfo = activeProfile === null ? "Select your profile" : await formatSetupInfo();
  const basecampData = cached.basecampData ?? null;
  const easyspeakData = cached.easyspeakData ?? null;
  const noProfile = activeProfile === null;
  const hasBothData = !!basecampData && !!easyspeakData;

  const syncDisabled = noProfile;
  // Anonymize Mode (see shared/anonymize.ts) replaces every real name with a
  // generic label, so name-based matching (this page's whole purpose) can't
  // be done while it's on — see Global Settings (shared/pages.ts's
  // PAGES.globalSettings).
  const clubReviewDisabled = noProfile || !hasBothData || anonymize;

  let clubReviewPending = false;
  let reportInfo: ReportStepInfo | null = null;
  if (hasBothData) {
    const resolution = await loadResolutionData();
    const report = buildReport(basecampData!, easyspeakData!, {}, resolution);
    // A fuzzy-confidence club-name guess is dropped from buildReport()'s own
    // matchClubs(..., allowFuzzy: false) call, so an unconfirmed suggestion
    // already surfaces here as two one-sided pairs — this check doubles as
    // "any club still needs review in Club Review" without a second matchClubs() call.
    clubReviewPending = report.clubPairs.some(
      (pair) => (pair.basecampClubId === null || pair.easyspeakClubId === null) && !pair.clubOrphaned
    );
    reportInfo = computeReportInfo(report);
  }

  // reportDisabled deliberately keeps the pre-Anonymize-Mode formula (NOT
  // gated on `anonymize`) — Club Progress must stay reachable while
  // Anonymize Mode is on, that's the entire point of the feature. Only
  // Member Review additionally requires it to be off.
  const reportDisabled = noProfile || !hasBothData || clubReviewPending;
  const membersDisabled = reportDisabled || anonymize;

  const clubReviewDone = hasBothData && !clubReviewPending;
  const membersPending = (reportInfo?.toReview ?? 0) > 0;
  const membersDone = clubReviewDone && !membersPending;

  return {
    setup: { info: setupInfo, done: !noProfile },
    syncData: {
      info: syncDisabled ? undefined : formatOldestSync(cached.basecampScrapedAt, cached.easyspeakScrapedAt),
      disabled: syncDisabled,
      done: hasBothData,
      locked: isLocked("syncData"),
    },
    clubReview: {
      info: clubReviewDisabled ? undefined : reportInfo?.clubs,
      disabled: clubReviewDisabled,
      done: clubReviewDone,
      locked: isLocked("clubReview"),
    },
    members: {
      info: membersDisabled ? undefined : reportInfo?.members,
      disabled: membersDisabled,
      done: membersDone,
      warning: membersPending,
      locked: isLocked("members"),
    },
    report: {
      info: reportDisabled ? undefined : reportInfo?.nextLevel,
      disabled: reportDisabled,
      done: membersDone,
      locked: isLocked("report"),
    },
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
  return `Updated ${formatRelativeTime(Math.min(basecampScrapedAt, easyspeakScrapedAt))}`;
}

// Granularity intentionally caps at weeks — a sync this stale is a "go
// re-extract" situation regardless of whether it's 3 weeks or 3 months old.
function formatRelativeTime(timestamp: number): string {
  const diffMinutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;
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
  const { total } = computeMatchSummary(report);
  // An acknowledged one-sided club (clubOrphaned) has no counterpart club to
  // match its members against at all, so every one of its members is
  // permanently unresolved by isMemberResolved()'s definition — counting
  // them toward "to review" would inflate that number forever with work
  // that can never actually be done. Excluded here only, not from `total`
  // above, so the member headcount itself stays accurate.
  const toReview = report.clubPairs
    .filter((club) => !club.clubOrphaned)
    .reduce((count, club) => count + club.members.filter((member) => !isMemberResolved(member)).length, 0);
  const readyForNextLevel = countMembersReadyForNextLevel(report);

  return {
    clubs: `${clubCount} club${clubCount === 1 ? "" : "s"} followed`,
    members: `${total} member${total === 1 ? "" : "s"} · ${toReview} to review`,
    nextLevel: toReview > 0 ? "Review members first" : `${readyForNextLevel} member${readyForNextLevel === 1 ? "" : "s"} ready for next level`,
    toReview,
  };
}
