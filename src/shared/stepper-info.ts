// src/shared/stepper-info.ts
//
// Computes the per-step info lines (e.g. "12 clubs followed") shown under
// each wizard step's label — used by both the popup's vertical stepper and
// the merged app's horizontal one (shared/app-shell.ts), so neither has to
// duplicate the storage reads + buildReport() call this requires.

import { loadResolutionData } from "./resolution-store";
import { EASYSPEAK_SERVERS, getActiveProfile, getAnonymizeMode, getEasySpeakServer, getMockMode } from "./settings-store";
import { local } from "./storage";
import { buildReport, computeMatchSummary, isMemberResolved } from "./sync/delta";
import { NAV_ITEMS, type AppShellPage, type StepMeta, type StepperInfo } from "./app-shell";
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

/** Whether the user has explicitly finished the wizard via Member Review's
 *  "Complete Setup" button. Profile-scoped (shared/storage.ts). Drives the
 *  Home dashboard banner's "Club Data Ready" state and the Member Review
 *  step's `done` mark below — independent of whether every fuzzy match was
 *  resolved (finishing is the user's call to make). */
export async function getSetupComplete(): Promise<boolean> {
  return (await local.value("setupComplete")) ?? false;
}

/** Set by "Complete Setup" (entrypoints/app/main.ts's stepFooter listener).
 *  Guarded against a redundant write, same reason as markStepVisited(). */
export async function markSetupComplete(): Promise<void> {
  if (await getSetupComplete()) return;
  await local.set({ setupComplete: true });
}

// The four mandatory setup steps the Home dashboard's "Club Data Status"
// banner tracks, in banner order. Labels are kept identical to NAV_ITEMS'
// wizard/nav labels (shared/app-shell.ts) so a step is called the same thing
// on every screen — the banner tracker, the top nav, the popup stepper, and
// each view's own <h1>.
export const SETUP_STEPS = [
  { key: "setup", label: "Setup" },
  { key: "syncData", label: "Sync Data" },
  { key: "clubReview", label: "Club Review" },
  { key: "members", label: "Member Review" },
] as const satisfies readonly { key: AppShellPage; label: string }[];

/** Whether a setup step should render as "complete" (a checked box) in the
 *  Home dashboard's tracker. Mirrors the wizard stepper's own checkmark rule
 *  (shared/app-shell.ts's circleGlyph/circleClass): a step counts as complete
 *  only once it's both `done` *and* no longer `locked` — a step this profile
 *  has never reached yet is never shown as complete, even if its underlying
 *  requirement (e.g. every club already matched exactly) happens to be
 *  satisfied. So the first not-yet-visited step is always "the next step",
 *  exactly as the stepper treats it. Pure, so it's unit-testable. */
export function isSetupStepComplete(meta: StepMeta | undefined): boolean {
  return !!meta?.done && !meta.locked;
}

/** How many of the four SETUP_STEPS are complete in a computed StepperInfo —
 *  see isSetupStepComplete() for the exact rule. Pure (takes StepperInfo), so
 *  it's unit-testable without browser.*. */
export function countCompletedSetupSteps(info: StepperInfo): number {
  return SETUP_STEPS.filter((step) => isSetupStepComplete(info[step.key])).length;
}

/** Whether the Home dashboard's feature CTAs (Club Progress, Excel export,
 *  Approval Helper) should be enabled: a profile is chosen and both sources
 *  are imported. Club/member matching refine quality but every downstream
 *  tool still produces useful output from imported data alone — this matches
 *  the "Requires imported data" badge wording. Pure, same as above. */
export function areFeaturesUnlocked(info: StepperInfo): boolean {
  return !!info.setup?.done && !!info.syncData?.done;
}

export async function computeStepperInfo(): Promise<StepperInfo> {
  const [activeProfile, cached, visited, anonymize, setupComplete] = await Promise.all([
    getActiveProfile(),
    local.get(["basecampData", "basecampScrapedAt", "basecampCompletedPaths", "easyspeakData", "easyspeakScrapedAt"]),
    getVisitedSteps(),
    getAnonymizeMode(),
    getSetupComplete(),
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
    const report = buildReport(basecampData!, easyspeakData!, {}, resolution, cached.basecampCompletedPaths ?? {});
    // A fuzzy-confidence club-name guess is dropped from buildReport()'s own
    // matchClubs(..., allowFuzzy: false) call, so an unconfirmed suggestion
    // already surfaces here as two one-sided pairs — this check doubles as
    // "any club still needs review in Club Review" without a second matchClubs() call.
    clubReviewPending = report.clubPairs.some(
      (pair) => (pair.basecampClubId === null || pair.easyspeakClubId === null) && !pair.clubOrphaned
    );
    reportInfo = computeReportInfo(report);
  }

  // Member Review's prerequisites — a profile, both data sources, and no
  // unresolved club matches. NOT gated on `anonymize` here; that's added
  // separately for `members` just below (Club Progress, reached from the
  // Home dashboard, must stay usable while Anonymize Mode is on).
  const membersBlocked = noProfile || !hasBothData || clubReviewPending;
  const membersDisabled = membersBlocked || anonymize;

  const clubReviewDone = hasBothData && !clubReviewPending;
  const membersPending = (reportInfo?.toReview ?? 0) > 0;
  // Done either by resolving every match, or by the user explicitly finishing
  // the wizard via "Complete Setup" (Member Review's step footer).
  const membersDone = setupComplete || (clubReviewDone && !membersPending);

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
      // Suppressed once the user has explicitly finished the wizard — the
      // "N to review" info line still shows the real count, but the alarm
      // icon would contradict the "Club Data Ready" state they chose.
      warning: membersPending && !setupComplete,
      // The unresolved-match count behind that warning — same number the
      // "To do" filter shows in Member Review (see computeReportInfo's
      // toReview / shared/sync/delta.ts's needsAction). The Home dashboard
      // banner surfaces it as "Review Needed (N items)".
      warningCount: reportInfo?.toReview ?? 0,
      locked: isLocked("members"),
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

  return {
    clubs: `${clubCount} club${clubCount === 1 ? "" : "s"} followed`,
    members: `${total} member${total === 1 ? "" : "s"} · ${toReview} to review`,
    toReview,
  };
}
